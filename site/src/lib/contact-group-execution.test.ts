import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Mail } from "./mail";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
process.env.CONTACT_BCC = "qa-owner@example.test";
delete process.env.MAIL_PROVIDERS;
delete process.env.PREVIEW_MODE;
delete process.env.ADMIN_NO_PASSWORD;
const TEMPLATE = { assunto: "Resposta para {nome}", corpo: "QA PRIVATE GROUP: Olá {nome}, recebemos seu contato e verificamos o problema." };
async function setup(schema: string, card = false) {
  const db = await import("./db"); await db._openForTests(schema);
  const users = await import("./admin-users"), M = await import("./contact-group-execution"), P = await import("./contact-group-preview"), D = await import("./contact-delivery");
  const user = await users.criarUsuario({ email: "qa-group-exec@example.test", nome: "QA Operator", nivel: "total", senha: "QA-Tests-2026-Ficticia" }); assert.ok(user.ok);
  const token = (await users.abrirSessao(user.usuario.id, "127.0.0.1")).token, actor = (await users.sessaoPorToken(token))!;
  await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE id=$1", [actor.sessaoId]);
  const ids = (await db.query("INSERT INTO contact_messages(name,email,kind,message) VALUES('Alice Matos','qa-alice@example.test','duvida','QA Original Alice'),('Bruno Costa','qa-bruno@example.test','duvida','QA Original Bruno') RETURNING id")).rows.map(x => x.id as number);
  if (card) {
    const sig = (await db.query("INSERT INTO signatures(name,email,email_hash,category,text_version,consent_at,status,cpf_name_check) VALUES('Alice Matos','qa-alice@example.test','QA-HASH','apoiador','QA',now(),'confirmed','aprovado') RETURNING id")).rows[0].id;
    await db.query("INSERT INTO referrers(code,signature_id) VALUES('ABCDEFG',$1)", [sig]);
  }
  const input = { selections: ids.map(contactId => ({ contactId })), template: TEMPLATE };
  const preview = await P.prepareContactGroupPreview(input, actor); assert.ok(preview.ok); assert.ok(preview.recipients.every(x => x.eligible));
  const execute = { requestId: randomUUID(), preview: input, proof: preview.proof, approvedContactIds: ids };
  const sent: Mail[] = [], sender = async (mail: Mail) => { sent.push(mail); return "sent" as const; };
  const snapshot = async () => (await db.query("SELECT 'group' kind,row_to_json(g)::text raw FROM contact_reply_groups g UNION ALL SELECT 'item',row_to_json(i)::text FROM contact_reply_group_items i UNION ALL SELECT 'reply',row_to_json(r)::text FROM contact_replies r UNION ALL SELECT 'contact',row_to_json(c)::text FROM contact_messages c UNION ALL SELECT 'draft',row_to_json(d)::text FROM contact_drafts d UNION ALL SELECT 'signature',row_to_json(s)::text FROM signatures s UNION ALL SELECT 'audit',row_to_json(a)::text FROM audit_log a ORDER BY kind,raw")).rows;
  return { db, users, M, P, D, actor, token, ids, input, preview, execute, sent, sender, snapshot };
}

test("explicit group execution reuses exact text/card/BCC and existing worker; acceptance is not recipient delivery", async () => {
  const c = await setup("t_group_execution_success", true);
  try {
    const before = (await c.db.query("SELECT row_to_json(s)::text raw FROM signatures s")).rows;
    const result = await c.M.executeContactGroup(c.execute, c.actor, { enviar: c.sender }); assert.ok(result.ok); assert.equal(result.replayed, false); assert.equal(result.delivery, "not_inferred"); assert.ok(result.items.every(x => x.textState === "accepted")); assert.equal(c.sent.length, 2);
    assert.ok(c.sent.every(x => JSON.stringify(x.bcc) === JSON.stringify(["qa-owner@example.test"]))); assert.ok(c.sent[0].text!.includes("Alice")); assert.ok(c.sent[1].text!.includes("Bruno"));
    assert.equal(result.items[0].cardState, "prepared"); assert.equal(result.items[1].cardState, null);
    const card = (await c.db.query("SELECT due_at,payload FROM contact_replies WHERE versao='card'")).rows[0]; assert.ok(card.due_at.getTime() > Date.now() + 50000);
    await c.db.query("UPDATE contact_replies SET due_at=now()-interval '1 second' WHERE versao='card'");
    assert.equal((await c.D.drainContactReplies(5, { enviar: c.sender })).accepted, 1); assert.equal(c.sent.length, 3); assert.ok(c.sent[2].html);
    const again = await c.M.executeContactGroup(c.execute, c.actor, { enviar: c.sender }); assert.ok(again.ok); assert.equal(again.replayed, true); assert.equal(c.sent.length, 3);
    assert.deepEqual((await c.db.query("SELECT row_to_json(s)::text raw FROM signatures s")).rows, before); assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("crash after durable reservation recovers by read-only lookup and existing worker without POST resend", async () => {
  const c = await setup("t_group_execution_recovery");
  try {
    const reservation = await c.M.reserveContactGroup(c.execute, c.actor); assert.ok(reservation.ok); assert.equal(reservation.newlyReserved, true); assert.equal(c.sent.length, 0);
    const before = await c.snapshot(), recovered = await c.M.contactGroupResult(c.execute.requestId, c.actor); assert.ok(recovered.ok); assert.ok(recovered.items.every(x => x.textState === "prepared")); assert.deepEqual(await c.snapshot(), before);
    const replay = await c.M.executeContactGroup(c.execute, c.actor, { enviar: c.sender }); assert.ok(replay.ok); assert.equal(replay.replayed, true); assert.equal(c.sent.length, 0);
    assert.equal((await c.D.drainContactReplies(5, { enviar: c.sender })).accepted, 2); assert.equal(c.sent.length, 2);
    const after = await c.M.contactGroupResult(c.execute.requestId, c.actor); assert.ok(after.ok); assert.ok(after.items.every(x => x.textState === "accepted"));
    const body = JSON.stringify((await c.db.query("SELECT row_to_json(g)::text raw FROM contact_reply_groups g")).rows); assert.ok(!body.includes("QA PRIVATE GROUP"));
  } finally { await c.db._closeDbForTests(); }
});

test("same request races reserve once, divergent reuse conflicts and a fresh request cannot reuse an obsolete context", async () => {
  const c = await setup("t_group_execution_race");
  try {
    const results = await Promise.all([c.M.executeContactGroup(c.execute, c.actor, { enviar: c.sender }), c.M.executeContactGroup(c.execute, c.actor, { enviar: c.sender })]); assert.ok(results[0].ok && results[1].ok); assert.equal(results[0].groupId, results[1].groupId); assert.equal(c.sent.length, 2);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM contact_reply_groups")).rows[0].n, 1); assert.equal((await c.db.query("SELECT count(*)::int n FROM contact_replies WHERE versao='texto'")).rows[0].n, 2);
    assert.deepEqual(await c.M.executeContactGroup({ ...c.execute, approvedContactIds: [c.ids[0]] }, c.actor, { enviar: c.sender }), { ok: false, error: "conflict" });
    assert.deepEqual(await c.M.executeContactGroup({ ...c.execute, requestId: randomUUID() }, c.actor, { enviar: c.sender }), { ok: false, error: "conflict" }); assert.equal(c.sent.length, 2);
  } finally { await c.db._closeDbForTests(); }
});

test("a group and an individual request cannot reserve the same contact round twice", async () => {
  const c = await setup("t_group_execution_single_race");
  try {
    const single = await import("./contact-replies"), row = c.preview.recipients[0]; assert.ok(row.preview && "expandedInput" in row && row.expandedInput);
    await Promise.all([c.M.executeContactGroup(c.execute, c.actor, { enviar: c.sender }), single.enviarResposta({ contactId: c.ids[0], entrada: row.expandedInput, selo: row.preview.selo, por: c.actor, enviar: c.sender })]);
    assert.equal(c.sent.filter(m => m.to === "qa-alice@example.test").length, 1);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM contact_replies WHERE contact_id=$1 AND versao='texto'", [c.ids[0]])).rows[0].n, 1);
  } finally { await c.db._closeDbForTests(); }
});

test("all cases are verified before transport and group audit failure rolls back every reservation and ledger", async () => {
  const c = await setup("t_group_execution_rollback", true);
  try {
    const before = await c.snapshot();
    await c.db.query("CREATE FUNCTION fail_group_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='contact_group_reserved' THEN RAISE EXCEPTION 'QA group audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_group_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_group_audit()");
    await assert.rejects(c.M.executeContactGroup(c.execute, c.actor, { enviar: c.sender }), /QA group audit failure/); assert.deepEqual(await c.snapshot(), before); assert.equal(c.sent.length, 0);
    await c.db.query("DROP TRIGGER fail_group_audit ON audit_log");
    await c.db.query("UPDATE contact_messages SET name='QA Changed Source' WHERE id=$1", [c.ids[1]]);
    assert.deepEqual(await c.M.executeContactGroup(c.execute, c.actor, { enviar: c.sender }), { ok: false, error: "conflict" }); assert.equal((await c.db.query("SELECT count(*)::int n FROM contact_reply_groups")).rows[0].n, 0); assert.equal(c.sent.length, 0);
  } finally { await c.db._closeDbForTests(); }
});

test("partial uncertain results remain per case; replay and read-only reconciliation never repeat transport", async () => {
  const c = await setup("t_group_execution_uncertain", true);
  try {
    const sender = async (mail: Mail) => { c.sent.push(mail); if (mail.to === "qa-alice@example.test") return await new Promise<"sent">(() => {}); return "sent" as const; };
    const result = await c.M.executeContactGroup(c.execute, c.actor, { enviar: sender, deadlineMs: 15 }); assert.ok(result.ok); assert.equal(result.items[0].textState, "uncertain"); assert.equal(result.items[0].cardState, "blocked"); assert.equal(result.items[1].textState, "accepted"); assert.equal(c.sent.length, 2);
    const before = await c.snapshot(); assert.ok((await c.M.contactGroupResult(c.execute.requestId, c.actor)).ok); assert.deepEqual(await c.snapshot(), before);
    assert.ok((await c.M.executeContactGroup(c.execute, c.actor, { enviar: sender, deadlineMs: 15 })).ok); assert.equal(c.sent.length, 2); assert.equal((await c.D.drainContactReplies(5, { enviar: c.sender })).tried, 0); assert.equal(c.sent.length, 2);
  } finally { await c.db._closeDbForTests(); }
});

test("HMAC alone never authorizes: revoked role/session/stepup cannot reserve or view a durable group", async () => {
  const c = await setup("t_group_execution_authorization");
  try {
    await c.db.query("UPDATE admin_sessions SET stepup_ate=NULL WHERE id=$1", [c.actor.sessaoId]); assert.deepEqual(await c.M.executeContactGroup(c.execute, c.actor, { enviar: c.sender }), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE id=$1", [c.actor.sessaoId]); await c.db.query("UPDATE admin_users SET nivel='edicao' WHERE id=$1", [c.actor.userId]); assert.deepEqual(await c.M.reserveContactGroup(c.execute, c.actor), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_users SET nivel='total' WHERE id=$1", [c.actor.userId]); assert.ok((await c.M.reserveContactGroup(c.execute, c.actor)).ok);
    await c.db.query("UPDATE admin_users SET ativo=false WHERE id=$1", [c.actor.userId]); assert.deepEqual(await c.M.contactGroupResult(c.execute.requestId, c.actor), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_users SET ativo=true WHERE id=$1", [c.actor.userId]); await c.users.encerrarSessao(c.token); assert.deepEqual(await c.M.reserveContactGroup(c.execute, c.actor), { ok: false, error: "forbidden" }); assert.equal(c.sent.length, 0);
  } finally { await c.db._closeDbForTests(); }
});

test("expiry during reservation rolls back the whole group instead of treating an earlier HMAC/session check as authority", async () => {
  const c = await setup("t_group_execution_expiry");
  try {
    const before = await c.snapshot();
    await c.db.query(`CREATE FUNCTION expire_group_stepup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='contato_resposta_reservada' THEN UPDATE admin_sessions SET stepup_ate=clock_timestamp()-interval '1 second' WHERE id=${c.actor.sessaoId}; END IF; RETURN NEW; END $$; CREATE TRIGGER expire_group_stepup BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION expire_group_stepup()`);
    assert.deepEqual(await c.M.executeContactGroup(c.execute, c.actor, { enviar: c.sender }), { ok: false, error: "forbidden" });
    assert.deepEqual(await c.snapshot(), before); assert.equal(c.sent.length, 0);
  } finally { await c.db._closeDbForTests(); }
});

test("a concurrent draft expiry/write cannot change the reviewed revision while group reservation holds its source snapshot", async () => {
  const c = await setup("t_group_execution_draft_lock");
  let running: ReturnType<typeof c.M.reserveContactGroup> | undefined;
  try {
    await (await import("./contact-drafts")).writeContactDraft(c.ids[0], 0, { assunto: "QA Draft", corpo: "QA Draft content preserved" }, c.actor);
    const preview = await c.P.prepareContactGroupPreview(c.input, c.actor); assert.ok(preview.ok);
    await c.db.query("CREATE FUNCTION pause_group_reservation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(7778); RETURN NEW; END $$; CREATE TRIGGER pause_group_reservation BEFORE INSERT ON contact_reply_groups FOR EACH ROW EXECUTE FUNCTION pause_group_reservation()");
    await c.db.tx(async gate => {
      await gate.query("SELECT pg_advisory_xact_lock(7778)");
      running = c.M.reserveContactGroup({ ...c.execute, proof: preview.proof }, c.actor);
      let paused = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        paused = !!(await c.db.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND query LIKE 'INSERT INTO contact_reply_groups(%' AND wait_event='advisory'")).rowCount;
        if (paused) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.ok(paused, "Group reached the controlled reservation barrier");
      await assert.rejects(c.db.tx(async writer => {
        await writer.query("SET LOCAL lock_timeout='50ms'");
        await writer.query("UPDATE contact_drafts SET revision=revision+1 WHERE contact_id=$1", [c.ids[0]]);
      }), { code: "55P03" });
    });
    assert.ok((await running!).ok); assert.equal((await c.db.query("SELECT revision FROM contact_drafts WHERE contact_id=$1", [c.ids[0]])).rows[0].revision, 1); assert.equal(c.sent.length, 0);
  } finally { if (running) await running.catch(() => {}); await c.db._closeDbForTests(); }
});

test("retention purges bodies using the existing policy without deleting group receipts or allowing replay dispatch", async () => {
  const c = await setup("t_group_execution_retention", true);
  try {
    assert.ok((await c.M.reserveContactGroup(c.execute, c.actor)).ok);
    await c.db.query("UPDATE contact_replies SET criada_em=now()-interval '31 days'");
    await (await import("./admin-content-retention")).purgeAdminContent(100);
    const result = await c.M.contactGroupResult(c.execute.requestId, c.actor); assert.ok(result.ok); assert.ok(result.items.every(i => i.textState === "rejected" && i.textErrorCode === "content_expired"));
    assert.ok((await c.db.query("SELECT payload FROM contact_replies")).rows.every(r => r.payload === null)); assert.equal((await c.db.query("SELECT count(*)::int n FROM contact_reply_group_items")).rows[0].n, 2);
    assert.ok((await c.M.executeContactGroup(c.execute, c.actor, { enviar: c.sender })).ok); assert.equal(c.sent.length, 0);
  } finally { await c.db._closeDbForTests(); }
});

test("HTTP requires explicit approved IDs/origin/stepup and recovers by GET after dev-only execution", async () => {
  const c = await setup("t_group_execution_http");
  try {
    const { NextRequest } = await import("next/server"), { POST } = await import("../app/api/admin/contato/grupo/confirmar/route"), { GET } = await import("../app/api/admin/contato/grupo/resultado/route");
    const request = (body: unknown, auth = true, origin = "http://localhost") => new NextRequest("http://localhost/api/admin/contato/grupo/confirmar", { method: "POST", headers: { host: "localhost", origin, cookie: auth ? `adm=${c.token}` : "", "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await POST(request(c.execute, false))).status, 401); assert.equal((await POST(request(c.execute, true, "http://other.test"))).status, 403);
    assert.equal((await POST(request({ ...c.execute, approvedContactIds: [] }))).status, 400); assert.equal((await POST(request({ ...c.execute, requestId: "bad" }))).status, 400);
    assert.equal((await POST(request({ ...c.execute, preview: { ...c.input, template: { ...TEMPLATE, corpo: "x".repeat(33000) } } }))).status, 413);
    const response = await POST(request(c.execute)); assert.equal(response.status, 200); const original = await response.json(); assert.equal(original.groupReserved, true);
    const recovered = await GET(new NextRequest("http://localhost/api/admin/contato/grupo/resultado?requestId=" + c.execute.requestId, { headers: { host: "localhost", cookie: `adm=${c.token}` } })); assert.equal(recovered.status, 200); assert.equal(recovered.headers.get("cache-control"), "no-store"); assert.equal((await recovered.json()).groupId, original.groupId);
    const replay = await POST(request(c.execute)); assert.equal(replay.status, 200); assert.equal((await replay.json()).replayed, true); assert.equal((await c.db.query("SELECT count(*)::int n FROM contact_reply_groups")).rows[0].n, 1);
  } finally { await c.db._closeDbForTests(); }
});
