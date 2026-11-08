// Executed from stdin on the VPS. No file or application changes are performed there.
// The host prepends MIRROR_CONTRACT and the canonical/digest functions from snapshot.mjs.
import pg from "/opt/peticao/app/node_modules/pg/lib/index.js";
import { readFileSync } from "node:fs";

const credentials = {};
for (const line of readFileSync("/etc/peticao/app.env", "utf8").split(/\r?\n/)) {
  const found = line.match(/^\s*(DATABASE_URL)\s*=\s*(.*?)\s*$/);
  if (found) {
    let value = found[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    credentials.DATABASE_URL = value;
  }
}
if (!credentials.DATABASE_URL) throw new Error("MIRROR_SOURCE_CONFIGURATION");
const client = new pg.Client({ connectionString: credentials.DATABASE_URL,
  application_name: "peticao-admin-mirror-read-only",
  options: "-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=30000" });
const out = async value => {
  if (!process.stdout.write(JSON.stringify(value) + "\n")) await new Promise(resolve => process.stdout.once("drain", resolve));
};
const ident = value => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw new Error("MIRROR_SOURCE_IDENTIFIER");
  return '"' + value + '"';
};
try {
  await client.connect();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const mode = (await client.query("SELECT current_setting('transaction_read_only') AS mode,transaction_timestamp() AS at")).rows[0];
  if (mode.mode !== "on") throw new Error("MIRROR_SOURCE_NOT_READ_ONLY");
  const metadata = await client.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[]) ORDER BY table_name,ordinal_position", [MIRROR_CONTRACT.map(t => t.name)]);
  for (const spec of MIRROR_CONTRACT) {
    const expected = spec.columns.map(c => ({ name: c.name, type: c.type }));
    const actual = metadata.rows.filter(c => c.table_name === spec.name).map(c => ({ name: c.column_name, type: c.data_type }));
    if (digest(actual) !== digest(expected)) throw new Error("MIRROR_SOURCE_SCHEMA_CHANGED");
  }
  await out({ type: "header", format: "peticao-admin-mirror/v1", capturedAt: mode.at.toISOString(), contractHash: digest(MIRROR_CONTRACT), readOnly: true });
  const sentBlobs = new Set(MIRROR_KNOWN_BLOBS);
  for (const spec of MIRROR_CONTRACT) {
    let last = null, count = 0;
    const hash = createHash("sha256"); hash.update("[");
    for (;;) {
      const parameters = [], where = [];
      if (spec.name === "settings") {
        parameters.push(["painel_popup_estado", "painel_popup_regiao", "paused"]);
        where.push(`key=ANY($${parameters.length}::text[])`);
      }
      if (last) {
        const refs = last.map(value => { parameters.push(value); return "$" + parameters.length; });
        where.push(`(${spec.primaryKey.map(ident).join(",")}) > (${refs.join(",")})`);
      }
      const fields = spec.columns.map(c => c.redact ? `NULL::${c.type} AS ${ident(c.name)}` : ident(c.name)).join(",");
      const size = spec.name === "batches" ? 1 : 1000;
      const page = await client.query(`SELECT ${fields} FROM public.${ident(spec.name)} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${spec.primaryKey.map(ident).join(",")} LIMIT ${size}`, parameters);
      if (!page.rows.length) break;
      for (const row of page.rows) {
        for (const column of spec.columns) if (Buffer.isBuffer(row[column.name])) {
          const buffer = row[column.name], blobHash = createHash("sha256").update(buffer).digest("hex");
          if (!sentBlobs.has(blobHash)) {
            let index = 0;
            for (let offset = 0; offset < buffer.length; offset += 65536) {
              await out({ type: "blob", hash: blobHash, index: index++, data: buffer.subarray(offset, offset + 65536).toString("base64") });
            }
            // A zero-byte file still needs an explicit chunk.
            if (!buffer.length) await out({ type: "blob", hash: blobHash, index: 0, data: "" });
            await out({ type: "blob-complete", hash: blobHash, bytes: buffer.length }); sentBlobs.add(blobHash);
          }
          row[column.name] = "blob:" + blobHash;
        }
        if (count) hash.update(","); hash.update(canonical(row)); count++;
        await out({ type: "row", table: spec.name, row });
      }
      last = spec.primaryKey.map(key => page.rows.at(-1)[key]);
      if (page.rows.length < size) break;
    }
    hash.update("]");
    await out({ type: "table", name: spec.name, count, sha256: hash.digest("hex") });
  }
  await client.query("COMMIT");
  await out({ type: "complete" });
} catch {
  await client.query("ROLLBACK").catch(() => {});
  process.stderr.write("MIRROR_SOURCE_EXPORT_FAILED\n"); process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
