// Directed rehearsal of old/new bootstrap on an isolated, disposable PG17 fixture.
// Does not exercise mail providers, signing, approval, or blocked application flows.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const fixture = JSON.parse(readFileSync(process.argv[2], "utf8"));
const privateRoot = "/mnt/apps/peticao-final/_ops/releases-admin-publico/integracao-20261112/";
assert.ok(realpathSync(process.argv[2]).startsWith(privateRoot));
assert.ok(realpathSync(fixture.socket).startsWith(privateRoot));
assert.ok(Buffer.byteLength(fixture.socket + "/.s.PGSQL.5432") < 108, "Use a short private Unix socket alias");
assert.equal(fixture.database, "fixture");
assert.equal(fixture.user, "fixture_app");
const require = createRequire(resolve(fixture.dependencies, "../package.json"));
const { Pool } = require("pg");
const pool = new Pool({ host: fixture.socket, database: fixture.database,
  user: fixture.user, password: fixture.password, max: 1,
  connectionTimeoutMillis: 5000, options: "-c statement_timeout=30000 -c lock_timeout=3000" });
const evidence = { scope: "b9e-to-current bootstrap and legacy restart only", checks: [],
  queueCoexistenceQualified: false, productionTouched: false, errors: [] };
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function bootstrap(source, label) {
  assert.ok(source.startsWith("/mnt/apps/peticao-final/"));
  const script = `const loaded=await import(${JSON.stringify(resolve(source, "site/src/lib/db.ts"))});const db=loaded.default??loaded;try{await db.query('SELECT 1')}finally{await db._closeDbForTests()}`;
  // DATABASE_SCHEMA is intentionally absent: _closeDbForTests closes the pool,
  // and must NOT drop the persistent fixture schema between these processes.
  const env = { PATH: "/usr/bin:/bin", HOME: fixture.empty, NODE_ENV: "test",
    DATABASE_URL: `postgresql://${fixture.user}:${fixture.password}@localhost/fixture?host=${encodeURIComponent(fixture.socket)}`,
    APP_URL: "https://public.fixture.invalid", ADMIN_URL: "https://admin.fixture.invalid",
    HASH_PEPPER: "FICTIONAL_BOOTSTRAP_PEPPER_NOT_PRODUCTION_00000000",
    ADMIN_PASSWORD: "Fixture-only-NotProduction-123", SECRETS_DIR: fixture.empty,
    PETICAO_CONFIG_DIR: fixture.empty, CREDENTIALS_DIRECTORY: fixture.empty,
    MAIL_PROVIDER: "dev", MAIL_PROVIDERS: "dev", WHATSAPP_ENABLED: "0",
    NODE_OPTIONS: "--max-old-space-size=384", NEXT_TELEMETRY_DISABLED: "1",
    PGOPTIONS: "-c statement_timeout=30000 -c lock_timeout=3000" };
  const run = spawnSync(process.execPath, ["--import", fixture.loader, "--input-type=module", "-e", script],
    { cwd: resolve(source, "site"), env, encoding: "utf8", timeout: 180000, maxBuffer: 1024 * 1024 });
  writeFileSync(resolve(fixture.output, label + ".log"), (run.stdout ?? "") + (run.stderr ?? ""));
  assert.equal(run.status, 0, `${label} failed; inspect its retained log`);
  evidence.checks.push(label);
}

const tables = ["signatures", "batches", "mail_outbox"];
const columns = {};
async function snapshot() {
  const result = {};
  for (const table of tables) {
    const selection = columns[table].map(name => '"' + name.replaceAll('"', '""') + '"').join(",");
    result[table] = (await pool.query(`SELECT ${selection} FROM ${table} ORDER BY id`)).rows;
  }
  return result;
}

try {
  const version = (await pool.query("SHOW server_version_num")).rows[0].server_version_num;
  assert.ok(Number(version) >= 170000 && Number(version) < 180000);
  evidence.postgres = (await pool.query("SELECT version() v")).rows[0].v;
  const role = (await pool.query("SELECT rolsuper FROM pg_roles WHERE rolname=current_user")).rows[0];
  assert.equal(role.rolsuper, false);
  bootstrap(fixture.legacy, "legacy-initial-bootstrap");
  // All data is fictional. Include a frozen legacy PDF and a pending legacy outbox row.
  await pool.query(`INSERT INTO signatures(name,email,email_hash,category,text_version,consent_at,status)
    VALUES('Fixture Person One','one@fixture.invalid','fixture-hash-one','apoiador','fixture-v1','2026-11-01T00:00:00Z','confirmed'),
          ('Fixture Person Two','two@fixture.invalid','fixture-hash-two','apoiador','fixture-v1','2026-11-01T00:00:00Z','pending')`);
  // Run the old bootstrap again to populate identifiers exactly as the old runtime does.
  bootstrap(fixture.legacy, "legacy-populated-bootstrap");
  await pool.query(`INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf,pdf_sha256)
    VALUES(1,'partial','prepared',0,1,'fixture-list-hash',$1,$2)`,
    [Buffer.from("FICTIONAL-PDF-BYTES"), createHash("sha256").update("FICTIONAL-PDF-BYTES").digest("hex")]);
  await pool.query(`INSERT INTO mail_outbox(kind,to_addr,payload) VALUES('fixture','nobody@fixture.invalid','{"to":"nobody@fixture.invalid","subject":"fixture","text":"Never deliver"}')`);
  for (const table of tables) columns[table] = (await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [table])).rows.map(row => row.column_name);
  const before = await snapshot();
  evidence.before = hash(before);
  for (const [source, label] of [[fixture.current, "new-populated-bootstrap"],
    [fixture.current, "new-idempotent-bootstrap"], [fixture.legacy, "legacy-restart-after-new"]]) {
    bootstrap(source, label);
    assert.deepEqual(await snapshot(), before, `${label} changed old row values`);
    evidence.checks.push(label + "-old-values-preserved");
  }
  evidence.after = hash(await snapshot());
  evidence.applicationRole = "non-superuser fixture owner";
  evidence.exit = 0;
} catch (error) {
  evidence.errors.push(String(error.stack ?? error));
  evidence.exit = 1;
  process.exitCode = 1;
} finally {
  await pool.end();
  writeFileSync(resolve(fixture.output, "bootstrap-result.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ exit: evidence.exit, checks: evidence.checks.length,
    postgres: evidence.postgres, output: resolve(fixture.output, "bootstrap-result.json") }));
}
