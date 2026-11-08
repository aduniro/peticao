import test from "node:test";
import assert from "node:assert/strict";
import { parseDraftView } from "./contact-draft-view";
import { contactReplyLabel } from "./contact-reply-state";

test("view do rascunho valida o conteúdo antes de substituir o texto do editor", () => {
  const valid = { revision: 1, state: "stored", input: { assunto: "QA", corpo: "QA parágrafos\n\nJosé" }, author: "QA Autor", updatedAt: "2026-11-08T10:00:00Z", expiresAt: "2026-12-08T10:00:00Z" };
  assert.deepEqual(parseDraftView(valid), valid);
  for (const value of [null, [], { ...valid, revision: -1 }, { ...valid, revision: 1.1 }, { ...valid, state: "expired" }, { ...valid, author: {} }, { ...valid, updatedAt: "invalid" }, { ...valid, input: { assunto: "QA\r\ninjection", corpo: "QA" } }, { ...valid, input: { assunto: "QA", corpo: "x".repeat(5001) } }]) assert.equal(parseDraftView(value), null);
  assert.deepEqual(parseDraftView({ ...valid, state: "expired", input: null })?.input, null);
});

test("estados de resposta preservam incerteza e não convertem aceite em entrega", () => {
  for (const [estado, label] of Object.entries({ prepared: "Aguardando envio", blocked: "Aguardando o texto", sending: "Envio em andamento", accepted: "Aceita pelo provedor", uncertain: "Resultado a conferir", rejected: "Recusada" })) {
    for (const ok of [true, false]) assert.equal(contactReplyLabel({ estado, ok, agendada: true }), label);
  }
  assert.match(contactReplyLabel({ estado: "legacy", ok: true, agendada: false }), /Histórico anterior/);
  assert.equal(contactReplyLabel({ estado: "unknown", ok: true, agendada: false }), "Resultado a conferir");
});
