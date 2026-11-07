import test from "node:test";
import assert from "node:assert/strict";
import { triageViewHistory, triageViewSuggestion } from "./contact-triage-display";

const row = { id: 5, contact_id: 2, revision: 3, status: "complete", created_at: "2026-11-07T10:00:00Z", finished_at: "2026-11-07T10:01:00Z", error_code: null, analysis: { category: "cpf", reasons: ["no_cpf_check_evidence"], worker_secret: "NEVER_DISPLAY" }, evidence: { unavailable: ["events"], lease_token: "NEVER_DISPLAY" }, lease_token: "NEVER_DISPLAY" };
test("triage display limits history, validates contact/order/dates and strips worker fields", () => {
  const parsed = triageViewHistory([row], 2); assert.ok(parsed);
  assert.equal(parsed[0].revision, 3); assert.ok(!JSON.stringify(parsed).includes("NEVER_DISPLAY"));
  for (const value of [null, {}, [null], [row, row], [{ ...row, contact_id: 3 }], [{ ...row, created_at: "invalid" }], [{ ...row, status: "unknown" }], [{ ...row, status: { toString: "invalid" } }], [row, { ...row, id: 6, revision: 4 }], Array(11).fill(row)]) assert.equal(triageViewHistory(value, 2), null);
});
test("suggestion view binds the displayed draft to the latest complete revision and drops proof", () => {
  const latest = triageViewHistory([row], 2)![0];
  const suggestion = { ok: true, persisted: false, requiresHumanReview: true, proof: "NEVER_DISPLAY", context: { contactId: 2, jobId: 5, revision: 3 }, draft: { assunto: "QA", corpo: "QA manual review" } };
  assert.deepEqual(triageViewSuggestion(suggestion, 2, latest), { subject: "QA", body: "QA manual review" });
  for (const value of [{ ...suggestion, requiresHumanReview: false }, { ...suggestion, context: { ...suggestion.context, revision: 2 } }, { ...suggestion, draft: { assunto: "QA", corpo: 12 } }]) assert.equal(triageViewSuggestion(value, 2, latest), null);
  assert.equal(triageViewSuggestion(suggestion, 2, { ...latest, status: "queued" }), null);
});
