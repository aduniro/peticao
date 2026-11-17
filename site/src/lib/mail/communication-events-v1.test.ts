import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { bindCommunicationAccount, normalizeCommunicationEvent, canonicalCommunicationTime, communicationRawBodySha256, derivedCommunicationSourceId, type CommunicationAccountBinding, type AccountRegistryEntry } from "./communication-events-v1";

const golden = JSON.parse(readFileSync(new URL("./communication-events-v1.fixture.json", import.meta.url), "utf8"));
const scope = "b".repeat(64);
const registry: AccountRegistryEntry[] = [{ provider: "ses", authenticated_scope: scope, account_id: "fixture-ses-account" }];
function bound(rows = registry, authScope = scope): CommunicationAccountBinding {
  const result = bindCommunicationAccount("ses", { status: 200, scope: authScope }, rows);
  assert.equal(result.mode, "bound");
  if (result.mode !== "bound") throw new Error("fixture_binding_failed");
  return result.binding;
}

test("absent registry and legacy unscoped authentication do not emit canonical events", () => {
  assert.equal(bindCommunicationAccount("ses", { status: 200, scope }).mode, "legacy");
  assert.equal(bindCommunicationAccount("ses", { status: 200 }, registry).mode, "legacy");
});

test("authentication failures propagate and configured missing or ambiguous bindings fail closed", () => {
  for (const status of [401, 503] as const) assert.equal(bindCommunicationAccount("ses", { status, scope }, registry).status, status);
  assert.equal(bindCommunicationAccount("ses", { status: 200, scope }, []).status, 503);
  assert.equal(bindCommunicationAccount("ses", { status: 200, scope }, [...registry, ...registry]).status, 503);
  assert.equal(bindCommunicationAccount("ses", { status: 200, scope: scope + "\n" }, registry).status, 503);
});

test("account binding cannot be reconstructed by JSON, spread, or a caller boolean", () => {
  const binding = bound();
  for (const fake of [JSON.parse(JSON.stringify(binding)), { ...binding }, { ...golden.binding, authentication_verified: true }]) {
    assert.throws(() => normalizeCommunicationEvent(golden.input, fake), /untrusted_account_binding/);
  }
  assert.ok(Object.isFrozen(binding));
});

test("Python golden identity and semantic digests match exactly", () => {
  const { legacy_account_scope, ...event } = normalizeCommunicationEvent(golden.input, bound());
  assert.equal(legacy_account_scope, scope);
  assert.deepEqual(event, golden.expected);
});

test("recipient fanout produces separate event and message identities", () => {
  const a = normalizeCommunicationEvent(golden.input, bound());
  const b = normalizeCommunicationEvent({ ...golden.input, contact_key: "c".repeat(64) }, bound());
  assert.equal(a.source_event_id, b.source_event_id);
  assert.notEqual(a.event_id, b.event_id);
  assert.notEqual(a.idempotency_key, b.idempotency_key);
  assert.notEqual(a.message_key, b.message_key);
});

test("stable account identity survives authenticated scope rotation", () => {
  const nextScope = "d".repeat(64);
  const next = bound([{ ...registry[0], authenticated_scope: nextScope }], nextScope);
  const { legacy_account_scope: oldAlias, ...a } = normalizeCommunicationEvent(golden.input, bound());
  const { legacy_account_scope: newAlias, ...b } = normalizeCommunicationEvent(golden.input, next);
  assert.notEqual(oldAlias, newAlias);
  assert.deepEqual(a, b);
});

test("different stable accounts namespace source occurrence IDs", () => {
  const a = normalizeCommunicationEvent(golden.input, bound());
  const b = normalizeCommunicationEvent(golden.input, bound([{ ...registry[0], account_id: "other-account" }]));
  assert.notEqual(a.idempotency_key, b.idempotency_key);
  assert.notEqual(a.message_key, b.message_key);
});

test("conflicting content retains identity but changes semantic digest", () => {
  const a = normalizeCommunicationEvent(golden.input, bound());
  const b = normalizeCommunicationEvent({ ...golden.input, event_type: "hard_bounce" }, bound());
  assert.equal(a.idempotency_key, b.idempotency_key);
  assert.notEqual(a.payload_sha256, b.payload_sha256);
});

test("UTC conversion retains six fractional digits and calendar boundaries", () => {
  assert.equal(canonicalCommunicationTime("2026-11-16T23:59:59.123456-04:00"), "2026-11-17T03:59:59.123456Z");
  assert.equal(canonicalCommunicationTime("2024-02-29T00:00:00.1+05:30"), "2024-02-28T18:30:00.100000Z");
  assert.equal(canonicalCommunicationTime("0001-01-01T00:00:00Z"), "0001-01-01T00:00:00.000000Z");
  for (const bad of ["2026-02-29T00:00:00Z", "2026-11-31T00:00:00Z", "2026-11-17T24:00:00Z", "2026-11-17T00:00:00", "2026-11-17T00:00:00Z\n", "2026-11-17T00:00:00.1234567Z", "0000-01-01T00:00:00Z", "2026-11-17T00:00:00+24:00"]) assert.throws(() => canonicalCommunicationTime(bad), /invalid_event_time/);
});

test("SMTP acceptance and polling evidence cannot assert delivery", () => {
  for (const evidence_kind of ["smtp_250", "send_date", "poll_clock"]) assert.throws(() => normalizeCommunicationEvent({ ...golden.input, evidence_kind }, bound()), /invalid_event_evidence/);
});

test("unsubscribe requires explicit server-owned scope", () => {
  const occurrence = { ...golden.input, event_type: "unsubscribe" };
  assert.throws(() => normalizeCommunicationEvent(occurrence, bound()), /unsubscribe_scope_required/);
  for (const unsubscribe_scope of ["marketing", "all"] as const) {
    const event = normalizeCommunicationEvent(occurrence, bound([{ ...registry[0], unsubscribe_scope }]));
    assert.equal(event.applies_to, unsubscribe_scope);
  }
});

test("exact raw body digest preserves whitespace and original byte representation", () => {
  assert.notEqual(communicationRawBodySha256('{"a":1}'), communicationRawBodySha256('{ "a": 1 }'));
  assert.equal(communicationRawBodySha256("ação"), communicationRawBodySha256(Buffer.from("ação", "utf8")));
});

test("derived occurrence identity is deterministic and requires actual timestamp", () => {
  const a = derivedCommunicationSourceId("m1", "delivered", "2026-11-16T12:00:00-04:00");
  assert.match(a, /^derived-v1:[a-f0-9]{64}$/);
  assert.equal(a, derivedCommunicationSourceId("m1", "delivered", "2026-11-16T16:00:00Z"));
  assert.notEqual(a, derivedCommunicationSourceId("m1", "clicked", "2026-11-16T16:00:00Z"));
  assert.throws(() => derivedCommunicationSourceId("m1", "delivered", undefined), /invalid_event_time/);
});

test("private and caller-owned account fields are refused with code-only errors", () => {
  for (const key of ["email", "body", "token", "url", "account_id", "headers"]) {
    assert.throws(() => normalizeCommunicationEvent({ ...golden.input, [key]: "private-fixture-value" }, bound()), error => error instanceof Error && error.message === "invalid_event_fields");
  }
  assert.throws(() => normalizeCommunicationEvent({ ...golden.input, event_id: "fixture\n" }, bound()), /invalid_event_id/);
});
