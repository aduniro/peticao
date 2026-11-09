import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { acceptInboundMail, purgeInboundContent, readInboundContent } from "./mail/inbound-store";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.DATA_ENCRYPTION_KEY = "QA-ONLY-INBOUND-DATA-KEY-NOT-PRODUCTION";
process.env.HASH_PEPPER = "QA-ONLY-INBOUND-PEPPER-NOT-PRODUCTION";
process.env.MAIL_PROVIDER = "dev";
const key = Buffer.from("QA-ONLY-INBOUND-RELAY-KEY-NOT-PRODUCTION");
const cfg = { enabled: true, account: "qa-participants", recipients: ["support@example.test"], key };
const fixture = () => ({ account: cfg.account, externalId: randomUUID(), messageId: `<${randomUUID()}@example.test>`, inReplyTo: null as string | null, references: [] as string[], from: "person@example.test", to: cfg.recipients, subject: "QA reply", text: "QA body", html: "<p>QA body</p>", attachments: [], receivedAt: "2026-11-09T01:00:00.000Z" });
const raw = (v: unknown) => Buffer.from(JSON.stringify(v));
const stamp = () => String(Math.floor(Date.now() / 1000));
const sign = (b: Buffer, t: string) => "sha256=" + createHmac("sha256", key).update(t + ".").update(b).digest("hex");
async function send(v: unknown, configuration = cfg) { const b = raw(v), t = stamp(); return acceptInboundMail(b, t, sign(b, t), configuration); }
async function setup() { const db = await import("./db"); await db._openForTests("t_mail_inbound_store"); return db; }

test("entrada desarmada ou sem autenticidade não grava mensagem nem toca assinaturas/fila", async () => {
  const db = await setup();
  try {
    const mail = fixture();
    assert.deepEqual(await send(mail, { ...cfg, enabled: false }), { ok: false, error: "disabled" });
    assert.equal((await acceptInboundMail(raw(mail), stamp(), "sha256=" + "0".repeat(64), cfg)).ok, false);
    assert.equal((await send({ ...mail, account: "other-account" })).ok, false);
    assert.equal((await send({ ...mail, to: ["owner@example.test"] })).ok, false);
    for (const table of ["mail_inbound_messages", "audit_log", "signatures", "mail_outbox", "contact_messages"]) assert.equal((await db.query(`SELECT 1 FROM ${table}`)).rowCount, 0);
  } finally { await db._closeDbForTests(); }
});

test("reentregas concorrentes produzem uma mensagem cifrada e uma auditoria; conflito não reescreve", async () => {
  const db = await setup();
  try {
    const mail = fixture();
    const results = await Promise.all(Array.from({ length: 8 }, () => send(mail)));
    assert.ok(results.every(r => r.ok));
    assert.equal(new Set(results.filter(r => r.ok).map(r => r.id)).size, 1);
    assert.equal(results.filter(r => r.ok && !r.duplicate).length, 1);
    const rows = (await db.query("SELECT row_to_json(m)::text raw FROM mail_inbound_messages m")).rows;
    assert.equal(rows.length, 1);
    assert.ok(!rows[0].raw.includes(mail.from)); assert.ok(!rows[0].raw.includes(mail.text)); assert.ok(!rows[0].raw.includes(mail.externalId));
    assert.equal((await db.query("SELECT 1 FROM audit_log WHERE event='mail_inbound_received'")).rowCount, 1);
    assert.deepEqual(await send({ ...mail, text: "QA changed content" }), { ok: false, error: "conflict" });
    assert.deepEqual((await db.query("SELECT row_to_json(m)::text raw FROM mail_inbound_messages m")).rows, rows);
    assert.ok((await db.verifyAuditChain()).ok);
  } finally { await db._closeDbForTests(); }
});

test("conversa usa referência exata com conta/endereço iguais, sem inferir identidade por nome/e-mail", async () => {
  const db = await setup();
  try {
    const parent = fixture(), first = await send(parent); assert.ok(first.ok);
    const reply = await send({ ...fixture(), inReplyTo: parent.messageId }); assert.ok(reply.ok); assert.equal(reply.threadRoot, first.id);
    const otherSender = await send({ ...fixture(), from: "other@example.test", inReplyTo: parent.messageId }); assert.ok(otherSender.ok); assert.equal(otherSender.threadRoot, otherSender.id);
    const refsOnly = await send({ ...fixture(), references: [parent.messageId] }); assert.ok(refsOnly.ok); assert.equal(refsOnly.threadRoot, refsOnly.id);
    const otherAccount = { ...cfg, account: "qa-other" };
    const other = await send({ ...fixture(), account: otherAccount.account, inReplyTo: parent.messageId }, otherAccount); assert.ok(other.ok); assert.equal(other.threadRoot, other.id);
    await send({ ...fixture(), messageId: parent.messageId });
    const ambiguous = await send({ ...fixture(), inReplyTo: parent.messageId }); assert.ok(ambiguous.ok); assert.equal(ambiguous.threadRoot, ambiguous.id);
  } finally { await db._closeDbForTests(); }
});

test("falha de auditoria reverte entrada e não deixa ack para uma mensagem ausente", async () => {
  const db = await setup();
  try {
    const mail = fixture();
    await db.query("CREATE FUNCTION qa_inbound_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='mail_inbound_received' THEN RAISE EXCEPTION 'QA expected inbound audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_inbound_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_inbound_fault()");
    await assert.rejects(send(mail), /QA expected inbound audit failure/);
    assert.equal((await db.query("SELECT 1 FROM mail_inbound_messages")).rowCount, 0);
    await db.query("DROP TRIGGER qa_inbound_fault ON audit_log; DROP FUNCTION qa_inbound_fault()");
    const result = await send(mail); assert.ok(result.ok); assert.equal(result.duplicate, false);
  } finally { await db._closeDbForTests(); }
});

test("conteúdo exige sessão Edição atual e confirmação extra; expira antes do expurgo sem renovar reentrega", async () => {
  const db = await setup();
  try {
    const U = await import("./admin-users"), R = await import("./admin-content-retention");
    const created = await U.criarUsuario({ email: "qa-reader@example.test", nome: "QA Leitor", nivel: "edicao", senha: "Cacto-Vento-2026!" }); assert.ok(created.ok);
    const token = (await U.abrirSessao(created.usuario.id, "127.0.0.1")).token;
    const session = await U.sessaoPorToken(token); assert.ok(session);
    const actor = { userId: created.usuario.id, email: created.usuario.email, sessaoId: session.sessaoId };
    const mail = fixture(), accepted = await send(mail); assert.ok(accepted.ok);
    assert.deepEqual(await readInboundContent(accepted.id, actor), { ok: false, error: "forbidden" });
    await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE id=$1", [actor.sessaoId]);
    const read = await readInboundContent(accepted.id, actor); assert.ok(read.ok && read.state === "stored"); assert.equal(read.mail.text, mail.text);
    await db.query("UPDATE admin_users SET nivel='leitura' WHERE id=$1", [actor.userId]);
    assert.deepEqual(await readInboundContent(accepted.id, actor), { ok: false, error: "forbidden" });
    await db.query("UPDATE admin_users SET nivel='edicao' WHERE id=$1", [actor.userId]);
    await db.query("UPDATE mail_inbound_messages SET expires_at=now()-interval '1 second' WHERE id=$1", [accepted.id]);
    assert.deepEqual(await readInboundContent(accepted.id, actor), { ok: true, state: "expired" });
    assert.ok((await db.query("SELECT content_cipher FROM mail_inbound_messages WHERE id=$1", [accepted.id])).rows[0].content_cipher);
    const immutable = (await db.query("SELECT external_key,content_hash,created_at,expires_at FROM mail_inbound_messages WHERE id=$1", [accepted.id])).rows;
    assert.deepEqual(await R.purgeAdminContent(), { messages: 0, outbox: 0, replies: 0, drafts: 0 });
    assert.equal((await db.query("SELECT content_cipher FROM mail_inbound_messages WHERE id=$1", [accepted.id])).rows[0].content_cipher, null);
    const replay = await send(mail); assert.ok(replay.ok && replay.duplicate); assert.equal(replay.id, accepted.id);
    assert.deepEqual((await db.query("SELECT external_key,content_hash,created_at,expires_at FROM mail_inbound_messages WHERE id=$1", [accepted.id])).rows, immutable);
    assert.equal(await purgeInboundContent(), 0);
    assert.equal((await db.query("SELECT 1 FROM signatures UNION ALL SELECT 1 FROM mail_outbox")).rowCount, 0);
  } finally { await db._closeDbForTests(); }
});
