import test from "node:test";
import assert from "node:assert/strict";
import { validDraftInput, encryptDraft, decryptDraft } from "./contact-draft-codec";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.DATA_ENCRYPTION_KEY = "QA-ONLY-DRAFT-KEY-NOT-PRODUCTION";
const id = "00000000-0000-4000-8000-000000000001";
test("rascunho preserva texto parcial, acentos e parágrafos sem ser uma autorização de envio", () => {
  for (const value of [{ assunto: "Re:", corpo: "" }, { assunto: "", corpo: "Resposta começada…\n\nD'Ávila, Brum-Bittencourt." }]) {
    assert.ok(validDraftInput(value));
    const cipher = encryptDraft(id, value); assert.ok(!cipher.includes(value.assunto || value.corpo));
    assert.deepEqual(decryptDraft(id, cipher), value);
    assert.equal(decryptDraft("00000000-0000-4000-8000-000000000002", cipher), null);
    const parts = cipher.split("."); parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
    assert.equal(decryptDraft(id, parts.join(".")), null);
  }
});
test("rascunho recusa campos extras, corpo excessivo e caracteres de controle inválidos", () => {
  for (const value of [null, [], {}, { assunto: "", corpo: " " }, { assunto: "QA", corpo: "QA", to: "injected@example.test" }, { assunto: "x".repeat(151), corpo: "QA" }, { assunto: "QA", corpo: "x".repeat(5001) }, { assunto: "QA\r\nBcc: injected", corpo: "QA" }, { assunto: "QA", corpo: "QA\0" }]) assert.equal(validDraftInput(value), false);
  assert.throws(() => encryptDraft("wrong-id", { assunto: "QA", corpo: "QA" }), /draft_parameters/);
});
