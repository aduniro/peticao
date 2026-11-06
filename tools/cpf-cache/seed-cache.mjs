#!/usr/bin/env node
// Importa retornos já consultados; nenhuma chamada HTTP e nenhuma escrita em signatures.
import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const TTL = 30 * 86400_000;
export function importEntries(rows, pepper, encryptionKey, now = Date.now()) {
  if (!pepper || !encryptionKey || encryptionKey.trim().length < 32) throw new Error("Cache keys not configured");
  const key = createHash("sha256").update(encryptionKey.trim()).digest();
  const entries = new Map();
  for (const row of rows) {
    if (row.status !== "ok") continue;
    if (!/^\d{11}$/.test(row.cpf) || !/^[a-f0-9]{64}$/.test(row.cpf_hash ?? "")) throw new Error("Unverified CPF mapping");
    const hash = createHmac("sha256", pepper).update(row.cpf).digest("hex");
    if (hash !== row.cpf_hash || (row.returned_cpf && row.returned_cpf !== row.cpf)) throw new Error("CPF mapping mismatch");
    const at = Date.parse(row.queried_at);
    if (!Number.isFinite(at) || at > now) throw new Error("Invalid lookup time");
    if (at + TTL <= now) continue;
    if (typeof row.name !== "string" || !row.name.trim()) throw new Error("Missing registry name");
    const record = { nome: row.name, mae: row.mother ?? null, nasc: row.birth ?? null, sexo: row.sex ?? null };
    if (![record.mae, record.nasc, record.sexo].every(v => v === null || typeof v === "string")) throw new Error("Invalid registry fields");
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(`cpf-cache:v1:${hash}`));
    const data = Buffer.concat([cipher.update(JSON.stringify(record), "utf8"), cipher.final()]);
    const payload = ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
    const entry = { cpf_hash: hash, payload, fetched_at: new Date(at).toISOString(), expires_at: new Date(at + TTL).toISOString() };
    const prior = entries.get(hash);
    if (!prior || Date.parse(prior.fetched_at) < at) entries.set(hash, entry);
  }
  return [...entries.values()];
}

const readCode = `
import json,sqlite3,sys
from pathlib import Path
source,maps=map(Path,sys.argv[1:])
mapping={}
for path in maps.glob('*.sqlite'):
 c=sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True)
 tables={r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
 if 'signatures' in tables:
  for cpf,digest in c.execute('SELECT cpf,cpf_hash FROM signatures WHERE cpf IS NOT NULL'):
   if cpf in mapping and mapping[cpf]!=digest:raise RuntimeError('Conflicting mapping')
   mapping[cpf]=digest
 c.close()
c=sqlite3.connect(source.resolve().as_uri()+'?mode=ro',uri=True);c.row_factory=sqlite3.Row
rows=[]
for record in c.execute("SELECT cpf,status,name,birth,mother,sex,returned_cpf,queried_at FROM lookups WHERE status='ok'"):
 row=dict(record);row['cpf_hash']=mapping.get(row['cpf']);rows.append(row)
c.close();print(json.dumps(rows))
`;

function main() {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1];
  if (!args.includes("--source") || !args.includes("--maps") || !args.includes("--database")) throw new Error("Expected --source, --maps, --database; --apply commits, otherwise rolls back");
  const database = value("--database");
  if (database !== "peticao" && !/^cpf_audit_[0-9_]+$/.test(database)) throw new Error("Unexpected database");
  const rows = JSON.parse(execFileSync("python3", ["-c", readCode, value("--source"), value("--maps")], { encoding: "utf8", maxBuffer: 30 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
  const entries = importEntries(rows, process.env.HASH_PEPPER, process.env.CPF_CACHE_ENCRYPTION_KEY);
  if (!entries.length) throw new Error("No eligible cached lookups");
  const json = JSON.stringify(entries).replace(/'/g, "''");
  const sql = `BEGIN;
    SET LOCAL statement_timeout='120s';
    WITH imported AS (
      INSERT INTO cpf_lookup_cache(cpf_hash,payload,fetched_at,expires_at)
      SELECT cpf_hash,payload,fetched_at,expires_at FROM jsonb_to_recordset('${json}'::jsonb)
       AS x(cpf_hash text,payload text,fetched_at timestamptz,expires_at timestamptz)
      ON CONFLICT(cpf_hash) DO UPDATE SET payload=EXCLUDED.payload,fetched_at=EXCLUDED.fetched_at,expires_at=EXCLUDED.expires_at
       WHERE cpf_lookup_cache.fetched_at < EXCLUDED.fetched_at
      RETURNING cpf_hash
    ) SELECT json_build_object('eligible',${entries.length},'inserted_or_updated',count(*),'committed',${args.includes("--apply")}) FROM imported;
    ${args.includes("--apply") ? "COMMIT" : "ROLLBACK"};`;
  const output = execFileSync("runuser", ["-u", "postgres", "--", "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-d", database],
    { input: sql, encoding: "utf8", maxBuffer: 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
  console.log(output.trim());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch { console.error("CPF cache import failed; private details omitted."); process.exitCode = 1; }
}
