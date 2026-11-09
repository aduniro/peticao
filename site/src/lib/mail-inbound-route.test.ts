import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { POST } from "../app/api/mail/inbound/route";
import { INBOUND_MAX_BODY } from "./mail/inbound-contract";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.DATA_ENCRYPTION_KEY = "QA-ONLY-INBOUND-ROUTE-DATA-KEY";
process.env.HASH_PEPPER = "QA-ONLY-INBOUND-ROUTE-PEPPER-0123456789";
const secret = "QA-ONLY-INBOUND-ROUTE-RELAY-SECRET-0123456789";
const variables = ["MAIL_INBOUND_ENABLED", "MAIL_INBOUND_ACCOUNT", "MAIL_INBOUND_RECIPIENTS", "MAIL_INBOUND_RELAY_KEY"];
async function setup() {
  const db = await import("./db"); await db._openForTests("t_mail_inbound_route");
  const before = variables.map(k => process.env[k]);
  const account = "qa-" + randomUUID();
  process.env.MAIL_INBOUND_ENABLED = "1"; process.env.MAIL_INBOUND_ACCOUNT = account;
  process.env.MAIL_INBOUND_RECIPIENTS = "support@example.test"; process.env.MAIL_INBOUND_RELAY_KEY = secret;
  return { db, account, close: async () => { variables.forEach((k, i) => { if (before[i] === undefined) delete process.env[k]; else process.env[k] = before[i]; }); await db._closeDbForTests(); } };
}
function fixture(account: string) { return { account, externalId: randomUUID(), messageId: null, inReplyTo: null, references: [], from: "person@example.test", to: ["support@example.test"], subject: "QA retorno", text: "QA mensagem", html: "", attachments: [], receivedAt: "2026-11-09T01:00:00.000Z" }; }
function request(body: Buffer, overrides: Record<string, string> = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = "sha256=" + createHmac("sha256", secret).update(timestamp + ".").update(body).digest("hex");
  return new NextRequest("http://localhost/api/mail/inbound", { method: "POST", headers: { "content-type": "application/json", "x-peticao-timestamp": timestamp, "x-peticao-signature": signature, ...overrides }, body: new Uint8Array(body) });
}

test("rota de entrada fica desarmada, não consome corpo e exclui caixa da Ponte", async () => {
  const c = await setup();
  try {
    delete process.env.MAIL_INBOUND_ENABLED;
    const req = request(Buffer.from("{}")); assert.equal((await POST(req)).status, 404); assert.equal(req.bodyUsed, false);
    process.env.MAIL_INBOUND_ENABLED = "1"; process.env.MAIL_INBOUND_RECIPIENTS = "operator-1608598f41@example.invalid";
    assert.equal((await POST(request(Buffer.from("{}")))).status, 503);
    process.env.MAIL_INBOUND_RECIPIENTS = "support@example.test"; process.env.MAIL_INBOUND_RELAY_KEY = "QA-short";
    assert.equal((await POST(request(Buffer.from("{}")))).status, 503);
    assert.equal((await c.db.query("SELECT 1 FROM mail_inbound_messages UNION ALL SELECT 1 FROM audit_log")).rowCount, 0);
  } finally { await c.close(); }
});

test("rota autentica UTF8 exato inclusive BOM, confirma commit e identifica reentrega/conflito", async () => {
  const c = await setup();
  try {
    const mail = fixture(c.account), b = Buffer.from("\ufeff" + JSON.stringify(mail));
    const first = await POST(request(b)); assert.equal(first.status, 202); const receipt = await first.json(); assert.ok(receipt.ok && !receipt.duplicate);
    const duplicate = await POST(request(b)); assert.equal(duplicate.status, 202); assert.equal((await duplicate.json()).id, receipt.id);
    assert.equal((await c.db.query("SELECT 1 FROM mail_inbound_messages")).rowCount, 1);
    assert.equal((await POST(request(Buffer.from(JSON.stringify({ ...mail, text: "QA changed" }))))).status, 409);
    assert.equal((await POST(request(b, { "x-peticao-signature": "sha256=" + "0".repeat(64) }))).status, 401);
    assert.equal((await c.db.query("SELECT 1 FROM mail_inbound_messages")).rowCount, 1);
  } finally { await c.close(); }
});

test("rota limita bytes reais, rejeita JSON/UTF8 inválido e não aceita destinos/contas diferentes", async () => {
  const c = await setup();
  try {
    const b = Buffer.from(JSON.stringify(fixture(c.account)));
    assert.equal((await POST(request(b, { "content-type": "text/plain" }))).status, 415);
    assert.equal((await POST(request(b, { "content-length": String(INBOUND_MAX_BODY + 1) }))).status, 413);
    assert.equal((await POST(request(Buffer.alloc(INBOUND_MAX_BODY + 1), { "content-length": "1" }))).status, 413);
    assert.equal((await POST(request(Buffer.from([0xff])))).status, 400);
    assert.equal((await POST(request(Buffer.from("{")))).status, 400);
    for (const mail of [{ ...fixture(c.account), account: "another" }, { ...fixture(c.account), to: ["owner@example.test"] }]) assert.equal((await POST(request(Buffer.from(JSON.stringify(mail))))).status, 400);
    assert.equal((await c.db.query("SELECT 1 FROM mail_inbound_messages")).rowCount, 0);
  } finally { await c.close(); }
});

test("falha de banco retorna indisponível sem ack, depois admite exatamente uma reentrega", async () => {
  const c = await setup();
  try {
    const b = Buffer.from(JSON.stringify(fixture(c.account)));
    await c.db.query("CREATE FUNCTION qa_route_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='mail_inbound_received' THEN RAISE EXCEPTION 'QA expected route fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_route_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_route_fault()");
    assert.equal((await POST(request(b))).status, 503);
    assert.equal((await c.db.query("SELECT 1 FROM mail_inbound_messages")).rowCount, 0);
    await c.db.query("DROP TRIGGER qa_route_fault ON audit_log; DROP FUNCTION qa_route_fault()");
    assert.equal((await POST(request(b))).status, 202);
    assert.equal((await c.db.query("SELECT 1 FROM mail_inbound_messages")).rowCount, 1);
    for (const table of ["signatures", "mail_outbox", "mail_log", "contact_replies"]) assert.equal((await c.db.query(`SELECT 1 FROM ${table}`)).rowCount, 0);
  } finally { await c.close(); }
});
