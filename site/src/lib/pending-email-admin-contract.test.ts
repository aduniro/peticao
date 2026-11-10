import test from "node:test";
import assert from "node:assert/strict";
import { pendingEmailSearch, pendingEmailQuery, pendingEmailBefore, encodePendingEmailBefore, pendingEmailCount, pendingEmailTimestamp, latestPendingEmailSignal, type PendingEmailSignal } from "./pending-email-admin-contract";
test("pending read query preserves literal commas/brackets, explicit filters and opaque ID cursor", () => {
  const before = encodePendingEmailBefore(601), options = { before, limit: 100, filters: { institution: "Instituto QA, [Campus]", q: "Jose qa@example.test", queued: "yes" as const } };
  assert.equal(pendingEmailBefore(before), 601);
  const parsed = pendingEmailSearch(new URLSearchParams(pendingEmailQuery(options))); assert.ok(parsed.ok); assert.deepEqual(parsed.options, options); assert.equal(parsed.format, "json");
  const empty = pendingEmailSearch(new URLSearchParams()); assert.ok(empty.ok); assert.equal(empty.options.limit, 50); assert.deepEqual(empty.options.filters, {});
});
test("pending parser refuses duplicate/unknown parameters, invalid flags, numeric ambiguity and partial CSV cursor", () => {
  for (const q of ["q=x&q=y", "extra=x", "limit=0", "limit=101", "limit=1.5", "limit=Infinity", "state=not_received", "queued=true", "category=other", "before=x", "formato=csv&before=" + encodePendingEmailBefore(1)]) assert.equal(pendingEmailSearch(new URLSearchParams(q)).ok, false, q);
  assert.equal(pendingEmailBefore(encodePendingEmailBefore(1) + "="), null); assert.equal(pendingEmailBefore(btoa(JSON.stringify({ v: 1, id: 1, extra: true })).replace(/=+$/, "")), null);
});
test("last chronological signal defeats older click and conservative ties put adverse first", () => {
  const clicked: PendingEmailSignal = { state: "clicked", at: "2026-11-09T12:00:00Z", provider: "brevo", source: "legacy_engagement" };
  const adverse: PendingEmailSignal = { state: "adverse", at: "2026-11-10T12:00:00Z", provider: "ses", source: "legacy_event" };
  assert.equal(latestPendingEmailSignal([clicked, adverse])!.state, "adverse");
  assert.equal(latestPendingEmailSignal([adverse, { ...clicked, at: adverse.at }])!.state, "adverse");
  assert.equal(latestPendingEmailSignal([adverse, { ...clicked, at: "2026-11-10T12:00:00.000001Z" }])!.state, "clicked");
  assert.equal(latestPendingEmailSignal([]), null);
});
test("timestamps preserve micros and reject impossible dates; counts never truncate bigint overflow", () => {
  assert.equal(pendingEmailTimestamp("2026-11-10T12:00:00.123456Z"), "2026-11-10T12:00:00.123456Z"); assert.equal(pendingEmailTimestamp("2026-11-10T12:00:00Z"), "2026-11-10T12:00:00.000000Z");
  for (const v of ["2026-02-30T12:00:00Z", "0000-01-01T12:00:00Z", "not a date"]) assert.throws(() => pendingEmailTimestamp(v));
  assert.equal(pendingEmailCount("9007199254740991"), Number.MAX_SAFE_INTEGER); for (const v of ["9007199254740992", "01", -1, 1.5, Infinity]) assert.equal(pendingEmailCount(v), null);
});
