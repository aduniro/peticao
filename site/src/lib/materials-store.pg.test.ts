import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Importing this file without the exact fixture opt-in never imports pg/db/store.
const explicit = process.env.MATERIALS_PG_FIXTURE === "materials-library-pg17-isolated-v1";
const options = { skip: explicit ? false : "requires an explicit isolated PG17 fixture", concurrency: false };
const FIXTURE_URL = "postgres://fixture_only:fixture_only@127.0.0.1:55496/fixture_only";
type Db = typeof import("./db");
type Store = typeof import("./materials-store");
type Actor = { userId: number; sessaoId: number; email: string };
type Content = import("./materials-contract").MaterialContent;
type Fixture = { db: Db; store: Store; actors: Actor[]; secondSession: Actor; snapshot: () => Promise<unknown[]> };
const content = (suffix = "base"): Content => ({ template: "poster-a4-v1", assetKey: "adunir", title: "QA Material " + suffix, body: "Texto fictício\nem duas linhas 🟢", callToAction: "Ação fictícia", footer: "QA only" });
function admitFixture() {
  assert.equal(process.env.MATERIALS_PG_FIXTURE, "materials-library-pg17-isolated-v1");
  assert.equal(process.env.DATABASE_URL, FIXTURE_URL);
  assert.match(process.env.MATERIALS_PG_FIXTURE_NONCE ?? "", /^[a-f0-9]{12}$/);
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.equal(process.env.MAIL_PROVIDERS, "dev");
  assert.equal(process.env.MATERIALS_LIBRARY_ENABLED, "1");
  assert.equal(process.env.APPROVER_EMAIL, ""); assert.equal(process.env.RECIPIENTS, "");
  assert.equal(process.env.SIGNER, "none"); assert.equal(process.env.DATABASE_SCHEMA, undefined);
  const state = globalThis as unknown as { __pool?: unknown; __ready?: unknown };
  assert.ok(!state.__pool && !state.__ready, "dedicated process, no inherited app pool or schema");
  return process.env.MATERIALS_PG_FIXTURE_NONCE!;
}
async function withFixture(body: (c: Fixture) => Promise<void>) {
  const nonce = admitFixture();
  const { Client } = await import("pg");
  const bootstrap = new Client({ connectionString: FIXTURE_URL, connectionTimeoutMillis: 3000, query_timeout: 5000 });
  let connected = false, created = false, db: Db | undefined;
  const schema = "t_materials_" + nonce + "_" + randomUUID().replaceAll("-", "").slice(0, 12);
  const marker = "materials-qa:" + nonce + ":" + schema;
  assert.match(schema, /^t_materials_[a-f0-9]{12}_[a-f0-9]{12}$/);
  const identity = async () => {
    const value = (await bootstrap.query("SELECT current_setting('server_version_num') version,current_database() database,current_user username,current_setting('cluster_name') nonce,current_setting('data_directory') data_directory")).rows[0];
    assert.deepEqual(value, { version: "170011", database: "fixture_only", username: "fixture_only", nonce, data_directory: "/var/lib/postgresql/data" });
  };
  try {
    await bootstrap.connect(); connected = true; await identity();
    // Never DROP/IF NOT EXISTS at admission: collision fails without touching any schema.
    await bootstrap.query(`CREATE SCHEMA ${schema}`); created = true;
    await bootstrap.query(`COMMENT ON SCHEMA ${schema} IS '${marker}'`);
    process.env.DATABASE_SCHEMA = schema;
    db = await import("./db");
    await db.query("SELECT 1"); // Actual cumulative base DDL/seeds, only in this nonce-owned schema.
    const { MATERIALS_SCHEMA_SQL } = await import("./materials-schema");
    await db.query(MATERIALS_SCHEMA_SQL);
    const actors: Actor[] = [
      { userId: 1, sessaoId: 1, email: "materials-one@fixture.invalid" },
      { userId: 2, sessaoId: 2, email: "materials-two@fixture.invalid" },
      { userId: 3, sessaoId: 3, email: "materials-reader@fixture.invalid" },
    ];
    for (const actor of actors) {
      await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash) VALUES($1,$2,'QA Materials',$3,'QA-NOT-A-LOGIN-HASH')", [actor.userId, actor.email, actor.userId === 3 ? "leitura" : "edicao"]);
      await db.query("INSERT INTO admin_sessions(id,user_id,token_hash,expira_em) VALUES($1,$2,$3,clock_timestamp()+interval '10 minutes')", [actor.sessaoId, actor.userId, "QA-MATERIAL-SESSION-" + actor.sessaoId]);
    }
    await db.query("INSERT INTO admin_sessions(id,user_id,token_hash,expira_em) VALUES(4,1,'QA-MATERIAL-SESSION-4',clock_timestamp()+interval '10 minutes')");
    const activeDb = db;
    const snapshot = async () => {
      const rows: unknown[] = [];
      for (const table of ["campaign_materials", "campaign_material_versions", "campaign_material_requests", "audit_log"]) rows.push((await activeDb.query(`SELECT to_jsonb(t) value FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows);
      return rows;
    };
    const store = await import("./materials-store");
    await body({ db, store, actors, secondSession: { ...actors[0], sessaoId: 4 }, snapshot });
    assert.ok((await db.verifyAuditChain()).ok, "real audit hash chain");
    for (const table of ["mail_messages", "mail_message_attempts", "mail_outbox", "batch_sends", "batches", "signatures"]) assert.equal((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n, 0, "materials must not create " + table);
  } finally {
    try {
      if (created) {
        assert.equal(process.env.DATABASE_URL, FIXTURE_URL, "never clean a changed target");
        await identity();
        const owner = (await bootstrap.query("SELECT nspowner::regrole::text owner,obj_description(oid,'pg_namespace') marker FROM pg_namespace WHERE nspname=$1", [schema])).rows[0];
        assert.deepEqual(owner, { owner: "fixture_only", marker }, "only this exact newly created schema may be removed");
        assert.equal(process.env.DATABASE_SCHEMA, schema);
        if (db) await db._closeDbForTests();
        else { await bootstrap.query(`DROP SCHEMA ${schema} CASCADE`); delete process.env.DATABASE_SCHEMA; }
        assert.equal((await bootstrap.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [schema])).rowCount, 0);
      }
    } finally { if (connected) await bootstrap.end(); }
  }
}
async function create(c: Fixture, actor = c.actors[0], value = content()) {
  const requestId = randomUUID(), result = await c.store.mutateMaterial({ operation: "create", requestId, content: value }, actor);
  assert.ok(result.ok); assert.equal(result.replayed, false); return { ...result, requestId };
}

test("materials PG17: additive DDL twice, real JSONB hash roundtrip and exact head FK", options, async () => withFixture(async c => {
  const made = await create(c), beforeDdl = await c.snapshot();
  const { MATERIALS_SCHEMA_SQL } = await import("./materials-schema"); await c.db.query(MATERIALS_SCHEMA_SQL);
  assert.deepEqual(await c.snapshot(), beforeDdl, "second additive DDL preserves populated records");
  const { materialDigest } = await import("./materials-contract");
  assert.deepEqual(made.version.content, content()); assert.equal(made.version.sha256, materialDigest(content())); assert.equal(made.version.authorId, 1);
  const head = (await c.db.query("SELECT revision,current_version,archived FROM campaign_materials WHERE id=$1", [made.version.materialId])).rows[0];
  assert.deepEqual(head, { revision: 1, current_version: made.version.id, archived: false });
  const other = await create(c, c.actors[1], content("other")); const before = await c.snapshot();
  await assert.rejects(c.db.tx(client => client.query("UPDATE campaign_materials SET revision=revision+1,current_version=$2 WHERE id=$1", [made.version.materialId, other.version.id])), /foreign key|campaign_material_head_version_fk/i);
  assert.deepEqual(await c.snapshot(), before);
}));

test("materials PG17: two actors racing one CAS revision append exactly one version", options, async () => withFixture(async c => {
  const made = await create(c), id = made.version.materialId;
  const results = await Promise.all(c.actors.slice(0, 2).map((actor, n) => c.store.mutateMaterial({ operation: "revise", requestId: randomUUID(), materialId: id, expectedRevision: 1, content: content("race" + n) }, actor)));
  assert.equal(results.filter(v => v.ok).length, 1); assert.equal(results.filter(v => !v.ok && v.error === "conflict").length, 1);
  const history = await c.store.materialHistory(id, c.actors[2], null); assert.ok(history.ok);
  assert.deepEqual(history.versions.map(v => v.revision), [2, 1]); assert.equal(history.current.revision, 2);
  assert.equal((await c.db.query("SELECT count(*)::int n FROM campaign_material_requests")).rows[0].n, 2);
  assert.equal((await c.db.query("SELECT count(*)::int n FROM audit_log WHERE event='campaign_material_revise'")).rows[0].n, 1);
}));

test("materials PG17: concurrent same actor intent is durable and scoped, replay returns original version", options, async () => withFixture(async c => {
  const input = { operation: "create", requestId: randomUUID(), content: content() };
  const admitted = await Promise.all([c.store.mutateMaterial(input, c.actors[0]), c.store.mutateMaterial(input, c.secondSession)]);
  assert.ok(admitted[0].ok && admitted[1].ok); assert.equal(admitted[0].version.id, admitted[1].version.id);
  assert.deepEqual(admitted.map(v => v.ok && v.replayed).sort(), [false, true]);
  const first = admitted[0].version;
  assert.deepEqual(await c.store.readMaterialRequest(input.requestId, c.actors[1]), { ok: false, error: "not_found" });
  const revised = await c.store.mutateMaterial({ operation: "revise", requestId: randomUUID(), materialId: first.materialId, expectedRevision: 1, content: content("second") }, c.actors[0]); assert.ok(revised.ok);
  const stable = await c.snapshot();
  const replay = await c.store.mutateMaterial(input, c.actors[0]); assert.ok(replay.ok); assert.equal(replay.replayed, true); assert.deepEqual(replay.version, first);
  const recovered = await c.store.readMaterialRequest(input.requestId, c.actors[0]); assert.ok(recovered.ok); assert.deepEqual(recovered.version, first);
  assert.deepEqual(await c.store.mutateMaterial({ ...input, content: content("changed") }, c.actors[0]), { ok: false, error: "request_conflict" });
  assert.deepEqual(await c.snapshot(), stable);
  const separate = await c.store.mutateMaterial(input, c.actors[1]); assert.ok(separate.ok); assert.notEqual(separate.version.materialId, first.materialId);
  assert.equal((await c.db.query("SELECT count(*)::int n FROM campaign_materials")).rows[0].n, 2);
}));

test("materials PG17: audit failure atomically rolls back create and revise, without orphan receipt", options, async () => withFixture(async c => {
  const fault = async () => c.db.query("CREATE FUNCTION qa_material_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event LIKE 'campaign_material_%' THEN RAISE EXCEPTION 'QA_MATERIAL_AUDIT_FAILED'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_material_audit_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_material_audit_fault()");
  const unfault = async () => c.db.query("DROP TRIGGER qa_material_audit_fault ON audit_log; DROP FUNCTION qa_material_audit_fault()");
  const empty = await c.snapshot(); await fault();
  try { await assert.rejects(create(c), /QA_MATERIAL_AUDIT_FAILED/); } finally { await unfault(); }
  assert.deepEqual(await c.snapshot(), empty);
  const made = await create(c), before = await c.snapshot(); await fault();
  try { await assert.rejects(c.store.mutateMaterial({ operation: "revise", requestId: randomUUID(), materialId: made.version.materialId, expectedRevision: 1, content: content("rollback") }, c.actors[0]), /QA_MATERIAL_AUDIT_FAILED/); } finally { await unfault(); }
  assert.deepEqual(await c.snapshot(), before);
}));

test("materials PG17: store revalidates role, live session and identity before admission", options, async () => withFixture(async c => {
  const made = await create(c), before = await c.snapshot();
  const mutate = (actor: Actor | null) => c.store.mutateMaterial({ operation: "revise", requestId: randomUUID(), materialId: made.version.materialId, expectedRevision: 1, content: content("not admitted") }, actor);
  for (const actor of [null, c.actors[2], { ...c.actors[0], sessaoId: 2 }, { ...c.actors[0], email: "forged@fixture.invalid" }]) assert.deepEqual(await mutate(actor), { ok: false, error: "forbidden" });
  await c.db.query("UPDATE admin_users SET nivel='leitura' WHERE id=1"); assert.deepEqual(await mutate(c.actors[0]), { ok: false, error: "forbidden" });
  assert.ok((await c.store.materialHistory(made.version.materialId, c.actors[0], null)).ok); await c.db.query("UPDATE admin_users SET nivel='edicao' WHERE id=1");
  for (const [revoke, restore] of [
    ["UPDATE admin_users SET ativo=false WHERE id=1", "UPDATE admin_users SET ativo=true WHERE id=1"],
    ["UPDATE admin_users SET trocar_senha=true WHERE id=1", "UPDATE admin_users SET trocar_senha=false WHERE id=1"],
    ["UPDATE admin_sessions SET expira_em=clock_timestamp()-interval '1 second' WHERE id=1", "UPDATE admin_sessions SET expira_em=clock_timestamp()+interval '10 minutes' WHERE id=1"],
  ]) {
    await c.db.query(revoke); assert.deepEqual(await mutate(c.actors[0]), { ok: false, error: "forbidden" });
    assert.deepEqual(await c.store.readMaterialRequest(made.requestId, c.actors[0]), { ok: false, error: "forbidden" }); await c.db.query(restore);
  }
  await c.db.query("DELETE FROM admin_sessions WHERE id=1"); assert.deepEqual(await mutate(c.actors[0]), { ok: false, error: "forbidden" });
  assert.deepEqual(await c.snapshot(), before);
}));

test("materials PG17: archive appends history and UPDATE/DELETE guards preserve versions and receipts", options, async () => withFixture(async c => {
  const made = await create(c), id = made.version.materialId;
  const archived = await c.store.mutateMaterial({ operation: "archive", requestId: randomUUID(), materialId: id, expectedRevision: 1 }, c.actors[1]); assert.ok(archived.ok);
  assert.equal(archived.version.archived, true); assert.equal(archived.version.revision, 2); assert.deepEqual(archived.version.content, made.version.content);
  const before = await c.snapshot();
  for (const sql of ["UPDATE campaign_material_versions SET archived=NOT archived", "DELETE FROM campaign_material_versions", "DELETE FROM campaign_material_requests", "UPDATE campaign_material_requests SET fingerprint=repeat('f',64)"]) await assert.rejects(c.db.query(sql), /campaign_material_history_immutable/);
  await assert.rejects(c.db.query("DELETE FROM campaign_materials"), /campaign_material_archive_only/);
  await assert.rejects(c.db.query("UPDATE campaign_materials SET revision=revision+1,current_version=gen_random_uuid()"), /campaign_material_invalid_revision/);
  assert.deepEqual(await c.store.mutateMaterial({ operation: "revise", requestId: randomUUID(), materialId: id, expectedRevision: 2, content: content("no restore") }, c.actors[0]), { ok: false, error: "archived" });
  const history = await c.store.materialHistory(id, c.actors[2], null); assert.ok(history.ok); assert.deepEqual(history.versions.map(v => [v.revision, v.archived]), [[2, true], [1, false]]);
  assert.deepEqual(await c.snapshot(), before);
}));

test("materials PG17: library UUID pagination has no overlap and separates archived heads", options, async () => withFixture(async c => {
  const made: Awaited<ReturnType<typeof create>>[] = []; for (let n = 0; n < 52; n++) made.push(await create(c, c.actors[0], content("page" + n)));
  const archived = await c.store.mutateMaterial({ operation: "archive", requestId: randomUUID(), materialId: made[0].version.materialId, expectedRevision: 1 }, c.actors[0]); assert.ok(archived.ok);
  const before = await c.snapshot(), first = await c.store.listMaterials(c.actors[2], false, null); assert.ok(first.ok); assert.equal(first.versions.length, 50); assert.equal(first.nextBefore, first.versions[49].materialId);
  const second = await c.store.listMaterials(c.actors[2], false, first.nextBefore); assert.ok(second.ok); assert.equal(second.versions.length, 1); assert.equal(second.nextBefore, null);
  const ids = [...first.versions, ...second.versions].map(v => v.materialId); assert.equal(new Set(ids).size, 51); assert.deepEqual(ids, [...ids].sort().reverse()); assert.ok(!ids.includes(made[0].version.materialId));
  const hidden = await c.store.listMaterials(c.actors[2], true, null); assert.ok(hidden.ok); assert.deepEqual(hidden.versions.map(v => v.materialId), [made[0].version.materialId]); assert.equal(hidden.nextBefore, null);
  assert.deepEqual(await c.snapshot(), before);
}));

test("materials PG17: ordinal history pagination preserves current head and all old revisions", options, async () => withFixture(async c => {
  const made = await create(c); for (let revision = 1; revision <= 50; revision++) { const result = await c.store.mutateMaterial({ operation: "revise", requestId: randomUUID(), materialId: made.version.materialId, expectedRevision: revision, content: content("revision" + (revision + 1)) }, c.actors[0]); assert.ok(result.ok); }
  const before = await c.snapshot(), first = await c.store.materialHistory(made.version.materialId, c.actors[2], null); assert.ok(first.ok); assert.equal(first.current.revision, 51); assert.deepEqual(first.versions.map(v => v.revision), Array.from({ length: 50 }, (_, n) => 51 - n)); assert.equal(first.nextBefore, 2);
  const second = await c.store.materialHistory(made.version.materialId, c.actors[2], first.nextBefore); assert.ok(second.ok); assert.equal(second.current.revision, 51); assert.deepEqual(second.versions.map(v => v.revision), [1]); assert.equal(second.nextBefore, null);
  assert.deepEqual(await c.snapshot(), before);
}));

test("materials PG17: disabling feature preserves existing records and rejects every entry point", options, async () => withFixture(async c => {
  const made = await create(c), before = await c.snapshot(); process.env.MATERIALS_LIBRARY_ENABLED = "0";
  try {
    for (const result of [await c.store.mutateMaterial({ operation: "create", requestId: randomUUID(), content: content() }, c.actors[0]), await c.store.readMaterialRequest(made.requestId, c.actors[0]), await c.store.listMaterials(c.actors[0], false, null), await c.store.materialHistory(made.version.materialId, c.actors[0], null)]) assert.deepEqual(result, { ok: false, error: "disabled" });
  } finally { process.env.MATERIALS_LIBRARY_ENABLED = "1"; }
  assert.deepEqual(await c.snapshot(), before);
}));
