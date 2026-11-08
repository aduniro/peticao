import { createHash, randomBytes } from "node:crypto";

const TABLES = new Set([
  "signatures", "batches", "batch_sends", "contact_messages", "contact_replies",
  "institutional_domains", "world_universities", "referrers", "events", "audit_log",
  "request_log", "mail_log", "mail_events", "mail_engagement", "email_suppressions",
  "email_checks", "provider_status", "reenvio_falha", "signup_diagnostics",
  "whatsapp_messages", "tour_seen", "invalid_attempts", "ip_blacklist", "mail_outbox", "settings",
]);
const TYPES = new Set(["text", "integer", "bigint", "boolean", "double precision", "jsonb", "json", "bytea", "uuid", "timestamp with time zone", "timestamp without time zone", "date", "text[]"]);
const EXCLUDED = /(?:password|senha|secret|token|approval_code|verify_code|wa_cipher|phone_cipher|content_cipher|email_cipher|payload)/i;
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
      if (!identifier(column.name) || (EXCLUDED.test(column.name) && column.redact !== true) || columns.has(column.name) || !TYPES.has(column.type)) throw new Error("MIRROR_INVALID_COLUMN");
      columns.add(column.name);
    }
    if (!Array.isArray(table.primaryKey) || !table.primaryKey.length || new Set(table.primaryKey).size !== table.primaryKey.length || table.primaryKey.some(key => !columns.has(key))) throw new Error("MIRROR_INVALID_KEY");
  }
  return contract;
}

export function validateManifest(packet, contract) {
  validateContract(contract);
  if (packet?.format !== "peticao-admin-mirror/v1" || packet.complete !== true || packet.contractHash !== digest(contract)) throw new Error("MIRROR_INCOMPLETE_OR_INCOMPATIBLE");
  if (typeof packet.capturedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(packet.capturedAt) || !Number.isFinite(Date.parse(packet.capturedAt))) throw new Error("MIRROR_INVALID_DATE");
  if (!Array.isArray(packet.tables) || packet.tables.length !== contract.length) throw new Error("MIRROR_MISSING_TABLE");
  const names = new Set();
  for (const data of packet.tables) {
    const spec = contract.find(table => table.name === data.name);
    if (!spec || names.has(data.name) || !Number.isSafeInteger(data.count) || data.count < 0 || data.count > 1000000 || !/^[a-f0-9]{64}$/.test(data.sha256)) throw new Error("MIRROR_INVALID_TABLE_DATA");
    names.add(data.name);
  }
  const revision = digest(packet.tables.map(({ name, count, sha256 }) => ({ name, count, sha256 })).sort((a, b) => a.name.localeCompare(b.name)));
  if (packet.revision !== revision) throw new Error("MIRROR_INVALID_REVISION");
  return revision;
}

export function validateRow(row, spec) {
  const columns = new Set(spec.columns.map(column => column.name));
  if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== columns.size || Object.keys(row).some(key => !columns.has(key))) throw new Error("MIRROR_INVALID_ROW");
  if (spec.columns.some(column => column.redact && row[column.name] !== null)) throw new Error("MIRROR_REDACTION_REQUIRED");
  if (spec.name === "settings" && !["painel_popup_estado", "painel_popup_regiao", "paused"].includes(row.key)) throw new Error("MIRROR_SETTING_NOT_ALLOWED");
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
  try {
    await client.query("BEGIN"); began = true;
    await client.query("SET LOCAL lock_timeout='1500ms'; SET LOCAL statement_timeout='30000ms'");
    await client.query(`CREATE SCHEMA ${q(stage)}`);
    for (const table of contract) {
      const qualified = `${q(stage)}.${q(table.name)}`;
      await client.query(`CREATE TABLE ${qualified} (${table.columns.map(c => `${q(c.name)} ${c.type}`).join(",")}, PRIMARY KEY (${table.primaryKey.map(q).join(",")}))`);
      const data = packet.tables.find(item => item.name === table.name);
      for await (const chunk of batches(table, data)) {
        await client.query(`INSERT INTO ${qualified} SELECT * FROM jsonb_populate_recordset(NULL::${qualified},$1::jsonb)`, [JSON.stringify(chunk)]);
      }
      const count = await client.query(`SELECT count(*)::text AS n FROM ${qualified}`);
      if (String(count.rows[0]?.n) !== String(data.count)) throw new Error("MIRROR_IMPORT_COUNT_MISMATCH");
    }
    await client.query(`GRANT USAGE ON SCHEMA ${q(stage)} TO admin_mirror_reader`);
    await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${q(stage)} TO admin_mirror_reader`);
    // Shared by mirror read transactions; building the staging copy does not hold this lock.
    await client.query("SELECT pg_advisory_xact_lock(7027)");
    const current = await client.query("SELECT revision,captured_at FROM public.admin_mirror_state WHERE singleton=true FOR UPDATE");
    if (current.rows[0] && Date.parse(current.rows[0].captured_at) >= Date.parse(packet.capturedAt)) throw new Error("MIRROR_STALE_SNAPSHOT");
    const exists = await client.query("SELECT 1 FROM pg_namespace WHERE nspname='admin_mirror_live'");
    if (exists.rowCount) await client.query(`ALTER SCHEMA admin_mirror_live RENAME TO ${q(retired)}`);
    await client.query(`ALTER SCHEMA ${q(stage)} RENAME TO admin_mirror_live`);
    await client.query("INSERT INTO public.admin_mirror_state(singleton,revision,captured_at,synced_at) VALUES(true,$1,$2,now()) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision,captured_at=excluded.captured_at,synced_at=excluded.synced_at", [revision, packet.capturedAt]);
    await client.query("COMMIT"); began = false;
    // Old schemas are retained for a separate bounded cleanup; failure never destroys the last good copy.
    return { revision, retiredSchema: exists.rowCount ? retired : null };
  } catch (error) {
    if (began) await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}
