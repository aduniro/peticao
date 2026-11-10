import test from "node:test";
import assert from "node:assert/strict";
import { validateBase, readBaseValidation, type BaseHttpResult } from "./petition-base-request";
import { parseBasePending, validationRefusal, releaseUnrecordedValidation, matchBaseRecovery, type BasePending } from "./petition-base-view";

const input = { requestId: "11111111-1111-4111-8111-111111111111", artifactId: "22222222-2222-4222-8222-222222222222", sha256: "a".repeat(64) };
const original: BasePending = { kind: "validation", input };
const json = (value: unknown, status: number) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const journal = { ok: true, ...input, attemptId: "33333333-3333-4333-8333-333333333333", state: "pending", validationId: null, contextMatches: true, isCurrent: false };

for (const gate of [
  { status: 403, body: { ok: false, erro: "stepup" }, error: "stepup_required" },
  { status: 401, body: { ok: false, erro: "Não autorizado." }, error: "authentication_required" },
  { status: 429, body: { ok: false, erro: "Muitas ações em pouco tempo. Aguarde um minuto." }, error: "request_rejected" },
]) {
  test(`validation recovers after pre-reservation gate ${gate.status}/${gate.error} only with authenticated absent GET`, async () => {
    let posts = 0, gets = 0;
    const transport = (async (_path, init) => {
      if (init?.method === "POST") { posts++; return json(gate.body, gate.status); }
      gets++;
      return gets === 1 ? json({ ok: false, erro: "stepup" }, 403) : json({ ok: false, error: "not_found" }, 404);
    }) as typeof fetch;
    // The UI stores the identity before POST; persist the recognized receipt and reload it.
    const posted = await validateBase(input.artifactId, input.sha256, transport, 1000, input.requestId);
    assert.deepEqual(posted, { kind: "rejected", status: gate.status, error: gate.error });
    const refusal = validationRefusal(posted); assert.ok(refusal);
    const restored = parseBasePending(JSON.parse(JSON.stringify({ ...original, refusal })), 7); assert.ok(restored);
    assert.equal(releaseUnrecordedValidation(restored, null), false);
    assert.equal(releaseUnrecordedValidation(restored, await readBaseValidation(input, transport)), false);
    // Same actor reauthenticates / rate limit expires. This GET is exact and authenticated.
    assert.equal(releaseUnrecordedValidation(restored, await readBaseValidation(input, transport)), true);
    assert.equal(posts, 1); assert.equal(gets, 2); // No automatic POST after recovery.
  });
}

test("lost POST after reservation and a pending GET preserve identity, even after an auth refusal", async () => {
  let posts = 0, gets = 0;
  const transport = (async (_path, init) => {
    if (init?.method === "POST") { posts++; throw Error("response lost after durable reservation"); }
    gets++; return gets === 1 ? json({ ok: false, erro: "stepup" }, 403) : json(journal, 200);
  }) as typeof fetch;
  const posted = await validateBase(input.artifactId, input.sha256, transport, 1000, input.requestId);
  assert.equal(posted.kind, "uncertain"); assert.equal(validationRefusal(posted), null);
  assert.equal(releaseUnrecordedValidation(original, await readBaseValidation(input, transport)), false);
  const pending = await readBaseValidation(input, transport);
  assert.equal(releaseUnrecordedValidation(original, pending), false);
  assert.ok(pending.kind === "success"); assert.equal(matchBaseRecovery(original, pending.value), "pending");
  const oldReceipt = { ...original, refusal: { status: 403, error: "stepup_required" } };
  assert.equal(releaseUnrecordedValidation(oldReceipt, pending), false);
  assert.equal(releaseUnrecordedValidation(original, { kind: "rejected", status: 404, error: "not_found" }), false);
  assert.equal(posts, 1); assert.equal(gets, 2);
});

test("actor refusal, collision and uncertain reads never release a gate-refused intent", () => {
  const restored = parseBasePending({ ...original, refusal: { status: 403, error: "stepup_required" } }, 7); assert.ok(restored);
  const failures: BaseHttpResult<unknown>[] = [
    { kind: "rejected", status: 403, error: "forbidden" },
    { kind: "rejected", status: 401, error: "authentication_required" },
    { kind: "rejected", status: 409, error: "request_conflict" },
    { kind: "rejected", status: 404, error: "other_resource" },
    { kind: "uncertain" },
  ];
  for (const failure of failures) assert.equal(releaseUnrecordedValidation(restored, failure), false);
  for (const [status, error] of [[403, "forbidden"], [403, "request_rejected"], [401, "parameters"], [429, "arbitrary_error"], [409, "profile_conflict"], [409, "request_conflict"]] as const) {
    assert.equal(validationRefusal({ kind: "rejected", status, error }), null);
    assert.equal(parseBasePending({ ...original, refusal: { status, error } }, 7), null);
  }
});
