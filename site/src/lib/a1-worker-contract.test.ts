import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createA1WorkerRequest, parseA1WorkerResponse, type A1WorkerBinding } from "./a1-worker-contract";
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const original = Buffer.from("%PDF-QA-ORIGINAL");
const binding: A1WorkerBinding = { jobId: "11111111-1111-4111-8111-111111111111", documentVersion: "a".repeat(64), inputArtifactVersionId: "22222222-2222-4222-8222-222222222222", inputSha256: digest(original), credentialVersionId: "33333333-3333-4333-8333-333333333333", profileVersion: "pades-basic-unhomologated-v1", trustStoreVersion: "c".repeat(64), expectedCnpj: "15883671000115", certificateFingerprintSha256: "b".repeat(64) };
const response = () => { const output = Buffer.concat([original, Buffer.from("\nQA appended fixture; not cryptographic proof")]); return {
  ...createA1WorkerRequest(binding, original), ok: true, pdfBase64: output.toString("base64"), outputSha256: digest(output),
  report: { version: 1, engine: "pyHanko", engineVersion: "0.31.0", integrity: true, chainTrusted: true, holderCnpj: "15883671000115", coverage: "ENTIRE_FILE", docmdpOk: true, fingerprintSha256: "b".repeat(64), trustStoreVersion: "c".repeat(64), profile: "pades-basic-unhomologated-v1", environment: "synthetic-test", revocation: "not-required-synthetic-test", timestamp: "not-requested", icpBrasilQualified: false, homologated: false }
}; };
test("request binds exact input and never projects credential paths", () => {
  const request = createA1WorkerRequest({ ...binding, pfxPath: "/DO-NOT-PROJECT" } as A1WorkerBinding, original);
  assert.equal("pfxPath" in request, false);
  assert.throws(() => createA1WorkerRequest({ ...binding, inputSha256: "a".repeat(64) }, original));
  assert.throws(() => createA1WorkerRequest({ ...binding, jobId: "../../invalid" }, original));
});
test("technical response never grants ICP qualification", () => {
  const result = parseA1WorkerResponse(JSON.stringify(response()), binding, original);
  assert.ok(result.ok); assert.equal(result.icpBrasilQualified, false);
});
test("wrong binding, altered bytes and false/indeterminate evidence fail closed", () => {
  for (const patch of [{ jobId: "44444444-4444-4444-8444-444444444444" }, { inputSha256: "b".repeat(64) }, { outputSha256: "b".repeat(64) }, { pdfBase64: "%%%%" }, { ok: false }]) {
    assert.equal(parseA1WorkerResponse(JSON.stringify({ ...response(), ...patch }), binding, original).ok, false);
  }
  for (const patch of [{ integrity: false }, { chainTrusted: false }, { holderCnpj: "00000000000000" }, { coverage: "ENTIRE_REVISION" }, { docmdpOk: false }, { homologated: true }, { icpBrasilQualified: true }, { environment: "production", revocation: "not-required-synthetic-test" }]) {
    const value = response(); Object.assign(value.report, patch);
    assert.equal(parseA1WorkerResponse(JSON.stringify(value), binding, original).ok, false);
  }
  assert.equal(parseA1WorkerResponse("not json", binding, original).ok, false);
});
