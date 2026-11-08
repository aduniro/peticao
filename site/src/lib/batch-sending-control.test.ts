import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
delete process.env.PREVIEW_MODE;
delete process.env.ADMIN_NO_PASSWORD;

async function setup(schema: string) {
  const db = await import("./db"); await db._openForTests(schema);
  const U = await import("./admin-users"), C = await import("./batch-sending-control");
  const user = await U.criarUsuario({ email: "qa-batch-control@example.test", nome: "QA Lotes", nivel: "total", senha: "Ficticia-Documento-Controle-2026" }); assert.ok(user.ok);
  const actor = { userId: user.usuario.id, email: user.usuario.email };
  await db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf) VALUES(1,'partial','prepared',0,1,'QA-LIST',decode('255044462d5141','hex'))");
  const documents = async () => (await db.query("SELECT row_to_json(b)::text raw FROM batches b ORDER BY id")).rows;
  return { db, U, C, actor, documents };
}

test("pausa usa estado explícito e auditoria atômica sem tocar em documentos, assinaturas ou e-mails", async () => {
  const c = await setup("t_batch_control_success");
  try {
    const before = await c.documents(), control = await c.C.batchSendingControl(c.actor); assert.equal(control.enabled, true);
    assert.deepEqual(await c.C.changeBatchSending(false, control.version, c.actor), { ok: true, enabled: false });
    const after = await c.C.batchSendingControl(c.actor); assert.equal(after.enabled, false); assert.notEqual(after.version, control.version);
    assert.deepEqual(await c.C.changeBatchSending(false, control.version, c.actor), { ok: false, error: "conflict" });
    const event = JSON.parse((await c.db.query("SELECT data FROM audit_log WHERE event='sending_toggled'")).rows[0].data);
    assert.deepEqual(event, { enabled: false, previous: true, userId: c.actor.userId, por: c.actor.email });
    assert.deepEqual(await c.documents(), before);
    assert.equal((await c.db.query("SELECT 1 FROM signatures UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM batch_sends")).rowCount, 0);
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("falha de auditoria reverte a configuração e permite tentativa explícita com a mesma versão", async () => {
  const c = await setup("t_batch_control_rollback");
  try {
    const control = await c.C.batchSendingControl(c.actor);
    await c.db.query("CREATE FUNCTION qa_fail_batch_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='sending_toggled' THEN RAISE EXCEPTION 'QA expected pause audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_batch_pause BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_fail_batch_pause()");
    await assert.rejects(c.C.changeBatchSending(false, control.version, c.actor), /QA expected pause audit failure/);
    assert.deepEqual(await c.C.batchSendingControl(c.actor), control);
    assert.equal((await c.db.query("SELECT 1 FROM settings WHERE key='sending_enabled'")).rowCount, 0);
    await c.db.query("DROP TRIGGER qa_fail_batch_pause ON audit_log");
    assert.ok((await c.C.changeBatchSending(false, control.version, c.actor)).ok);
    assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='sending_toggled'")).rowCount, 1);
  } finally { await c.db._closeDbForTests(); }
});

test("pedidos concorrentes não invertem a pausa duas vezes e retornar ao mesmo estado não revive versão antiga", async () => {
  const c = await setup("t_batch_control_concurrent");
  try {
    const initial = await c.C.batchSendingControl(c.actor);
    const results = await Promise.all(Array.from({ length: 4 }, () => c.C.changeBatchSending(false, initial.version, c.actor)));
    assert.equal(results.filter(r => r.ok).length, 1); assert.ok(results.filter(r => !r.ok).every(r => r.error === "conflict"));
    const paused = await c.C.batchSendingControl(c.actor); assert.ok((await c.C.changeBatchSending(true, paused.version, c.actor)).ok);
    const resumed = await c.C.batchSendingControl(c.actor); assert.ok((await c.C.changeBatchSending(false, resumed.version, c.actor)).ok);
    assert.deepEqual(await c.C.changeBatchSending(true, paused.version, c.actor), { ok: false, error: "conflict" });
    assert.equal((await c.C.batchSendingControl(c.actor)).enabled, false);
    assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='sending_toggled'")).rowCount, 3);
  } finally { await c.db._closeDbForTests(); }
});

test("controle revalida Total/identidade e recusa estado inválido sem substituir configuração", async () => {
  const c = await setup("t_batch_control_authorization");
  try {
    const control = await c.C.batchSendingControl(c.actor);
    assert.deepEqual(await c.C.changeBatchSending("false", control.version, c.actor), { ok: false, error: "parameters" });
    assert.deepEqual(await c.C.changeBatchSending(false, control.version, { ...c.actor, email: "other@example.test" }), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_users SET nivel='edicao' WHERE id=$1", [c.actor.userId]);
    assert.deepEqual(await c.C.changeBatchSending(false, control.version, c.actor), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_users SET nivel='total',ativo=false WHERE id=$1", [c.actor.userId]);
    assert.deepEqual(await c.C.changeBatchSending(false, control.version, c.actor), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_users SET ativo=true WHERE id=$1", [c.actor.userId]);
    await c.db.query("INSERT INTO settings(key,value) VALUES('sending_enabled','QA-invalid-state')");
    await assert.rejects(c.C.changeBatchSending(false, control.version, c.actor), /sending_configuration_invalid/);
    assert.equal((await c.db.query("SELECT value FROM settings WHERE key='sending_enabled'")).rows[0].value, "QA-invalid-state");
  } finally { await c.db._closeDbForTests(); }
});

test("ações sensíveis de lotes exigem confirmação extra antes de qualquer efeito; pausa valida origem e versão", async () => {
  const c = await setup("t_batch_control_http");
  try {
    const [pause, create, code, approve, signed, cancel] = await Promise.all([
      import("../app/api/admin/lotes/pausa/route"), import("../app/api/admin/lotes/criar/route"), import("../app/api/admin/lotes/[id]/codigo/route"),
      import("../app/api/admin/lotes/[id]/aprovar/route"), import("../app/api/admin/lotes/[id]/assinado/route"), import("../app/api/admin/lotes/[id]/cancelar/route"),
    ]);
    const token = (await c.U.abrirSessao(c.actor.userId, "127.0.0.1")).token;
    const req = (path: string, body = "", cookie = `adm=${token}`, origin = "http://localhost") => new NextRequest(`http://localhost/api/admin/lotes/${path}`, { method: "POST", headers: { host: "localhost", origin, cookie, "content-type": "application/x-www-form-urlencoded" }, body });
    const handlers = [
      () => pause.POST(req("pausa")), () => create.POST(req("criar")), () => code.POST(req("1/codigo"), { params: { id: "1" } }),
      () => approve.POST(req("1/aprovar"), { params: { id: "1" } }), () => signed.POST(req("1/assinado"), { params: { id: "1" } }), () => cancel.POST(req("1/cancelar"), { params: { id: "1" } }),
    ];
    const before = await c.documents();
    for (const run of handlers) { const denied = await run(); assert.equal(denied.status, 403); assert.equal((await denied.json()).erro, "stepup"); }
    assert.equal((await pause.POST(req("pausa", "", ""))).status, 401);
    await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=$1", [c.actor.userId]);
    const control = await c.C.batchSendingControl(c.actor), body = new URLSearchParams({ enabled: "false", version: control.version }).toString();
    assert.equal((await pause.POST(req("pausa", body, undefined, "https://other.example.test"))).status, 403);
    assert.equal((await pause.POST(req("pausa", "enabled=false"))).status, 400);
    assert.equal((await pause.POST(req("pausa", "x".repeat(1025)))).status, 413);
    const response = await pause.POST(req("pausa", body)); assert.equal(response.status, 303); assert.equal(new URL(response.headers.get("location")!).searchParams.get("msg"), "Envios PAUSADOS.");
    assert.equal((await pause.POST(req("pausa", body))).status, 409);
    await c.db.query("UPDATE admin_users SET nivel='leitura' WHERE id=$1", [c.actor.userId]); assert.equal((await pause.POST(req("pausa", body))).status, 403);
    assert.deepEqual(await c.documents(), before);
    assert.equal((await c.db.query("SELECT 1 FROM signatures UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM batch_sends")).rowCount, 0);
  } finally { await c.db._closeDbForTests(); }
});
