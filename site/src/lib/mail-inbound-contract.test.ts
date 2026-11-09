import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { INBOUND_MAX_BODY, INBOUND_MAX_ATTACHMENT, parseInboundMail, verifyInboundRelay } from "./mail/inbound-contract";

const now = Date.parse("2026-11-09T01:00:00.000Z"), timestamp = String(now / 1000);
const key = Buffer.from("QA-ONLY-RELAY-SECRET-FICTITIOUS-32-BYTES");
const recipient = "support@example.test";
const fixture = () => ({ account: "qa-inbox", externalId: "external-123", messageId: "<msg-123@example.test>", inReplyTo: null, references: [], from: "Person.Name@EXAMPLE.TEST", to: [recipient], subject: "Resposta fictícia", text: "Olá, suporte.", html: "<p>Olá, suporte.</p>", attachments: [], receivedAt: "2026-11-09T00:59:00.000Z" });
const raw = (v: unknown) => Buffer.from(JSON.stringify(v));
const sign = (body: Buffer, stamp = timestamp) => "sha256=" + createHmac("sha256", key).update(stamp + ".", "ascii").update(body).digest("hex");

test("relay autentica bytes exatos e não confunde HMAC do relay com identidade humana", () => {
  const body = raw(fixture());
  assert.deepEqual(verifyInboundRelay(body, timestamp, sign(body), key, now), { ok: true });
  const other = Buffer.concat([body, Buffer.from(" ")]);
  assert.deepEqual(verifyInboundRelay(other, timestamp, sign(body), key, now), { ok: false, error: "signature" });
  const changed = Buffer.from(body); changed[10] ^= 1;
  assert.equal(verifyInboundRelay(changed, timestamp, sign(body), key, now).ok, false);
});

test("relay desarmado, assinatura malformada e janela de replay falham fechados", () => {
  const body = raw(fixture());
  assert.deepEqual(verifyInboundRelay(body, timestamp, sign(body), null, now), { ok: false, error: "disabled" });
  assert.equal(verifyInboundRelay(body, timestamp, sign(body), Buffer.alloc(31), now).ok, false);
  for (const sig of [null, "sha256=no", "sha256=" + "a".repeat(65), "SHA256=" + "a".repeat(64)]) assert.equal(verifyInboundRelay(body, timestamp, sig, key, now).ok, false);
  for (const stamp of [null, "1e9", timestamp + "0", String(Number(timestamp) - 301), String(Number(timestamp) + 301)]) assert.equal(verifyInboundRelay(body, stamp, sign(body), key, now).ok, false);
  const old = String(Number(timestamp) - 300);
  assert.equal(verifyInboundRelay(body, old, sign(body, old), key, now).ok, true);
  assert.equal(verifyInboundRelay(Buffer.alloc(INBOUND_MAX_BODY + 1), timestamp, sign(body), key, now).ok, false);
});

test("entrada normaliza endereço sem remover pontos ou atribuir conversa por e-mail", () => {
  const parsed = parseInboundMail(raw(fixture()), [recipient]); assert.ok(parsed.ok);
  assert.equal(parsed.mail.from, "person.name@example.test");
  assert.equal(parsed.mail.inReplyTo, null); assert.deepEqual(parsed.mail.references, []);
  assert.equal(parsed.mail.subject, fixture().subject); assert.equal(parsed.mail.html, fixture().html);
  assert.equal(parseInboundMail(raw({ ...fixture(), from: "personname@example.test" }), [recipient]).ok, true);
  const owner = parseInboundMail(raw({ ...fixture(), to: ["owner@example.test"] }), [recipient]);
  assert.deepEqual(owner, { ok: false, error: "recipient" });
  assert.equal(parseInboundMail(raw(fixture()), []).ok, false);
});

test("entrada rejeita UTF8 inválido, tipos, cabeçalhos injetados e campos desconhecidos", () => {
  for (const body of [Buffer.from([0xff]), Buffer.from("{"), raw(null), raw([]), Buffer.alloc(INBOUND_MAX_BODY + 1)]) assert.equal(parseInboundMail(body, [recipient]).ok, false);
  const bad: unknown[] = [
    { ...fixture(), extra: true }, { ...fixture(), account: "../account" }, { ...fixture(), externalId: "\r\nBcc: a@example.test" },
    { ...fixture(), from: "a@example.test\r\nBcc: b@example.test" }, { ...fixture(), subject: "Assunto\nOutro" },
    { ...fixture(), from: "other,a@example.test" }, { ...fixture(), from: "other;a@example.test" },
    { ...fixture(), externalId: "id\u0001" },
    { ...fixture(), messageId: "not-a-message-id" }, { ...fixture(), inReplyTo: "<a@example.test>\n" },
    { ...fixture(), references: ["<ok@example.test>", 1] }, { ...fixture(), to: "support@example.test" },
    { ...fixture(), receivedAt: "2026-02-31T00:00:00.000Z" }, { ...fixture(), text: "bad\0text" },
  ];
  const missing = { ...fixture() } as Record<string, unknown>; delete missing.externalId; bad.push(missing);
  for (const value of bad) assert.equal(parseInboundMail(raw(value), [recipient]).ok, false, JSON.stringify(value));
});

test("limites se aplicam a bytes Unicode, referências e anexos sem criar arquivos", () => {
  assert.equal(parseInboundMail(raw({ ...fixture(), subject: "á".repeat(1024) }), [recipient]).ok, true);
  assert.equal(parseInboundMail(raw({ ...fixture(), subject: "á".repeat(1025) }), [recipient]).ok, false);
  assert.equal(parseInboundMail(raw({ ...fixture(), references: Array(31).fill("<a@example.test>") }), [recipient]).ok, false);
  const attachment = { name: "relatório.pdf", contentType: "application/pdf", base64: Buffer.from("FICTITIOUS PDF BYTES").toString("base64") };
  const parsed = parseInboundMail(raw({ ...fixture(), attachments: [attachment] }), [recipient]); assert.ok(parsed.ok);
  assert.equal(parsed.mail.attachments[0].content.toString(), "FICTITIOUS PDF BYTES");
  for (const value of [{ ...attachment, name: "../file" }, { ...attachment, name: "a\\b" }, { ...attachment, base64: "!!!!" }, { ...attachment, base64: "Zh==" }, { ...attachment, contentType: "application/pdf\r\n" }, { ...attachment, base64: Buffer.alloc(INBOUND_MAX_ATTACHMENT + 1).toString("base64") }]) assert.equal(parseInboundMail(raw({ ...fixture(), attachments: [value] }), [recipient]).ok, false);
  assert.equal(parseInboundMail(raw({ ...fixture(), attachments: Array(5).fill(attachment) }), [recipient]).ok, false);
});
