import test from "node:test";
import assert from "node:assert/strict";
import { assessCommunicationEligibility as eligibility, assessCommunicationSuppression as suppression, type CommunicationFacts } from "./communication-eligibility";

const facts: CommunicationFacts = { record: "active", address: "valid", origin: "manual", review: "approved", basis: "recorded", evidence: "recorded", purpose: "campaign", retention: "in_policy", marketingOptOut: "no", globalSuppression: "no" };

test("a complete explicit review yields only conditional preparation readiness, never authorization or inferred consent", () => {
  const result = eligibility(facts);
  assert.deepEqual(result, { state: "eligible_for_preparation", reasons: [], authorizedToSend: false, consentInferred: false });
});

test("missing, malformed and unknown facts never become approval or a guessed retention/foundation", () => {
  for (const raw of [undefined, null, false, [], {}, { review: "approved" }, { ...facts, retention: "unknown" }, { ...facts, basis: "unknown" }, { ...facts, review: "yes" }, { ...facts, retentionDays: 30 }]) {
    const result = eligibility(raw); assert.equal(result.state, "unknown"); assert.equal(result.authorizedToSend, false); assert.equal(result.consentInferred, false);
  }
  assert.ok(eligibility({ ...facts, retention: "unknown" }).reasons.includes("retention_unknown"));
  assert.ok(eligibility({ ...facts, basis: "unknown" }).reasons.includes("basis_unknown"));
});

test("each explicit denial wins over unknowns, including malformed extra fields, without inventing legal interpretation", () => {
  const blocked: [keyof CommunicationFacts, string, string][] = [["record", "archived", "archived"], ["address", "invalid", "invalid_address"], ["review", "rejected", "review_rejected"], ["basis", "missing", "basis_missing"], ["evidence", "missing", "evidence_missing"], ["purpose", "other", "purpose_mismatch"], ["retention", "expired", "content_expired"], ["marketingOptOut", "yes", "marketing_optout"], ["globalSuppression", "yes", "global_suppression"]];
  for (const [key, value, reason] of blocked) {
    const result = eligibility({ review: "unknown", evidence: "unknown", [key]: value, unexpected: "not copied" });
    assert.equal(result.state, "ineligible"); assert.ok(result.reasons.includes(reason as never)); assert.equal(result.authorizedToSend, false);
  }
});

test("every unresolved field preserves tri-state uncertainty even if all other facts are positive", () => {
  for (const key of Object.keys(facts)) {
    assert.equal(eligibility({ ...facts, [key]: "unknown" }).state, "unknown", key);
    const partial = { ...facts } as Record<string, unknown>; delete partial[key]; assert.equal(eligibility(partial).state, "unknown", key);
  }
});

test("signature, contact, manual, CSV and abandoned-form origin do not imply opt-in", () => {
  for (const origin of ["signature", "contact", "manual", "csv", "abandoned"] as const) {
    const result = eligibility({ ...facts, origin, review: "unknown", basis: "unknown", evidence: "unknown" });
    assert.equal(result.state, "unknown"); assert.equal(result.consentInferred, false); assert.equal(result.authorizedToSend, false);
  }
});

test("marketing preference and global suppression remain independent across the full channel/status matrix", () => {
  for (const channel of ["marketing", "transactional", "unknown"] as const) for (const globalSuppression of ["yes", "no", "unknown"] as const) for (const marketingOptOut of ["yes", "no", "unknown"] as const) {
    const result = suppression({ channel, globalSuppression, marketingOptOut });
    const expected = globalSuppression === "yes" || channel === "marketing" && marketingOptOut === "yes" ? "suppressed" : channel === "unknown" || globalSuppression === "unknown" || channel === "marketing" && marketingOptOut === "unknown" ? "unknown" : "clear";
    assert.equal(result.state, expected, JSON.stringify({ channel, globalSuppression, marketingOptOut }));
  }
  assert.deepEqual(suppression({ channel: "transactional", globalSuppression: "no", marketingOptOut: "yes" }), { state: "clear", reasons: [] });
  assert.equal(suppression({ channel: "marketing", globalSuppression: "no" }).state, "unknown");
});

test("functions are deterministic and do not mutate facts, echo identifiers, inspect clocks or use network", () => {
  const input = Object.freeze({ ...facts }), original = structuredClone(input), fetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = (async () => { calls++; throw new Error("No network permitted"); }) as typeof fetch;
    assert.deepEqual(eligibility(input), eligibility(input)); assert.deepEqual(input, original);
    const result = eligibility({ ...facts, email: "QA-NEVER-OUTPUT@example.test", cpf: "QA-NEVER-OUTPUT-CPF" });
    assert.equal(result.state, "unknown"); assert.ok(result.reasons.includes("invalid_facts")); assert.ok(!JSON.stringify(result).includes("QA-NEVER-OUTPUT"));
    assert.equal(suppression({ channel: "marketing", globalSuppression: "yes", email: "QA-NEVER-OUTPUT@example.test" }).state, "suppressed");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = fetch; }
});

test("known campaign opt-out cannot be neutralized by an unknown review, unknown retention or malformed positive assertion", () => {
  for (const patch of [{ review: "unknown" }, { retention: "unknown" }, { origin: "unknown" }, { review: "APPROVED" }, { marketingEnabled: true }]) {
    const result = eligibility({ ...facts, ...patch, marketingOptOut: "yes" }); assert.equal(result.state, "ineligible"); assert.ok(result.reasons.includes("marketing_optout"));
  }
});
