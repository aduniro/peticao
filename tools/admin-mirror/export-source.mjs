// Executed from stdin on the VPS. No file or application changes are performed there.
// The host prepends MIRROR_CONTRACT and the canonical/digest functions from snapshot.mjs.
import pg from "/opt/peticao/app/node_modules/pg/lib/index.js";
import { readFileSync } from "node:fs";

const credentials = {};
for (const line of readFileSync("/etc/peticao/app.env", "utf8").split(/\r?\n/)) {
  const found = line.match(/^\s*(DATABASE_URL|CPF_CACHE_ENCRYPTION_KEY)\s*=\s*(.*?)\s*$/);
  if (found) {
    let value = found[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    credentials[found[1]] = value;
  }
}
if (!credentials.DATABASE_URL) throw new Error("MIRROR_SOURCE_CONFIGURATION");
const client = new pg.Client({ connectionString: credentials.DATABASE_URL,
  application_name: "peticao-admin-mirror-read-only",
  options: "-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=30000 -c max_parallel_workers_per_gather=0" });
// Preserve PostgreSQL microseconds rather than truncating them through JavaScript Date.
pg.types.setTypeParser(1184, value => value);
pg.types.setTypeParser(1114, value => value);
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
  await out({ type: "header", format: "peticao-admin-mirror/v1", capturedAt: new Date(mode.at).toISOString(), contractHash: digest(MIRROR_CONTRACT), readOnly: true });
  const sentBlobs = new Set(MIRROR_KNOWN_BLOBS);
  const fingerprintSQL = (spec, boundary, params) => {
    const baseParameters = [], baseWhere = [];
    if (spec.name === "settings") {
      params.push(["painel_popup_estado", "painel_popup_regiao", "sending_enabled"]); baseWhere.push(`"key"=ANY($${params.length}::text[])`);
    }
    const printFields = spec.columns.map(c => c.redact ? `NULL::${c.type} AS ${ident(c.name)}` : c.type === "bytea" ? `encode(sha256(${ident(c.name)}),'hex') AS ${ident(c.name)}` : ident(c.name)).join(",");
      const where = [...baseWhere];
      if (boundary) {
        const refs = boundary.map(value => { params.push(value); return "$" + params.length; });
        where.push(`(${spec.primaryKey.map(ident).join(",")}) <= (${refs.join(",")})`);
      }
      return `SELECT '${spec.name}'::text AS table_name,count(*)::int AS n,encode(sha256(convert_to(COALESCE(string_agg(encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex'),'' ORDER BY ${spec.primaryKey.map(k => "t." + ident(k)).join(",")}),''),'UTF8')),'hex') AS fingerprint FROM (SELECT ${printFields} FROM public.${ident(spec.name)} ${where.length ? "WHERE " + where.join(" AND ") : ""}) t`;
  };
  const fullParams = [];
  const pieces = MIRROR_CONTRACT.map(spec => fingerprintSQL(spec, null, fullParams));
  if (MIRROR_CONTRACT.some(t => t.name === "signatures")) pieces.push(coreFingerprintSQL("public.signatures"));
  const fullSQL = pieces.join(" UNION ALL ");
  const fingerprints = new Map((await client.query(fullSQL, fullParams)).rows.map(row => [row.table_name, row]));
  const candidates = MIRROR_CONTRACT.filter(spec => {
    const old = MIRROR_KNOWN_TABLES[spec.name], current = fingerprints.get(spec.name);
    return old?.count > 0 && old.lastKey && current.n >= old.count && current.fingerprint !== old.fingerprint;
  });
  const prefixParams = [];
  const prefixSQL = candidates.map(spec => fingerprintSQL(spec, MIRROR_KNOWN_TABLES[spec.name].lastKey, prefixParams)).join(" UNION ALL ");
  const prefixes = new Map(prefixSQL ? (await client.query(prefixSQL, prefixParams)).rows.map(row => [row.table_name, row]) : []);
  for (const spec of MIRROR_CONTRACT) {
    const current = fingerprints.get(spec.name), previous = MIRROR_KNOWN_TABLES[spec.name];
    if (previous && current.n === previous.count && current.fingerprint === previous.fingerprint) {
      await out({ type: "reuse", mode: "reuse", name: spec.name, count: previous.count, sha256: previous.sha256, baseSha256: previous.sha256, baseCount: previous.count, fingerprint: current.fingerprint, lastKey: previous.lastKey });
      continue;
    }
    let delta = false;
    if (previous?.count > 0 && previous.lastKey && current.n >= previous.count) {
      const prefix = prefixes.get(spec.name);
      delta = prefix?.n === previous.count && prefix.fingerprint === previous.fingerprint;
    }
    if (delta) await out({ type: "delta", name: spec.name, baseSha256: previous.sha256, baseCount: previous.count });
    let last = delta ? previous.lastKey : null, count = 0;
    const hash = createHash("sha256"); hash.update("[");
    for (;;) {
      const parameters = [], where = [];
      if (spec.name === "settings") {
        parameters.push(["painel_popup_estado", "painel_popup_regiao", "sending_enabled"]);
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
        for (const column of spec.columns) if (column.localProtection && row[column.name] !== null) {
          if (!credentials.CPF_CACHE_ENCRYPTION_KEY || !MIRROR_RECEIVER_PUBLIC_KEY) throw new Error("MIRROR_PROTECTED_FIELD_CONFIGURATION");
          const plain = decodeCacheField(row[column.name], credentials.CPF_CACHE_ENCRYPTION_KEY, row.id);
          row[column.name] = sealEmail(plain, MIRROR_RECEIVER_PUBLIC_KEY, row.id);
        }
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
    const addedSha256 = hash.digest("hex");
    if (current.n !== count + (delta ? previous.count : 0)) throw new Error("MIRROR_SOURCE_COUNT_CHANGED");
    const data = delta ? { mode: "delta", baseSha256: previous.sha256, baseCount: previous.count, addedCount: count, addedSha256 } : { mode: "full" };
    await out({ type: "table", name: spec.name, count: current.n, ...data, sha256: delta ? deltaDigest(data) : addedSha256, fingerprint: current.fingerprint, lastKey: last });
  }
  await client.query("COMMIT");
  await out({ type: "complete", signatureCoreHash: fingerprints.get("mirror_signature_core")?.fingerprint });
} catch {
  await client.query("ROLLBACK").catch(() => {});
  process.stderr.write("MIRROR_SOURCE_EXPORT_FAILED\n"); process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
