// Private VPS helper: one consistent PostgreSQL snapshot, explicitly read-only.
import pg from "/opt/peticao/app/node_modules/pg/lib/index.js";
import { createDecipheriv, createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
const env = {};
for (const line of readFileSync("/etc/peticao/app.env", "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*(DATABASE_URL|CPF_CACHE_ENCRYPTION_KEY)\s*=\s*(.*?)\s*$/);
  if (match) {
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[match[1]] = value;
  }
}
if (!env.DATABASE_URL || !env.CPF_CACHE_ENCRYPTION_KEY) throw new Error("READ_ONLY_EXPORT_CONFIGURATION");
const client = new pg.Client({ connectionString: env.DATABASE_URL, application_name: "peticao-review-read-only", options: "-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=20000" });
const key = createHash("sha256").update(env.CPF_CACHE_ENCRYPTION_KEY.trim()).digest();
function decode(row) {
  const [version, iv, tag, cipher] = row.payload.split(".");
  if (version !== "v1") throw new Error("READ_ONLY_EXPORT_CACHE_VERSION");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAAD(Buffer.from(`cpf-cache:v1:${row.cpf_hash}`)); d.setAuthTag(Buffer.from(tag, "base64url"));
  const value = JSON.parse(Buffer.concat([d.update(Buffer.from(cipher, "base64url")), d.final()]).toString());
  if (typeof value.nome !== "string" || !value.nome.trim()) throw new Error("READ_ONLY_EXPORT_CACHE_RECORD");
  return { hash: row.cpf_hash, status: "ok", name: value.nome, birth: value.nasc ?? null, mother: value.mae ?? null, sex: value.sexo ?? null, queried_at: new Date(row.fetched_at).toISOString() };
}
try {
  await client.connect();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const mode = (await client.query("SELECT current_setting('transaction_read_only') AS mode, now() AS at")).rows[0];
  if (mode.mode !== "on") throw new Error("READ_ONLY_EXPORT_NOT_READ_ONLY");
  const signatures = (await client.query("SELECT id,cpf_hash,seq,name,email,category,institution,role,campus,city,uf,country,university,region_declared,region_validated,created_at,consent_at,confirmed_at,status,ip,user_agent,cpf_name_check,identity_method,verify_code,campus_ibge,email_domain_kind FROM signatures ORDER BY id")).rows;
  const rows = (await client.query("SELECT cpf_hash,payload,fetched_at,expires_at FROM cpf_lookup_cache WHERE expires_at>now() AND fetched_at+interval '30 days'>now() ORDER BY cpf_hash")).rows;
  const records = rows.map(decode);
  await client.query("COMMIT");
  const hash = createHash("sha256");
  for (const name of ["cpf-name.ts", "cpf-check.ts", "identity.ts", "sign-flow.ts"]) {
    const path = "/opt/peticao/app/src/lib/" + name;
    hash.update(name); hash.update(existsSync(path) ? readFileSync(path) : "absent");
  }
  const buildPath = "/opt/peticao/app/.next/BUILD_ID";
  const validation_version = hash.digest("hex");
  const build_id = existsSync(buildPath) ? readFileSync(buildPath, "utf8").trim().slice(0, 100) : null;
  process.stdout.write(JSON.stringify({ at: new Date(mode.at).toISOString(), read_only: true, validation_version, build_id, signatures, cache: { records } }));
} catch {
  await client.query("ROLLBACK").catch(() => {});
  process.stderr.write("READ_ONLY_EXPORT_FAILED\n"); process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
