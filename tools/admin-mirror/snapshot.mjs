import { createHash, randomBytes } from "node:crypto";
import { coreFingerprintSQL } from "./core-check.mjs";
import { createReadIndexes } from "./read-indexes.mjs";

const TABLES = new Set([
  "signatures", "batches", "batch_sends", "contact_messages", "contact_replies",
  "institutional_domains", "world_universities", "referrers", "events", "audit_log",
  "request_log", "mail_log", "mail_events", "mail_engagement", "email_suppressions",
  "email_checks", "provider_status", "reenvio_falha", "signup_diagnostics",
  "whatsapp_messages", "tour_seen", "invalid_attempts", "ip_blacklist", "mail_outbox", "settings",
]);
const TYPES = new Set(["text", "integer", "bigint", "boolean", "double precision", "jsonb", "json", "bytea", "uuid", "timestamp with time zone", "timestamp without time zone", "date", "text[]"]);
const EXCLUDED = /(?:password|senha|secret|(?:^|_)token(?:_hash)?$|approval_code(?:_hash)?$|verify_code|wa_cipher|phone_cipher|content_cipher|email_cipher|payload)/i;
const identifier = value => typeof value === "string" && /^[a-z][a-z0-9_]{0,62}$/.test(value);
const q = value => {
  if (!identifier(value)) throw new Error("MIRROR_INVALID_IDENTIFIER");
  return `"${value}"`;
};

export function canonical(value) {
  if (value instanceof Date) return canonical(value.toJSON());
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error("MIRROR_INVALID_JSON");
  return result;
}
export const digest = value => createHash("sha256").update(canonical(value)).digest("hex");

/** The contract is trusted local configuration, never supplied by the downloaded packet. */
export function validateContract(contract) {
  if (!Array.isArray(contract) || contract.length === 0) throw new Error("MIRROR_EMPTY_CONTRACT");
  const names = new Set();
  for (const table of contract) {
    if (!TABLES.has(table.name) || names.has(table.name)) throw new Error("MIRROR_INVALID_TABLE");
    names.add(table.name);
    if (!Array.isArray(table.columns) || !table.columns.length) throw new Error("MIRROR_INVALID_COLUMNS");
    const columns = new Set();
    for (const column of table.columns) {
      const protectedEmail = table.name === "signup_diagnostics" && column.name === "email_cipher" && column.type === "text" && column.localProtection === "email-transfer-v1";
      if (!identifier(column.name) || (EXCLUDED.test(column.name) && column.redact !== true && !protectedEmail) || columns.has(column.name) || !TYPES.has(column.type)) throw new Error("MIRROR_INVALID_COLUMN");
      columns.add(column.name);
    }
    if (!Array.isArray(table.primaryKey) || !table.primaryKey.length || new Set(table.primaryKey).size !== table.primaryKey.length || table.primaryKey.some(key => !columns.has(key))) throw new Error("MIRROR_INVALID_KEY");
  }
  return contract;
}

export function validateManifest(packet, contract) {
  validateContract(contract);
  if (packet?.format !== "peticao-admin-mirror/v1" || packet.complete !== true || packet.contractHash !== digest(contract)) throw new Error("MIRROR_INCOMPLETE_OR_INCOMPATIBLE");
  if (packet.signatureCoreHash && !/^[a-f0-9]{64}$/.test(packet.signatureCoreHash)) throw new Error("MIRROR_CORE_HASH");
  if (typeof packet.capturedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(packet.capturedAt) || !Number.isFinite(Date.parse(packet.capturedAt))) throw new Error("MIRROR_INVALID_DATE");
  if (!Array.isArray(packet.tables) || packet.tables.length !== contract.length) throw new Error("MIRROR_MISSING_TABLE");
  const names = new Set();
  for (const data of packet.tables) {
    const spec = contract.find(table => table.name === data.name);
    if (!spec || names.has(data.name) || !Number.isSafeInteger(data.count) || data.count < 0 || data.count > 1000000 || !/^[a-f0-9]{64}$/.test(data.sha256)) throw new Error("MIRROR_INVALID_TABLE_DATA");
    if (data.mode && !["full", "reuse", "delta"].includes(data.mode)) throw new Error("MIRROR_INVALID_TABLE_MODE");
    if (data.mode === "reuse" || data.mode === "delta") {
      if (!/^[a-f0-9]{64}$/.test(data.baseSha256) || !Number.isSafeInteger(data.baseCount) || data.baseCount < 0) throw new Error("MIRROR_INVALID_BASE");
      if (data.mode === "reuse" && (data.sha256 !== data.baseSha256 || data.count !== data.baseCount)) throw new Error("MIRROR_INVALID_REUSE");
      if (data.mode === "delta" && (!Number.isSafeInteger(data.addedCount) || data.addedCount < 0 || data.count !== data.baseCount + data.addedCount || !/^[a-f0-9]{64}$/.test(data.addedSha256) || data.sha256 !== deltaDigest(data))) throw new Error("MIRROR_INVALID_DELTA");
    }
    names.add(data.name);
  }
  const revision = digest(packet.tables.map(({ name, count, sha256 }) => ({ name, count, sha256 })).sort((a, b) => a.name.localeCompare(b.name)));
  if (packet.revision !== revision) throw new Error("MIRROR_INVALID_REVISION");
  return revision;
}

export function deltaDigest(data) {
  return digest({ baseSha256: data.baseSha256, baseCount: data.baseCount, addedSha256: data.addedSha256, addedCount: data.addedCount });
}

export function validateRow(row, spec) {
  const columns = new Set(spec.columns.map(column => column.name));
  if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== columns.size || Object.keys(row).some(key => !columns.has(key))) throw new Error("MIRROR_INVALID_ROW");
  if (spec.columns.some(column => column.redact && row[column.name] !== null)) throw new Error("MIRROR_REDACTION_REQUIRED");
  if (spec.columns.some(column => column.localProtection && row[column.name] !== null && !/^mirror-mail-v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(row[column.name]))) throw new Error("MIRROR_LOCAL_PROTECTION_REQUIRED");
  if (spec.name === "settings" && !["painel_popup_estado", "painel_popup_regiao", "sending_enabled"].includes(row.key)) throw new Error("MIRROR_SETTING_NOT_ALLOWED");
  const values = spec.primaryKey.map(key => row[key]);
  if (values.some(value => value == null || !["string", "number", "boolean"].includes(typeof value))) throw new Error("MIRROR_INVALID_ROW_KEY");
  return canonical(values);
}

export function validateSnapshot(packet, contract) {
  const revision = validateManifest(packet, contract);
  for (const data of packet.tables) {
    const spec = contract.find(table => table.name === data.name), keys = new Set();
    if (!Array.isArray(data.rows) || data.count !== data.rows.length || data.sha256 !== digest(data.rows)) throw new Error("MIRROR_INVALID_TABLE_DATA");
    for (const row of data.rows) {
      const key = validateRow(row, spec);
      if (keys.has(key)) throw new Error("MIRROR_DUPLICATE_KEY"); keys.add(key);
    }
  }
  return revision;
}

/** Uses a local-only import connection. No remote SQL or remote credentials are accepted here. */
export async function publishSnapshot(client, packet, contract) {
  validateSnapshot(packet, contract);
  return publishBatches(client, packet, contract, async function* (table, data) {
    for (let index = 0; index < data.rows.length;) {
      const chunk = []; let bytes = 0;
      while (index < data.rows.length && chunk.length < 500) {
        const size = Buffer.byteLength(JSON.stringify(data.rows[index]));
        if (chunk.length && bytes + size > 2 * 1024 * 1024) break;
        bytes += size; chunk.push(data.rows[index++]);
      }
      yield chunk;
    }
  });
}

/** Row batches must validate file integrity before their iterator completes. */
export async function publishBatches(client, packet, contract, batches) {
  const revision = validateManifest(packet, contract);
  const stage = "admin_mirror_stage_" + randomBytes(8).toString("hex");
  const retired = "admin_mirror_old_" + randomBytes(8).toString("hex");
  let began = false;
  let phase = "begin", tableName = null;
  try {
    await client.query("BEGIN"); began = true;
    await client.query("SET LOCAL lock_timeout='1500ms'; SET LOCAL statement_timeout='30000ms'");
    const baseline = (await client.query("SELECT revision,captured_at,tables,contract_hash FROM public.admin_mirror_state WHERE singleton=true")).rows[0];
    let incremental = baseline?.contract_hash === packet.contractHash && contract.every(t => baseline.tables?.some(old => old.name === t.name));
    if (incremental && contract.some(t => t.name === "batches" && t.columns.some(c => c.type === "bytea"))) {
      incremental = (await client.query("SELECT to_regclass('admin_mirror_live.mirror_batch_rows') IS NOT NULL AS yes")).rows[0].yes;
    }
    await client.query(`CREATE SCHEMA ${q(stage)}`);
    for (const table of contract) {
      tableName = table.name; phase = "create-table";
      const data = packet.tables.find(item => item.name === table.name);
      if (incremental && (data.mode === "reuse" || data.mode === "delta")) {
        const old = baseline.tables.find(item => item.name === table.name);
        if (old.sha256 !== data.baseSha256 || old.count !== data.baseCount) throw new Error("MIRROR_BASE_NOT_AVAILABLE");
      }
      if (incremental && data.mode === "reuse") continue;
      const documents = table.name === "batches" ? table.columns.filter(c => c.type === "bytea") : [];
      const physicalName = documents.length ? "mirror_batch_rows" : table.name;
      const qualified = `${q(stage)}.${q(physicalName)}`;
      const hashColumns = documents.map(c => "mirror_blob_" + c.name);
      await client.query(`CREATE TABLE ${qualified} (${[...table.columns.map(c => `${q(c.name)} ${c.type}`), ...hashColumns.map(c => `${q(c)} text`)].join(",")}, PRIMARY KEY (${table.primaryKey.map(q).join(",")}))`);
      if (!incremental && (data.mode === "reuse" || data.mode === "delta")) {
        const old = baseline?.tables?.find(item => item.name === table.name);
        if (baseline?.contract_hash !== packet.contractHash || old?.sha256 !== data.baseSha256 || old?.count !== data.baseCount) throw new Error("MIRROR_BASE_NOT_AVAILABLE");
        const columns = table.columns.map(c => q(c.name)).join(",");
        phase = "copy-local-base";
        if (!documents.length) await client.query(`INSERT INTO ${qualified} (${columns}) SELECT ${columns} FROM admin_mirror_live.${q(table.name)}`);
        else {
          const hasMetadata = (await client.query("SELECT to_regclass('admin_mirror_live.mirror_batch_rows') IS NOT NULL AS yes")).rows[0].yes;
          if (hasMetadata) {
            const fields = [...table.columns.map(c => c.name), ...hashColumns].map(q).join(",");
            await client.query(`INSERT INTO ${qualified} (${fields}) SELECT ${fields} FROM admin_mirror_live.mirror_batch_rows`);
          } else {
            // One-time migration from a legacy local snapshot; process one document per query.
            const ids = (await client.query("SELECT id FROM admin_mirror_live.batches ORDER BY id")).rows;
            for (const { id } of ids) {
              for (const column of documents) await client.query(`INSERT INTO public.admin_mirror_documents(sha256,content) SELECT encode(sha256(${q(column.name)}),'hex'),${q(column.name)} FROM admin_mirror_live.batches WHERE id=$1 AND ${q(column.name)} IS NOT NULL ON CONFLICT(sha256) DO NOTHING`, [id]);
              const fields = [...table.columns.map(c => c.type === "bytea" ? `NULL::bytea AS ${q(c.name)}` : q(c.name)), ...documents.map(c => `encode(sha256(${q(c.name)}),'hex')`)].join(",");
              await client.query(`INSERT INTO ${qualified} SELECT ${fields} FROM admin_mirror_live.batches WHERE id=$1`, [id]);
            }
          }
        }
      }
      if (data.mode !== "reuse") {
        phase = "import-rows";
        for await (const chunk of batches(table, data)) {
          const values = documents.length ? chunk.map(row => ({ ...row })) : chunk;
          for (const row of values) for (const column of documents) {
            let hash = null;
            if (row[column.name] !== null) {
              const value = row[column.name];
              if (typeof value !== "string" || !/^\\x[0-9a-f]*$/.test(value)) throw new Error("MIRROR_DOCUMENT_FORMAT");
              const bytes = Buffer.from(value.slice(2), "hex"); hash = createHash("sha256").update(bytes).digest("hex");
              await client.query("INSERT INTO public.admin_mirror_documents(sha256,content) VALUES($1,$2) ON CONFLICT(sha256) DO NOTHING", [hash, bytes]);
            }
            row[column.name] = null; row["mirror_blob_" + column.name] = hash;
          }
          await client.query(`INSERT INTO ${qualified} SELECT * FROM jsonb_populate_recordset(NULL::${qualified},$1::jsonb)`, [JSON.stringify(values)]);
        }
      }
      phase = "check-count";
      const count = await client.query(`SELECT count(*)::text AS n FROM ${qualified}`);
      const expected = incremental && data.mode === "delta" ? data.addedCount : data.count;
      if (String(count.rows[0]?.n) !== String(expected)) throw new Error("MIRROR_IMPORT_COUNT_MISMATCH");
      if (!incremental || data.mode !== "delta") await createReadIndexes(client, stage, table);
      if (documents.length) {
        const fields = table.columns.map(c => c.type === "bytea" ? `d${documents.findIndex(d => d.name === c.name)}.content AS ${q(c.name)}` : `m.${q(c.name)}`).join(",");
        const joins = documents.map((c, i) => `LEFT JOIN public.admin_mirror_documents d${i} ON d${i}.sha256=m.${q("mirror_blob_" + c.name)}`).join(" ");
        await client.query(`CREATE VIEW ${q(stage)}.batches AS SELECT ${fields} FROM ${qualified} m ${joins}`);
      }
    }
    phase = "publish"; tableName = null;
    await client.query(`GRANT USAGE ON SCHEMA ${q(stage)} TO admin_mirror_reader`);
    await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${q(stage)} TO admin_mirror_reader`);
    // Shared by mirror read transactions; building the staging copy does not hold this lock.
    await client.query("SELECT pg_advisory_xact_lock(7027)");
    const current = await client.query("SELECT revision,captured_at FROM public.admin_mirror_state WHERE singleton=true FOR UPDATE");
    if ((baseline?.revision ?? null) !== (current.rows[0]?.revision ?? null)) throw new Error("MIRROR_BASE_MOVED");
    if (current.rows[0] && Date.parse(current.rows[0].captured_at) >= Date.parse(packet.capturedAt)) throw new Error("MIRROR_STALE_SNAPSHOT");
    let retained = null;
    if (incremental) {
      const full = packet.tables.some(t => !t.mode || t.mode === "full");
      if (full) { await client.query(`CREATE SCHEMA ${q(retired)}`); retained = retired; }
      for (const table of contract) {
        const data = packet.tables.find(item => item.name === table.name);
        if (data.mode === "reuse") continue;
        const documents = table.name === "batches" ? table.columns.filter(c => c.type === "bytea") : [];
        const physicalName = documents.length ? "mirror_batch_rows" : table.name;
        if (data.mode === "delta") {
          const columns = [...table.columns.map(c => c.name), ...documents.map(c => "mirror_blob_" + c.name)].map(q).join(",");
          await client.query(`INSERT INTO admin_mirror_live.${q(physicalName)} (${columns}) SELECT ${columns} FROM ${q(stage)}.${q(physicalName)}`);
        } else {
          if (documents.length) await client.query(`ALTER VIEW admin_mirror_live.batches SET SCHEMA ${q(retired)}`);
          await client.query(`ALTER TABLE admin_mirror_live.${q(physicalName)} SET SCHEMA ${q(retired)}`);
          await client.query(`ALTER TABLE ${q(stage)}.${q(physicalName)} SET SCHEMA admin_mirror_live`);
          if (documents.length) await client.query(`ALTER VIEW ${q(stage)}.batches SET SCHEMA admin_mirror_live`);
        }
      }
      await client.query(`DROP SCHEMA ${q(stage)} CASCADE`);
    } else {
      const exists = await client.query("SELECT 1 FROM pg_namespace WHERE nspname='admin_mirror_live'");
      if (exists.rowCount) { await client.query(`ALTER SCHEMA admin_mirror_live RENAME TO ${q(retired)}`); retained = retired; }
      await client.query(`ALTER SCHEMA ${q(stage)} RENAME TO admin_mirror_live`);
    }
    if (packet.signatureCoreHash) {
      phase = "verify-signature-core";
      const local = (await client.query(coreFingerprintSQL("admin_mirror_live.signatures"))).rows[0].fingerprint;
      if (local !== packet.signatureCoreHash) throw new Error("MIRROR_SIGNATURE_CORE_MISMATCH");
    }
    await client.query("INSERT INTO public.admin_mirror_state(singleton,revision,captured_at,synced_at,tables,contract_hash) VALUES(true,$1,$2,now(),$3,$4) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision,captured_at=excluded.captured_at,synced_at=excluded.synced_at,tables=excluded.tables,contract_hash=excluded.contract_hash", [revision, packet.capturedAt, JSON.stringify(packet.tables.map(({ rows, ...metadata }) => metadata)), packet.contractHash]);
    await client.query("COMMIT"); began = false;
    // Replaced tables are retained for bounded cleanup; failures roll back every change.
    return { revision, retiredSchema: retained };
  } catch (error) {
    if (began) await client.query("ROLLBACK").catch(() => {});
    error.mirrorStage = phase; error.mirrorTable = tableName;
    throw error;
  }
}
