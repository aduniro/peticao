import test from "node:test";
import assert from "node:assert/strict";
import { a1JobView, createA1JobViewState, updateA1JobView, type A1JobObservation, type A1SigningIntent } from "./a1-job-view";
import { readA1Reconciliation, applyA1Reconciliation } from "./a1-reconciliation";
const requestId = "10000000-0000-4000-8000-000000000001";
const documentVersion = "a".repeat(64);
const intent: A1SigningIntent = { batchId: 12, requestId, expectedDocumentVersion: documentVersion, expectedPolicyRevision: 3 };
const job = (extra: Partial<A1JobObservation> = {}): A1JobObservation => ({ jobId: "20000000-0000-4000-8000-000000000001", requestId, batchId: 12, documentVersion, policyRevision: 3, revision: 1, state: "queued", ...extra });
const ready = () => updateA1JobView(createA1JobViewState(12), { type: "read_received", availability: { ok: true, available: true, documentVersion, policyRevision: 3 } });
const started = () => updateA1JobView(ready(), { type: "request_started", intent });
const uncertain = () => updateA1JobView(started(), { type: "request_transport_failed", requestId });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const fake = (response: Response, calls: string[]) => (async (url, init) => { calls.push(`${init?.method} ${url}`); return response; }) as typeof fetch;

test("uncertain result reconciles the exact intent even after newer jobs, with one GET", async () => {
  const calls: string[] = [];
  const state = uncertain();
  const observation = await readA1Reconciliation(state, fake(json({ ok: true, job: job({ state: "succeeded", revision: 4, outputVersionId: "30000000-0000-4000-8000-000000000001", outputSha256: "b".repeat(64) }) }), calls));
  assert.deepEqual(calls, [`GET /api/admin/lotes/12/a1?requestId=${requestId}`]);
  const result = applyA1Reconciliation(state, observation);
  assert.equal(result.resultUncertain, false);
  assert.equal(a1JobView(result).signaturePublished, true);
  assert.deepEqual(a1JobView(result).effects, { approveBatch: false, sendBatch: false, repeatPost: false });
});

test("404, malformed response, timeout and denial never enable a new signing request", async () => {
  for (const [body, status] of [[{ ok: false, error: "not_found" }, 404], [{ ok: false, erro: "stepup" }, 403], [{ ok: true, job: job({ batchId: 13 }) }, 200]] as const) {
    const calls: string[] = [], state = uncertain();
    const result = applyA1Reconciliation(state, await readA1Reconciliation(state, fake(json(body, status), calls)));
    assert.equal(calls.length, 1); assert.match(calls[0], /^GET /);
    assert.equal(result.resultUncertain, true); assert.equal(a1JobView(result).controls.canRequest, false);
    assert.deepEqual(result.intent, intent);
  }
  const state = uncertain(), hanging = (async () => new Promise<Response>(() => {})) as typeof fetch;
  const result = applyA1Reconciliation(state, await readA1Reconciliation(state, hanging, 5));
  assert.equal(result.resultUncertain, true); assert.equal(result.errorCode, "read_transport_failed");
});

test("late reads cannot replace another selected batch or a newly selected intent", async () => {
  const state = uncertain(), calls: string[] = [];
  const observation = await readA1Reconciliation(state, fake(json({ ok: true, job: job() }), calls));
  const other = createA1JobViewState(13);
  assert.equal(applyA1Reconciliation(other, observation), other);
  const replacement = { ...state, intent: { ...intent, requestId: "10000000-0000-4000-8000-000000000002" } };
  assert.equal(applyA1Reconciliation(replacement, observation), replacement);
  const initial = createA1JobViewState(12);
  const availability = await readA1Reconciliation(initial, fake(json({ ok: true, available: true, documentVersion, policyRevision: 3 }), []));
  assert.equal(applyA1Reconciliation(state, availability), state);
});

test("confirmed GET wins over a delayed POST error and older job revisions", async () => {
  const state = started();
  const observed = await readA1Reconciliation(state, fake(json({ ok: true, job: job({ state: "running", revision: 5 }) }), []));
  const running = applyA1Reconciliation(state, observed);
  assert.equal(running.postPending, false);
  assert.equal(updateA1JobView(running, { type: "request_transport_failed", requestId }), running);
  const older = await readA1Reconciliation(running, fake(json({ ok: true, job: job({ revision: 2 }) }), []));
  assert.equal(applyA1Reconciliation(running, older).job?.revision, 5);
});

test("failed exact job requires fresh availability and never starts a replacement", async () => {
  const state = uncertain();
  const result = applyA1Reconciliation(state, await readA1Reconciliation(state, fake(json({ ok: true, job: job({ state: "failed", revision: 2 }) }), [])));
  assert.equal(result.resultUncertain, false); assert.equal(result.refreshRequired, true);
  assert.equal(a1JobView(result).controls.canRequest, false); assert.equal(a1JobView(result).effects.repeatPost, false);
});

test("initial availability uses only GET and cannot publish an unproven successful output", async () => {
  const state = createA1JobViewState(12), calls: string[] = [];
  const observation = await readA1Reconciliation(state, fake(json({ ok: true, available: false, latestJob: job({ state: "succeeded" }) }), calls));
  assert.deepEqual(calls, ["GET /api/admin/lotes/12/a1"]);
  const result = applyA1Reconciliation(state, observation);
  assert.equal(a1JobView(result).signaturePublished, false); assert.equal(a1JobView(result).completionUnproven, true);
});
