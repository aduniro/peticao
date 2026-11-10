import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildPendingEmailCsv, PENDING_EMAIL_CSV_HEADERS } from "./pending-email-csv";
import type { PendingEmailRow } from "./pending-email-admin-contract";
const row = (id: number): PendingEmailRow => ({ id, version: "1", name: '="QA",\nPessoa', email: "qa@example.test", category: "servidor", instituicao: "QA", criada: "2026-11-10T12:00:00Z", criadaTxt: "QA", motivo: "sem registro", detalhe: "", provedor: "", dominio: "example.test", sugestao: null, motivoSugestao: null, suggestionSource: "none", state: "unrecorded", hasAcceptance: false, hasAdverse: false, providers: [], suppressed: false, suppressionReason: null, queued: false, queueSources: [], evidence: { scope: "none", registrationLink: "email_only", lastSignal: null, lastAcceptedAt: null, deliveredAt: null, openedAt: null, clickedAt: null, lastAdverse: null, legacyEngagementFirstOnly: false, latestConfirmationMessage: null } });
test("pending CSV is complete beyond500, preserves unknown evidence and never exports CAS tokens", () => {
  const rows = Array.from({ length: 501 }, (_, i) => ({ ...row(i + 1), version: "PRIVATE-CAS-MUST-NOT-EXPORT", name: "Pessoa " + (i + 1) }));
  const result = buildPendingEmailCsv(rows, 501), text = result.body.toString("utf8");
  assert.equal(result.rows, 501); assert.ok(text.includes('"Pessoa 501"')); assert.ok(text.includes('"sem registro"')); assert.ok(text.includes('"none","email_only"')); assert.equal(text.includes("PRIVATE-CAS-MUST-NOT-EXPORT"), false);
  assert.equal(result.bytes, result.body.byteLength); assert.equal(result.sha256, createHash("sha256").update(result.body).digest("hex"));
  assert.throws(() => buildPendingEmailCsv(rows, 502), /incomplete/); assert.throws(() => buildPendingEmailCsv([row(1), row(1)], 2), /invalid/);
});
test("pending CSV retains address-only chronology, adverse detail and explicitly unverified local suggestion", () => {
  const r = row(1); r.sugestao = "qa@example.invalid"; r.suggestionSource = "local_catalog"; r.state = "adverse"; r.hasAdverse = true;
  r.evidence = { ...r.evidence, scope: "address_aggregate", legacyEngagementFirstOnly: true, lastSignal: { state: "adverse", at: "2026-11-10T12:00:00Z", provider: "QA", source: "legacy_event" }, lastAdverse: { type: "blocked", at: "2026-11-10T12:00:00Z", provider: "QA", reason: "=detail,\"QA\"\nline" } };
  const text = buildPendingEmailCsv([r], 1).body.toString("utf8");
  assert.equal(PENDING_EMAIL_CSV_HEADERS.length, 34); assert.ok(text.startsWith('\uFEFF"id","nome"')); assert.ok(text.includes('"\'=""QA"",\nPessoa"')); assert.ok(text.includes('"\'=detail,""QA""\nline"')); assert.ok(text.includes("heurística local; MX não verificado")); assert.ok(text.includes('"address_aggregate","email_only"')); assert.ok(text.includes('"10/11/2026 09:00:00"'));
});
