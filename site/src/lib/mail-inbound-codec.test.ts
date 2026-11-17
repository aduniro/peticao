import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { decryptInbound, encryptInbound } from "./mail/inbound-codec";
import type { InboundMail } from "./mail/inbound-contract";
process.env.DATA_ENCRYPTION_KEY = "QA-ONLY-INBOUND-ENCRYPTION-NOT-PRODUCTION";
process.env.HASH_PEPPER = "QA-ONLY-INBOUND-PEPPER-NOT-PRODUCTION";

test("arquivo de entrada cifra corpo e anexos com contexto do ID sem criar arquivo em disco", () => {
  const id = randomUUID();
  const mail: InboundMail = { account: "qa-account", externalId: "qa-1", messageId: "<qa-1@example.test>", inReplyTo: null, references: [], from: "qa-person@example.test", to: ["qa-support@example.test"], subject: "QA conteúdo privado", text: "QA mensagem privada", html: "<p>QA mensagem privada</p>", attachments: [{ name: "qa.txt", contentType: "text/plain", content: Buffer.from("QA bytes privados") }], receivedAt: "2026-11-09T01:00:00.000Z" };
  const cipher = encryptInbound(id, mail);
  assert.ok(!cipher.includes(mail.text)); assert.ok(!cipher.includes(mail.from)); assert.ok(!cipher.includes(mail.attachments[0].content.toString()));
  assert.deepEqual(decryptInbound(id, cipher), mail);
  assert.notEqual(encryptInbound(id, mail), cipher);
  assert.equal(decryptInbound(randomUUID(), cipher), null);
  const parts = cipher.split("."); const encrypted = Buffer.from(parts[3], "base64url"); encrypted[0] ^= 1; parts[3] = encrypted.toString("base64url");
  assert.equal(decryptInbound(id, parts.join(".")), null);
  const key = process.env.DATA_ENCRYPTION_KEY;
  try { process.env.DATA_ENCRYPTION_KEY = "QA-DIFFERENT-INBOUND-KEY"; assert.equal(decryptInbound(id, cipher), null); }
  finally { process.env.DATA_ENCRYPTION_KEY = key; }
  assert.throws(() => encryptInbound("invalid", mail), /inbound_parameters/);
  assert.equal(decryptInbound(id, "malformed"), null);
  assert.equal(decryptInbound(id, "x".repeat(3 * 1024 * 1024)), null);
});
