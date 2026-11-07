import test from "node:test";
import assert from "node:assert/strict";
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";

async function setup() {
  const db = await import("./db"); await db._openForTests("t_email_atomic");
  const E = await import("./assinaturas-email"), M = await import("./email-check"), S = await import("./security"), U = await import("./admin-users");
  const user = await U.criarUsuario({ email: "editor-atomic@example.test", nome: "QA editor", nivel: "edicao", senha: "QA-Atomic-Correction-2026" }); assert.ok(user.ok);
  const actor = { userId: user.usuario.id, email: user.usuario.email };
  const make = async (n: number) => (await db.query<{ id: number }>(`INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,created_at,seq,verify_code)
    VALUES('Pessoa Fictícia',$1,$2,$3,'apoiador','fixture','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z',$4,$5) RETURNING id`, [`qa-old-${n}@gmail.com`, S.hmac(M.dedupEmail(`qa-old-${n}@gmail.com`)), `qa-cpf-${n}`, 500 + n, `qa-code-${n}`])).rows[0].id;
  const proof = async (id: number) => (await db.query("SELECT row_to_json(s)::text AS value FROM signatures s WHERE id=$1", [id])).rows[0].value;
  const close = async () => { M._setMxResolverForTests(null); await db._closeDbForTests(); };
  return { db, E, M, actor, make, proof, close };
}

test("email correction cannot change a signature confirmed during DNS validation", async () => {
  const c = await setup();
  try {
    const id = await c.make(1); let after = "";
    c.M._setMxResolverForTests(async () => { await c.db.query("UPDATE signatures SET status='confirmed',confirmed_at='2026-11-07T12:00:00Z' WHERE id=$1", [id]); after = await c.proof(id); return "ok"; });
    const r = await c.E.corrigirEmail(id, "qa-new@gmail.com", c.actor);
    assert.equal(r.ok, false); assert.deepEqual(await c.proof(id), after);
    assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='email_corrigido'")).rowCount, 0);
  } finally { await c.close(); }
});

test("concurrent corrections from the same version produce one success without overwriting", async () => {
  const c = await setup();
  try {
    const id = await c.make(1); let arrived = 0; let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    c.M._setMxResolverForTests(async () => { if (++arrived === 2) release(); await barrier; return "ok"; });
    const results = await Promise.all([c.E.corrigirEmail(id, "qa-first@gmail.com", c.actor), c.E.corrigirEmail(id, "qa-second@gmail.com", c.actor)]);
    assert.equal(results.filter(r => r.ok).length, 1);
    assert.equal(results.filter(r => !r.ok && r.code === "conflict").length, 1);
    const winning = results.find(r => r.ok)!; assert.ok(winning.ok);
    assert.equal((await c.db.query("SELECT email FROM signatures WHERE id=$1", [id])).rows[0].email, winning.email);
    assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='email_corrigido'")).rowCount, 1);
  } finally { await c.close(); }
});

test("email correction rolls back when its audit cannot be written", async () => {
  const c = await setup();
  try {
    const id = await c.make(1), before = await c.proof(id);
    c.M._setMxResolverForTests(async () => "ok");
    await c.db.query("CREATE FUNCTION fail_email_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='email_corrigido' THEN RAISE EXCEPTION 'QA'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_email_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_email_audit()");
    await assert.rejects(c.E.corrigirEmail(id, "qa-new@gmail.com", c.actor));
    assert.deepEqual(await c.proof(id), before);
  } finally { await c.close(); }
});

test("actor revocation during validation prevents the email mutation", async () => {
  const c = await setup();
  try {
    const id = await c.make(1), before = await c.proof(id);
    c.M._setMxResolverForTests(async () => { await c.db.query("UPDATE admin_users SET nivel='leitura' WHERE id=$1", [c.actor.userId]); return "ok"; });
    const r = await c.E.corrigirEmail(id, "qa-new@gmail.com", c.actor);
    assert.ok(!r.ok); assert.equal(r.code, "forbidden"); assert.deepEqual(await c.proof(id), before);
  } finally { await c.close(); }
});

test("unrelated signer changes during validation invalidate the original correction", async () => {
  const c = await setup();
  try {
    const id = await c.make(1); let after = "";
    c.M._setMxResolverForTests(async () => { await c.db.query("UPDATE signatures SET institution='QA nova instituição' WHERE id=$1", [id]); after = await c.proof(id); return "ok"; });
    const r = await c.E.corrigirEmail(id, "qa-new@gmail.com", c.actor);
    assert.ok(!r.ok); assert.equal(r.code, "conflict"); assert.deepEqual(await c.proof(id), after);
  } finally { await c.close(); }
});


test("a suggestion computed from an obsolete email cannot be applied to its replacement", async () => {
  const c = await setup();
  try {
    const id = await c.make(1); await c.db.query("UPDATE signatures SET email='qa-old@unir.bf',category='servidor' WHERE id=$1", [id]);
    let changed = false, after = "";
    c.M._setMxResolverForTests(async domain => {
      if (!changed) { changed = true; await c.db.query("UPDATE signatures SET email='qa-replacement@unir.br' WHERE id=$1", [id]); after = await c.proof(id); }
      return domain === "unir.bf" ? "none" : "ok";
    });
    const r = await c.E.aceitarSugestao(id, c.actor);
    assert.ok(!r.ok); assert.equal(r.code, "conflict"); assert.deepEqual(await c.proof(id), after);
  } finally { await c.close(); }
});

test("a concurrent unique email claim returns the existing duplicate error without partial updates", async () => {
  const c = await setup();
  try {
    const ids = [await c.make(1), await c.make(2)], before = await Promise.all(ids.map(c.proof));
    c.M._setMxResolverForTests(async () => "ok");
    let operations!: Promise<Awaited<ReturnType<typeof c.E.corrigirEmail>>[]>;
    await c.db.tx(async blocker => {
      await blocker.query("SELECT id FROM signatures WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE", [ids]);
      operations = Promise.all(ids.map(id => c.E.corrigirEmail(id, "qa-shared@gmail.com", c.actor)));
      const deadline = Date.now() + 10000;
      while (true) {
        await blocker.query("SELECT pg_stat_clear_snapshot()");
        const waiting = await blocker.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND state='active' AND wait_event_type='Lock' AND query LIKE 'SELECT status,xmin::text AS version FROM signatures%'");
        if (waiting.rows[0].n >= 2) break;
        assert.ok(Date.now() < deadline, "both corrections must have passed preliminary validation");
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    });
    const results = await operations;
    assert.equal(results.filter(r => r.ok).length, 1);
    assert.equal(results.filter(r => !r.ok && r.erro === "Já existe outro cadastro com este e-mail.").length, 1);
    for (let i = 0; i < ids.length; i++) if (!results[i].ok) assert.equal(await c.proof(ids[i]), before[i]);
    assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='email_corrigido'")).rowCount, 1);
  } finally { await c.close(); }
});
