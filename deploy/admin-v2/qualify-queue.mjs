// Two real application processes, private PG17 socket, fictional effects only.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, realpathSync, createWriteStream } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fork, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const configFile = process.argv[2];
const fixture = JSON.parse(readFileSync(configFile, "utf8"));
const privateRoot = "/mnt/apps/peticao-final/_ops/releases-admin-publico/integracao-20261112/";
assert.ok(realpathSync(configFile).startsWith(privateRoot));
assert.ok(realpathSync(fixture.socket).startsWith(privateRoot));
assert.ok(Buffer.byteLength(fixture.socket + "/.s.PGSQL.5432") < 108);
assert.match(fixture.database, /^fixture_queue_[0-9]+$/);
assert.equal(fixture.user, "fixture_app");
const connection = `postgresql://${fixture.user}:${fixture.password}@localhost/${fixture.database}?host=${encodeURIComponent(fixture.socket)}`;
const moduleAt = async (source, name) => {
  const loaded = await import(resolve(source, "site/src/lib/" + name + ".ts"));
  return loaded.default ?? loaded;
};

async function worker(scope) {
  assert.ok(["legacy", "v2", "migration"].includes(scope));
  const source = scope === "legacy" ? fixture.legacy : fixture.current;
  const db = await moduleAt(source, "db");
  try {
    await db.query("SELECT 1");
    if (scope === "migration") {
      process.send({ type: "ready", scope });
      await new Promise(resolve => process.once("message", resolve));
      process.send({ type: "done", scope });
      return;
    }
    const outbox = await moduleAt(source, "mail/outbox");
    let recorded, queueId, unknownBlocked = false, rejectionAccepted = false;
    if (scope === "v2") {
      recorded = await moduleAt(source, "mail/recorded");
      const mail = { to: "v2@fixture.invalid", subject: "Fictional queue", text: "Never transport outside this fixture" };
      const message = await recorded.prepareRecorded(mail, "fixture", "transactional", "fixture-queue-v2");
      queueId = await outbox.enqueueMail(mail, "fixture", "fixture-only", message.id);
      await db.query("UPDATE mail_outbox_v2 SET next_attempt_at=now()-interval '1 minute' WHERE id=$1", [queueId]);
      const uncertain = await recorded.prepareRecorded({ ...mail, to: "unknown@fixture.invalid" }, "fixture", "transactional", "fixture-unknown");
      const journal = recorded.journalFor(uncertain.id, true);
      const attempt = await journal.begin("fixture", "qa@fixture.invalid");
      await db.query("INSERT INTO fixture_queue_effects(scope,identity,queue_id) VALUES('v2-unknown',$1,NULL)", [uncertain.id]);
      await journal.finish(attempt.id, false, new Error("fixture response lost after effect"));
      try { await journal.begin("fixture", "qa@fixture.invalid"); }
      catch (error) { unknownBlocked = /mail_record_indeterminate/.test(String(error)); }
      assert.ok(unknownBlocked, "unknown transport must not authorize replay");
      const rejected = await recorded.prepareRecorded({ ...mail, to: "rejected@fixture.invalid" }, "fixture", "transactional", "fixture-rejected");
      const rejectedJournal = recorded.journalFor(rejected.id, true);
      const first = await rejectedJournal.begin("fixture", "qa@fixture.invalid");
      await rejectedJournal.finish(first.id, false, new recorded.MailTransportRejected("fixture proven rejection"));
      const second = await rejectedJournal.begin("fixture", "qa@fixture.invalid");
      await db.query("INSERT INTO fixture_queue_effects(scope,identity,queue_id) VALUES('v2-rejection',$1,NULL)", [rejected.id]);
      await rejectedJournal.finish(second.id, true);
      rejectionAccepted = true;
    }
    process.send({ type: "ready", scope, queueId, unknownBlocked, rejectionAccepted });
    await new Promise(resolve => process.once("message", resolve));
    const send = async (mail, kind, context) => {
      if (scope === "legacy") {
        await db.query("INSERT INTO fixture_queue_effects(scope,identity,queue_id) VALUES('legacy',$1,1)", [mail.to]);
      } else {
        const observed = await recorded.recordedQueueMail(mail, kind, context);
        const journal = recorded.journalFor(observed.id, true);
        const attempt = await journal.begin("fixture", "qa@fixture.invalid");
        if (!attempt.alreadyAccepted) {
          await db.query("INSERT INTO fixture_queue_effects(scope,identity,queue_id) VALUES('v2',$1,$2)", [mail.to, context.id]);
          await journal.finish(attempt.id, true);
        }
      }
    };
    const result = await outbox.drainOutbox(send, 20);
    let recovered;
    if (scope === "v2") {
      // Simulate the queue acknowledgement being lost after the journal accepted.
      await db.query("UPDATE mail_outbox_v2 SET status='pending',sent_at=NULL,next_attempt_at=now()-interval '1 minute' WHERE id=$1", [queueId]);
      recovered = await outbox.drainOutbox(send, 20);
    }
    process.send({ type: "done", scope, result, recovered });
  } finally {
    await db._closeDbForTests();
    process.disconnect();
  }
}

if (process.argv[3]) {
  try { await worker(process.argv[3]); }
  catch (error) { console.error(error); process.exitCode = 1; if (process.connected) process.disconnect(); }
} else {
  const require = createRequire(resolve(fixture.dependencies, "../package.json"));
  const { Pool } = require("pg");
  const pool = new Pool({ host: fixture.socket, database: fixture.database, user: fixture.user,
    password: fixture.password, max: 1, connectionTimeoutMillis: 5000 });
  const children = [];
  const evidence = { scope: "physical queue separation and v2 journal replay rules", checks: [], productionTouched: false, errors: [] };
  function sourceManifest(source) {
    const names = execFileSync("git", ["-C", source, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean).sort();
    return { commit: execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      files: Object.fromEntries(names.map(name => [name, createHash("sha256").update(readFileSync(resolve(source, name))).digest("hex")])) };
  }
  function launch(scope) {
    const runtimeConnection = `postgresql://${fixture.runtimeUser}:${fixture.runtimePassword}@localhost/${fixture.database}?host=${encodeURIComponent(fixture.socket)}`;
    const env = { PATH: "/usr/bin:/bin", HOME: fixture.empty, NODE_ENV: "test", DATABASE_URL: scope === "v2" ? runtimeConnection : connection,
      HASH_PEPPER: "FICTIONAL_BOOTSTRAP_PEPPER_NOT_PRODUCTION_00000000", ADMIN_PASSWORD: "Fixture-Only-123",
      APP_URL: "https://public.fixture.invalid", ADMIN_URL: "https://admin.fixture.invalid",
      MAIL_PROVIDER: "dev", MAIL_PROVIDERS: "dev", MAIL_FROM: "qa@fixture.invalid", WHATSAPP_ENABLED: "0",
      SECRETS_DIR: fixture.empty, PETICAO_CONFIG_DIR: fixture.empty, CREDENTIALS_DIRECTORY: fixture.empty,
      MAIL_QUEUE_SCOPE: scope === "legacy" ? "legacy" : "v2",
      ...(scope === "v2" ? { PETICAO_RUNTIME: "admin-v2", DB_BOOTSTRAP_MODE: "verify", DB_SCHEMA_SHA256: fixture.expectedSchemaHash }
        : scope === "migration" ? { PETICAO_RUNTIME: "migration", DB_BOOTSTRAP_MODE: "apply" } : {}),
      NODE_OPTIONS: "--max-old-space-size=384", PGOPTIONS: "-c statement_timeout=30000 -c lock_timeout=3000" };
    const child = fork(fileURLToPath(import.meta.url), [configFile, scope], {
      cwd: resolve(scope === "legacy" ? fixture.legacy : fixture.current, "site"), env,
      execArgv: ["--import", fixture.loader], stdio: ["ignore", "pipe", "pipe", "ipc"] });
    const log = createWriteStream(resolve(fixture.output, scope + "-queue-worker.log"));
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    child.on("close", () => log.end()); children.push(child);
    function message(type) {
      return new Promise((accept, reject) => {
        const timeout = setTimeout(() => reject(new Error(scope + " " + type + " timeout")), 240000);
        const receive = value => { if (value.type === type) { clearTimeout(timeout); child.off("message", receive); accept(value); } };
        child.on("message", receive);
        child.once("error", error => { clearTimeout(timeout); reject(error); });
        child.once("exit", code => { clearTimeout(timeout); reject(new Error(scope + " exited before " + type + ": " + code)); });
      });
    }
    const ready = message("ready"), done = message("done");
    // A worker can fail during bootstrap before its completion promise is awaited.
    void ready.catch(() => {}); void done.catch(() => {});
    const exited = new Promise((accept, reject) => child.once("exit", code => code === 0 ? accept(code) : reject(new Error(scope + " exit " + code))));
    void exited.catch(() => {});
    return { child, ready, done, exited };
  }
  try {
    evidence.inputs = { legacy: sourceManifest(fixture.legacy), current: sourceManifest(fixture.current) };
    evidence.node = process.version;
    evidence.postgres = (await pool.query("SHOW server_version_num")).rows[0].server_version_num;
    assert.ok(Number(evidence.postgres) >= 170000 && Number(evidence.postgres) < 180000);
    const legacyBefore = (await pool.query("SELECT * FROM mail_outbox ORDER BY id")).rows;
    assert.equal(legacyBefore.length, 1); assert.equal(legacyBefore[0].id, 1); assert.equal(legacyBefore[0].status, "pending");
    const migrator = launch("migration"); await migrator.ready; migrator.child.send("complete"); await migrator.done; await migrator.exited;
    await pool.query("CREATE TABLE fixture_queue_effects(scope text NOT NULL,identity text NOT NULL,queue_id integer,PRIMARY KEY(scope,identity))");
    assert.equal(fixture.migrationUser, "fixture");
    const ownership = await moduleAt(fixture.current, "batch-runtime-ownership");
    const migrationPool = new Pool({ host: fixture.socket, database: fixture.database, user: fixture.migrationUser, password: fixture.migrationPassword, max: 1 });
    const migrationClient = await migrationPool.connect();
    try { await ownership.installBatchRuntimeOwnership(migrationClient, { legacy: fixture.user, v2: fixture.runtimeUser, migration: fixture.migrationUser }); }
    finally { migrationClient.release(); await migrationPool.end(); }
    evidence.checks.push("batch-runtime-role-bindings-installed-before-application-start");
    const readiness = await moduleAt(fixture.current, "db-schema-readiness");
    const catalogBeforeRestart = await readiness.schemaFingerprint(pool);
    const old = launch("legacy"); await old.ready;
    assert.equal(await readiness.schemaFingerprint(pool), catalogBeforeRestart, "legacy restart changed the prepared schema contract");
    evidence.checks.push("legacy-restart-preserves-prepared-schema-contract");
    assert.equal(fixture.runtimeUser, "fixture_runtime");
    // The dedicated migration identity owns the binding table and grants both
    // application tables and the explicit read-only exceptions atomically.
    const grants = new Pool({ host: fixture.socket, database: fixture.database, user: fixture.migrationUser, password: fixture.migrationPassword, max: 1 });
    try { await grants.query("GRANT USAGE ON SCHEMA public TO fixture_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO fixture_runtime; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO fixture_runtime; REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON mail_outbox,application_runtime_roles FROM fixture_runtime"); }
    finally { await grants.end(); }
    const runtime = new Pool({ host: fixture.socket, database: fixture.database, user: fixture.runtimeUser, password: fixture.runtimePassword, max: 1 });
    try {
      fixture.expectedSchemaHash = await readiness.schemaFingerprint(pool);
      await assert.rejects(readiness.verifyRuntimeSchema(pool, fixture.expectedSchemaHash), /runtime_role_has_ddl_authority/);
      await assert.rejects(readiness.verifyRuntimeSchema(runtime, undefined), /runtime_schema_hash_required/);
      await readiness.verifyRuntimeSchema(runtime, fixture.expectedSchemaHash);
      await pool.query("ALTER TABLE fixture_queue_effects ADD COLUMN drift_probe integer");
      await assert.rejects(readiness.verifyRuntimeSchema(runtime, fixture.expectedSchemaHash), /runtime_schema_fingerprint_mismatch/);
      await pool.query("ALTER TABLE fixture_queue_effects DROP COLUMN drift_probe");
      await readiness.verifyRuntimeSchema(runtime, fixture.expectedSchemaHash);
    } finally { await runtime.end(); }
    evidence.checks.push("runtime-owner-role-refused", "runtime-without-reviewed-hash-refused", "catalog-drift-refused-and-reviewed-shape-restored");
    writeFileSync(configFile, JSON.stringify(fixture, null, 2));
    const modern = launch("v2"); const ready = await modern.ready;
    assert.equal(ready.queueId, 1); // Deliberate ID collision across the two tables.
    assert.deepEqual((await pool.query("SELECT * FROM mail_outbox ORDER BY id")).rows, legacyBefore);
    evidence.checks.push("same-ID-v2-enqueue-does-not-touch-legacy-queue");
    assert.ok(ready.unknownBlocked); evidence.checks.push("v2-unknown-result-refuses-automatic-replay");
    assert.ok(ready.rejectionAccepted); evidence.checks.push("v2-proven-rejection-still-allows-failover");
    old.child.send("drain"); modern.child.send("drain");
    const [oldDone, newDone] = await Promise.all([old.done, modern.done]);
    await Promise.all([old.exited, modern.exited]);
    assert.equal(oldDone.result.sent, 1); assert.equal(newDone.result.sent, 1); assert.equal(newDone.recovered.sent, 1);
    const effects = (await pool.query("SELECT scope,identity,queue_id FROM fixture_queue_effects ORDER BY scope")).rows;
    assert.equal(effects.length, 4);
    assert.equal(effects.find(row => row.scope === "legacy").identity, "nobody@fixture.invalid");
    assert.equal(effects.find(row => row.scope === "v2").identity, "v2@fixture.invalid");
    evidence.checks.push("two-real-runtimes-drain-only-their-own-rows", "accepted-journal-recovers-lost-queue-ack-without-repeat");
    assert.equal(await readiness.schemaFingerprint(pool), fixture.expectedSchemaHash, "runtime changed schema");
    evidence.checks.push("v2-executes-with-prepared-schema-and-no-ddl-authority");
    // Diagnostics must see legacy pending work without being able to consume it.
    await pool.query("INSERT INTO mail_outbox(kind,to_addr,payload) VALUES('confirmacao','legacy-pending@fixture.invalid','{}')");
    await pool.query("INSERT INTO mail_outbox_v2(kind,to_addr,payload) VALUES('confirmacao','v2-pending@fixture.invalid','{}')");
    const beforeDiagnostic = (await pool.query("SELECT id,status,payload FROM mail_outbox ORDER BY id")).rows;
    const scopeModule = await moduleAt(fixture.current, "mail/queue-scope");
    const priorScope = process.env.MAIL_QUEUE_SCOPE; process.env.MAIL_QUEUE_SCOPE = "v2";
    const diagnosticPool = new Pool({ host: fixture.socket, database: fixture.database, user: fixture.runtimeUser, password: fixture.runtimePassword, max: 1 });
    try {
      const pending = (await diagnosticPool.query(`SELECT to_addr FROM ${scopeModule.mailQueueEvidenceTable()} q WHERE status='pending' ORDER BY to_addr`)).rows;
      assert.deepEqual(pending.map(row => row.to_addr), ["legacy-pending@fixture.invalid", "v2-pending@fixture.invalid"]);
      await assert.rejects(diagnosticPool.query("UPDATE mail_outbox SET status='sent' WHERE status='pending'"), /permission denied/);
    } finally {
      await diagnosticPool.end();
      if (priorScope === undefined) delete process.env.MAIL_QUEUE_SCOPE; else process.env.MAIL_QUEUE_SCOPE = priorScope;
    }
    assert.deepEqual((await pool.query("SELECT id,status,payload FROM mail_outbox ORDER BY id")).rows, beforeDiagnostic);
    evidence.checks.push("diagnostics-see-both-queues-without-mutating-legacy", "runtime-cannot-update-legacy-queue");
    assert.deepEqual(sourceManifest(fixture.legacy), evidence.inputs.legacy);
    assert.deepEqual(sourceManifest(fixture.current), evidence.inputs.current);
    evidence.checks.push("all-source-inputs-hashed-and-unchanged-during-test");
    evidence.effects = effects; evidence.workerResults = [oldDone, newDone]; evidence.exit = 0;
  } catch (error) {
    evidence.errors.push(String(error.stack ?? error)); evidence.exit = 1; process.exitCode = 1;
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
    await pool.end();
    writeFileSync(resolve(fixture.output, "queue-result.json"), JSON.stringify(evidence, null, 2) + "\n");
    console.log(JSON.stringify({ exit: evidence.exit, checks: evidence.checks.length, result: resolve(fixture.output, "queue-result.json") }));
  }
}
