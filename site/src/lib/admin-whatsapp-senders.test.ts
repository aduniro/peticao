import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.DATA_ENCRYPTION_KEY = "QA-ONLY-SENDERS-ENCRYPTION-NOT-PRODUCTION";
delete process.env.PREVIEW_MODE; delete process.env.ADMIN_NO_PASSWORD;
const password = "QA-Sender-Management-2026";
async function setup() {
  const db = await import("./db"); await db._openForTests("t_admin_whatsapp_senders");
  const U = await import("./admin-users"), S = await import("./admin-whatsapp-senders");
  const owner = await U.criarUsuario({ email: "sender-owner@example.test", nome: "Gestor QA", nivel: "total", senha: password });
  assert.ok(owner.ok);
  return { db, U, S, actor: { userId: owner.usuario.id, email: owner.usuario.email } };
}
const input = { action: "add" as const, label: "Remetente QA", ddi: "55", number: "69999990000" };

test("cadastro cifra telefone por ID e audita autoria sem texto do telefone", async () => {
  const c = await setup();
  try {
    const added = await c.S.manageSender(c.actor, input); assert.ok(added.ok);
    const row = (await c.db.query("SELECT * FROM whatsapp_senders WHERE id=$1", [added.id])).rows[0];
    const { decifrar } = await import("./crypto-dados");
    assert.equal(decifrar(row.phone_cipher, `wa-sender:${added.id}`), "5569999990000");
    assert.equal(decifrar(row.phone_cipher, `wa-sender:${added.id + 1}`), null);
    assert.ok(!row.phone_cipher.includes(input.number));
    assert.equal(row.revision, 1); assert.equal(row.archived_at, null);
    const data = JSON.parse((await c.db.query("SELECT data FROM audit_log WHERE event='whatsapp_sender_added'")).rows[0].data);
    assert.equal(data.userId, c.actor.userId); assert.equal(data.por, c.actor.email);
    assert.equal(data.final, "0000"); assert.ok(!JSON.stringify(data).includes(input.number));
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("arquivar preserva identidade, cifra e datas; restaurar exige versão atual", async () => {
  const c = await setup();
  try {
    const added = await c.S.manageSender(c.actor, input); assert.ok(added.ok);
    const before = (await c.db.query("SELECT * FROM whatsapp_senders WHERE id=$1", [added.id])).rows[0];
    assert.deepEqual(await c.S.manageSender(c.actor, { action: "remove", id: added.id, revision: 1 }), { ok: true, id: added.id, revision: 2 });
    const archived = (await c.db.query("SELECT * FROM whatsapp_senders WHERE id=$1", [added.id])).rows[0];
    assert.ok(archived.archived_at);
    assert.deepEqual({ ...archived, revision: 1, archived_at: null }, before);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM whatsapp_senders WHERE archived_at IS NULL")).rows[0].n, 0);
    for (const action of ["toggle", "remove", "restore"] as const) assert.deepEqual(await c.S.manageSender(c.actor, { action, id: added.id, revision: 1 }), { ok: false, erro: "conflict" });
    assert.deepEqual(await c.S.manageSender(c.actor, { action: "toggle", id: added.id, revision: 2 }), { ok: false, erro: "conflict" });
    assert.deepEqual(await c.S.manageSender(c.actor, { action: "restore", id: added.id, revision: 2 }), { ok: true, id: added.id, revision: 3 });
    const restored = (await c.db.query("SELECT * FROM whatsapp_senders WHERE id=$1", [added.id])).rows[0];
    assert.deepEqual({ ...restored, revision: 1 }, before);
    assert.deepEqual(await c.S.manageSender(c.actor, { action: "restore", id: added.id, revision: 3 }), { ok: false, erro: "conflict" });
    assert.equal((await c.db.query("SELECT count(*)::int n FROM audit_log WHERE event IN ('whatsapp_sender_removed','whatsapp_sender_restored')")).rows[0].n, 2);
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("falha de auditoria reverte criação, alternância, arquivamento e restauração", async () => {
  const c = await setup();
  try {
    const added = await c.S.manageSender(c.actor, input); assert.ok(added.ok);
    const snapshot = async () => (await c.db.query("SELECT row_to_json(s)::text raw FROM whatsapp_senders s ORDER BY id")).rows;
    const before = await snapshot();
    await c.db.query(`CREATE FUNCTION fail_sender_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event LIKE 'whatsapp_sender_%' THEN RAISE EXCEPTION 'sender audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_sender_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_sender_audit()`);
    await assert.rejects(c.S.manageSender(c.actor, input), /sender audit failure/);
    for (const action of ["toggle", "remove"] as const) await assert.rejects(c.S.manageSender(c.actor, { action, id: added.id, revision: 1 }), /sender audit failure/);
    assert.deepEqual(await snapshot(), before);
    await c.db.query("DROP TRIGGER fail_sender_audit ON audit_log");
    assert.ok((await c.S.manageSender(c.actor, { action: "remove", id: added.id, revision: 1 })).ok);
    const archived = await snapshot();
    await c.db.query("CREATE TRIGGER fail_sender_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_sender_audit()");
    await assert.rejects(c.S.manageSender(c.actor, { action: "restore", id: added.id, revision: 2 }), /sender audit failure/);
    assert.deepEqual(await snapshot(), archived);
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("conta revogada ou divergente não altera remetentes nem cria auditoria", async () => {
  const c = await setup();
  try {
    const added = await c.S.manageSender(c.actor, input); assert.ok(added.ok);
    const before = (await c.db.query("SELECT row_to_json(s)::text raw FROM whatsapp_senders s")).rows;
    for (const update of ["nivel='edicao'", "nivel='total',ativo=false", "nivel='total',ativo=true,email='changed@example.test'"]) {
      await c.db.query(`UPDATE admin_users SET ${update} WHERE id=$1`, [c.actor.userId]);
      assert.deepEqual(await c.S.manageSender(c.actor, input), { ok: false, erro: "forbidden" });
      assert.deepEqual(await c.S.manageSender(c.actor, { action: "remove", id: added.id, revision: 1 }), { ok: false, erro: "forbidden" });
    }
    assert.deepEqual((await c.db.query("SELECT row_to_json(s)::text raw FROM whatsapp_senders s")).rows, before);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM audit_log WHERE event LIKE 'whatsapp_sender_%'")).rows[0].n, 1);
  } finally { await c.db._closeDbForTests(); }
});

test("concorrência respeita limite de20 inclusive na restauração", async () => {
  const c = await setup();
  try {
    await c.db.query("INSERT INTO whatsapp_senders(label,phone_cipher,phone_last4) SELECT 'QA capacity '||n,'QA-FIXTURE-NOT-PHONE','0000' FROM generate_series(1,19) n");
    const results = await Promise.all(Array.from({ length: 5 }, () => c.S.manageSender(c.actor, input)));
    assert.equal(results.filter(r => r.ok).length, 1);
    assert.equal(results.filter(r => !r.ok && r.erro === "limit").length, 4);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM whatsapp_senders WHERE archived_at IS NULL")).rows[0].n, 20);
    const first = results.find(r => r.ok); assert.ok(first?.ok);
    assert.ok((await c.S.manageSender(c.actor, { action: "remove", id: first.id, revision: 1 })).ok);
    assert.ok((await c.S.manageSender(c.actor, input)).ok);
    assert.deepEqual(await c.S.manageSender(c.actor, { action: "restore", id: first.id, revision: 2 }), { ok: false, erro: "limit" });
    const old = (await c.db.query("SELECT id FROM whatsapp_senders WHERE archived_at IS NULL ORDER BY id LIMIT 1")).rows[0];
    assert.ok((await c.S.manageSender(c.actor, { action: "remove", id: old.id, revision: 1 })).ok);
    assert.ok((await c.S.manageSender(c.actor, { action: "restore", id: first.id, revision: 2 })).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("duas ações da mesma versão produzem somente uma mudança e uma auditoria", async () => {
  const c = await setup();
  try {
    const added = await c.S.manageSender(c.actor, input); assert.ok(added.ok);
    const results = await Promise.all((["toggle", "remove"] as const).map(action => c.S.manageSender(c.actor, { action, id: added.id, revision: 1 })));
    assert.equal(results.filter(r => r.ok).length, 1);
    assert.equal(results.filter(r => !r.ok && r.erro === "conflict").length, 1);
    assert.equal((await c.db.query("SELECT revision FROM whatsapp_senders WHERE id=$1", [added.id])).rows[0].revision, 2);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM audit_log WHERE event IN ('whatsapp_sender_toggled','whatsapp_sender_removed')")).rows[0].n, 1);
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("handler real exige sessão, nível, origem e confirmação extra e preserva assinaturas", async () => {
  const c = await setup();
  try {
    const { NextRequest } = await import("next/server");
    const { POST } = await import("../app/api/admin/whatsapp/remetentes/route");
    await c.db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,status,created_at,confirmed_at) VALUES('Pessoa QA','signer@example.test','QA-EMAIL-HASH','QA-CPF-HASH','apoiador','QA','2026-10-01T10:00:00Z','confirmed','2026-10-01T10:00:00Z','2026-10-01T10:10:00Z')");
    const signatures = (await c.db.query("SELECT row_to_json(s)::text raw FROM signatures s ORDER BY id")).rows;
    const token = (await c.U.abrirSessao(c.actor.userId, "127.0.0.1")).token;
    let ip = 20;
    const request = (action: string, cookie = token, fields: Record<string, string> = {}, origin = "http://localhost") => new NextRequest("http://localhost/api/admin/whatsapp/remetentes", {
      method: "POST", headers: { host: "localhost", origin, cookie: `adm=${cookie}`, "x-forwarded-for": `10.25.1.${ip++}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ acao: action, rotulo: input.label, ddi: input.ddi, numero: input.number, ...fields }),
    });
    assert.equal((await POST(request("add", ""))).status, 401);
    assert.equal((await POST(request("add"))).status, 403);
    await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=$1", [c.actor.userId]);
    assert.equal((await POST(request("add", token, {}, "https://other.example.test"))).status, 403);
    const created = await POST(request("add")); assert.equal(created.status, 303);
    assert.equal(new URL(created.headers.get("location")!).searchParams.get("msg"), "Remetente cadastrado.");
    const sender = (await c.db.query("SELECT id,revision FROM whatsapp_senders")).rows[0];
    const stale = await POST(request("remove", token, { id: String(sender.id), revision: "999" })); assert.equal(stale.status, 303);
    assert.equal((await c.db.query("SELECT archived_at FROM whatsapp_senders")).rows[0].archived_at, null);
    assert.equal((await POST(request("remove", token, { id: String(sender.id), revision: "1" }))).status, 303);
    assert.ok((await c.db.query("SELECT archived_at FROM whatsapp_senders")).rows[0].archived_at);
    const oldRestore = await POST(request("restore", token, { id: String(sender.id), revision: "1", arquivados: "1" }));
    assert.equal(new URL(oldRestore.headers.get("location")!).searchParams.get("arquivados"), "1");
    assert.equal(new URL(oldRestore.headers.get("location")!).searchParams.get("msg"), "Este registro mudou desde que a página foi aberta. Atualize a página antes de tentar novamente.");
    const restored = await POST(request("restore", token, { id: String(sender.id), revision: "2", arquivados: "1" }));
    assert.equal(restored.status, 303);
    assert.equal(new URL(restored.headers.get("location")!).searchParams.get("msg"), "Remetente restaurado.");
    assert.equal(new URL(restored.headers.get("location")!).searchParams.get("arquivados"), null);
    assert.equal((await c.db.query("SELECT archived_at FROM whatsapp_senders")).rows[0].archived_at, null);
    await c.db.query("UPDATE admin_users SET nivel='leitura' WHERE id=$1", [c.actor.userId]);
    assert.equal((await POST(request("add"))).status, 403);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM whatsapp_senders")).rows[0].n, 1);
    assert.deepEqual((await c.db.query("SELECT row_to_json(s)::text raw FROM signatures s ORDER BY id")).rows, signatures);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_outbox")).rows[0].n, 0);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM whatsapp_messages")).rows[0].n, 0);
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});
