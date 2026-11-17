import test from "node:test";
import assert from "node:assert/strict";
import { a1JobView, createA1JobViewState, updateA1JobView, type A1JobObservation, type A1SigningIntent } from "./a1-job-view";

const requestId = "10000000-0000-4000-8000-000000000001";
const jobId = "20000000-0000-4000-8000-000000000001";
const outputVersionId = "30000000-0000-4000-8000-000000000001";
const documentVersion = "a".repeat(64);
const intent: A1SigningIntent = { batchId: 12, requestId, expectedDocumentVersion: documentVersion, expectedPolicyRevision: 3 };
const job = (extra: Partial<A1JobObservation> = {}): A1JobObservation => ({ jobId, requestId, batchId: 12, documentVersion, policyRevision: 3, revision: 1, state: "queued", ...extra });
const ready = () => updateA1JobView(createA1JobViewState(12), { type: "read_received", availability: { ok: true, available: true, documentVersion, policyRevision: 3 } });
const started = () => updateA1JobView(ready(), { type: "request_started", intent });
const admitted = (extra: Partial<A1JobObservation> = {}) => updateA1JobView(started(), { type: "request_admitted", requestId, job: job(extra) });

test("A1 indisponível ou ainda não consultada nunca habilita POST", () => {
  const initial = createA1JobViewState(12);
  assert.equal(a1JobView(initial).controls.canRequest, false);
  assert.equal(a1JobView(initial).nextRead?.method, "GET");
  for (const availability of [{ ok: true as const, available: false, error: "disabled" }, { ok: true as const, available: false, error: "document_unavailable" }, { ok: false as const, error: "forbidden" }]) {
    assert.equal(a1JobView(updateA1JobView(initial, { type: "read_received", availability })).controls.canRequest, false);
  }
  assert.equal(a1JobView(ready()).phase, "enabled");
  assert.equal(a1JobView(ready()).controls.canRequest, true);
});

test("admissão exige intenção explícita e bindings atuais, sem duplicação por clique", () => {
  const state = ready();
  for (const bad of [{ ...intent, batchId: 13 }, { ...intent, expectedDocumentVersion: "b".repeat(64) }, { ...intent, expectedPolicyRevision: 4 }, { ...intent, requestId: "invalid" }]) {
    assert.equal(updateA1JobView(state, { type: "request_started", intent: bad }), state);
  }
  const pending = started();
  assert.notEqual(pending.intent, intent);
  assert.equal(pending.postPending, true);
  assert.equal(a1JobView(pending).controls.canRequest, false);
  assert.equal(updateA1JobView(pending, { type: "request_started", intent }), pending);
});

test("falha da rede após POST conserva requestId/versões e só propõe GET", () => {
  const uncertain = updateA1JobView(started(), { type: "request_transport_failed", requestId });
  assert.deepEqual(uncertain.intent, intent);
  assert.equal(uncertain.resultUncertain, true);
  assert.equal(a1JobView(uncertain).controls.canRequest, false);
  assert.deepEqual(a1JobView(uncertain).nextRead, { method: "GET", batchId: 12, requestId, jobId: null });
  assert.deepEqual(a1JobView(uncertain).effects, { approveBatch: false, sendBatch: false, repeatPost: false });
  const absent = updateA1JobView(uncertain, { type: "read_received", availability: { ok: true, available: true, documentVersion, policyRevision: 3, latestJob: null } });
  assert.equal(absent.resultUncertain, true, "ausência de último job não prova que POST perdido falhou");
});

test("GET reconcilia somente a intenção exata, não outra tentativa do mesmo lote", () => {
  const uncertain = updateA1JobView(started(), { type: "request_transport_failed", requestId });
  const other = updateA1JobView(uncertain, { type: "read_received", availability: { ok: true, available: false, latestJob: job({ requestId: "10000000-0000-4000-8000-000000000002" }) } });
  assert.equal(other.job, null);
  assert.equal(other.resultUncertain, true);
  const noRequestId = job(); delete noRequestId.requestId;
  assert.equal(updateA1JobView(uncertain, { type: "read_received", availability: { ok: true, available: false, latestJob: noRequestId } }).resultUncertain, true);
  const confirmed = updateA1JobView(uncertain, { type: "read_received", availability: { ok: true, available: false, latestJob: job() } });
  assert.equal(confirmed.resultUncertain, false);
  assert.equal(confirmed.job?.jobId, jobId);
  assert.deepEqual(confirmed.intent, intent);
});

test("queued/running/validating desabilitam nova solicitação e permitem acompanhar por GET", () => {
  for (const state of ["queued", "running", "validating"] as const) {
    const value = admitted({ state });
    assert.equal(a1JobView(value).phase, state === "queued" ? "queued" : "running");
    assert.equal(a1JobView(value).controls.canRequest, false);
    assert.equal(a1JobView(value).nextRead?.method, "GET");
    assert.equal(a1JobView(value).signaturePublished, false);
  }
});

test("worker succeeded sem versão/hash publicados não significa assinatura concluída", () => {
  for (const extra of [{}, { outputVersionId }, { outputVersionId, outputSha256: "invalid" }, { outputVersionId: "invalid", outputSha256: "b".repeat(64) }]) {
    const view = a1JobView(admitted({ state: "succeeded", ...extra }));
    assert.equal(view.signaturePublished, false);
    assert.equal(view.phase, null);
    assert.equal(view.completionUnproven, true);
    assert.equal(view.controls.canRequest, false);
    assert.equal(view.nextRead?.method, "GET");
  }
  const view = a1JobView(admitted({ state: "succeeded", outputVersionId, outputSha256: "b".repeat(64) }));
  assert.equal(view.phase, "succeeded");
  assert.equal(view.signaturePublished, true);
  assert.equal(view.controls.canReadSignedVersion, true);
  assert.equal(view.effects.approveBatch, false);
  assert.equal(view.effects.sendBatch, false);
});

test("failed/stale/cancelled conservam bindings e não repetem POST automaticamente", () => {
  for (const state of ["failed", "stale", "cancelled"] as const) {
    const value = admitted({ state, errorCode: "document_changed" });
    assert.deepEqual(value.intent, intent);
    assert.equal(value.job?.jobId, jobId);
    assert.equal(a1JobView(value).phase, state === "cancelled" ? "stale" : state);
    assert.equal(a1JobView(value).effects.repeatPost, false);
    assert.equal(updateA1JobView(value, { type: "request_started", intent }), value, "requestId antigo não vira nova intenção");
  }
});

test("GET fora de ordem, falha de leitura e erro do POST preservam a identidade da operação", () => {
  const running = admitted({ state: "running", revision: 4 });
  const outdated = updateA1JobView(running, { type: "read_received", availability: { ok: true, available: false, latestJob: job({ state: "queued", revision: 2 }) } });
  assert.equal(outdated.job?.revision, 4);
  const failedRead = updateA1JobView(running, { type: "read_transport_failed" });
  assert.deepEqual(failedRead.intent, intent);
  assert.equal(failedRead.job?.jobId, jobId);
  assert.equal(a1JobView(failedRead).controls.canRequest, false);
  const rejected = updateA1JobView(started(), { type: "request_rejected", requestId, error: "policy_conflict" });
  assert.deepEqual(rejected.intent, intent);
  assert.equal(a1JobView(rejected).nextRead?.method, "GET");
  assert.equal(updateA1JobView(running, { type: "request_transport_failed", requestId }), running, "erro atrasado de transporte não desfaz resposta já confirmada");
});

test("resposta de outro lote/versão/política ou operação anterior não altera job atual", () => {
  for (const bad of [{ batchId: 13 }, { documentVersion: "c".repeat(64) }, { policyRevision: 7 }]) {
    const state = updateA1JobView(started(), { type: "request_admitted", requestId, job: job(bad) });
    assert.equal(state.job, null);
    assert.equal(state.resultUncertain, true);
  }
  const current = started();
  assert.equal(updateA1JobView(current, { type: "request_admitted", requestId: "old-request", job: job() }), current);
});
