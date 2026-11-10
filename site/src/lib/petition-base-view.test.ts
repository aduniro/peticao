import test from "node:test";
import assert from "node:assert/strict";
import { parseBasePending, matchBaseRecovery, validationRefusal, releaseUnrecordedValidation, basePendingRequestId } from "./petition-base-view";
import type { BasePending } from "./petition-base-view";
import type { BaseIntentView } from "./petition-base-request";
const requestId = "11111111-1111-4111-8111-111111111111", artifactId = "22222222-2222-4222-8222-222222222222", selectionId = "33333333-3333-4333-8333-333333333333", validationId = "44444444-4444-4444-8444-444444444444", hash = "a".repeat(64), version = "b".repeat(64);
const selected = { selectionId, revision: 1, validationId, artifactId, sha256: hash, petitionTextVersion: version };
const packaged = { packageId: requestId, batchId: 7, ordinal: 1, documentVersion: version, selectionId, baseArtifactId: artifactId, baseSha256: hash, batchSha256: hash, packageDigest: hash };
const choose = { requestId, expectedRevision: 0, expectedTextVersion: version, validationId, reviewedSha256: hash };
const prepare = { requestId, batchId: 7, expectedDocumentVersion: version, expectedSelectionId: selectionId, expectedPackageRevision: 0 };
test("pending storage accepts only bounded identities for the expected batch", () => {
  for (const value of [{ kind: "upload", requestId, sha256: hash }, { kind: "selection", input: choose }, { kind: "package", input: prepare }]) { const parsed = parseBasePending(JSON.parse(JSON.stringify(value)), 7); assert.deepEqual(parsed, value); assert.equal(basePendingRequestId(parsed!), requestId); }
  for (const value of [null, [], {}, { kind: "upload", requestId, sha256: hash, file: "%PDF" }, { kind: "package", input: { ...prepare, batchId: 8 } }, { kind: "selection", input: { ...choose, expectedRevision: -1 } }, { kind: "upload", requestId: "bad", sha256: hash }]) assert.equal(parseBasePending(value, 7), null);
});
test("an exact historical outcome is not promoted to the current selection or packet", () => {
  assert.equal(matchBaseRecovery({ kind: "selection", input: choose }, { kind: "selection", selection: selected, isCurrent: false }), "obsolete");
  assert.equal(matchBaseRecovery({ kind: "package", input: prepare }, { kind: "package", package: packaged, isCurrent: false }), "obsolete");
  assert.equal(matchBaseRecovery({ kind: "package", input: prepare }, { kind: "package", package: packaged, isCurrent: true }), "current");
});
test("another SHA, selection, revision, batch or operation cannot resolve an intent", () => {
  assert.equal(matchBaseRecovery({ kind: "upload", requestId, sha256: hash }, { kind: "upload", artifact: { artifactId, sha256: version, byteLength: 24, lastValidationId: null } }), "mismatch");
  for (const value of [{ ...selected, revision: 2 }, { ...selected, validationId: requestId }, { ...selected, sha256: version }]) assert.equal(matchBaseRecovery({ kind: "selection", input: choose }, { kind: "selection", selection: value, isCurrent: true }), "mismatch");
  for (const value of [{ ...packaged, ordinal: 2 }, { ...packaged, batchId: 8 }, { ...packaged, documentVersion: hash }, { ...packaged, selectionId: artifactId }]) assert.equal(matchBaseRecovery({ kind: "package", input: prepare }, { kind: "package", package: value, isCurrent: true }), "mismatch");
  assert.equal(matchBaseRecovery({ kind: "package", input: prepare }, { kind: "selection", selection: selected, isCurrent: true }), "mismatch");
});

test("validation intent survives serialization and pending recovery cannot release it", () => {
 const input = { requestId: "11111111-1111-4111-8111-111111111111", artifactId: "22222222-2222-4222-8222-222222222222", sha256: "a".repeat(64) };
 const pending = { kind: "validation" as const, input };
 assert.deepEqual(parseBasePending(JSON.parse(JSON.stringify(pending)), 7), pending);
 const observed = { kind: "validation" as const, validation: { ...input, attemptId: input.requestId, state: "pending" as const, contextMatches: true, validationId: null, isCurrent: false } };
 assert.equal(matchBaseRecovery(pending, observed), "pending");
 assert.equal(matchBaseRecovery(pending, { ...observed, validation: { ...observed.validation, requestId: input.artifactId } }), "mismatch");
 assert.equal(matchBaseRecovery(pending, { ...observed, validation: { ...observed.validation, state: "unavailable" } }), "obsolete");
});

test("controller releases only conclusive pre-reservation refusal plus exact absent readback", () => {
 const input = { requestId: "11111111-1111-4111-8111-111111111111", artifactId: "22222222-2222-4222-8222-222222222222", sha256: "a".repeat(64) };
 const absent = { kind: "rejected" as const, status: 404, error: "not_found" };
 const original: BasePending = { kind: "validation", input };
 // Simulate persist-before-POST, explicit protocol refusal, reload, then exact GET.
 for (const [status,error] of [[400,"parameters"],[404,"not_found"],[409,"document_conflict"],[409,"profile_unavailable"],[409,"disabled"]] as const) {
   const refusal=validationRefusal({kind:"rejected",status,error});assert.ok(refusal);
   const restored=parseBasePending(JSON.parse(JSON.stringify({...original,refusal})),7);assert.ok(restored);
   assert.equal(releaseUnrecordedValidation(restored,null),false);
   assert.equal(releaseUnrecordedValidation(restored,{kind:"uncertain"}),false);
   assert.equal(releaseUnrecordedValidation(restored,absent),true);
 }
 // Lost POST response is never evidence of non-reservation, even when GET races it.
 const restored=parseBasePending(JSON.parse(JSON.stringify(original)),7);assert.ok(restored);
 assert.equal(validationRefusal({kind:"uncertain"}),null);assert.equal(releaseUnrecordedValidation(restored,absent),false);
 for(const error of ["request_conflict","profile_conflict","validation_unavailable","forbidden"])assert.equal(validationRefusal({kind:"rejected",status:409,error}),null);
 const journal={kind:"validation" as const,validation:{...input,attemptId:input.requestId,state:"pending" as const,contextMatches:true,validationId:null,isCurrent:false}};
 assert.equal(matchBaseRecovery(restored,journal),"pending");
 assert.equal(releaseUnrecordedValidation({...original,refusal:{status:400,error:"parameters"}},{kind:"success",value:journal}),false);
 // External failure after reservation resolves as its recorded terminal result, not a non-reservation.
 assert.equal(matchBaseRecovery(restored,{...journal,validation:{...journal.validation,state:"unavailable"}}),"obsolete");
 assert.equal(matchBaseRecovery(restored,{...journal,validation:{...journal.validation,state:"valid",validationId:input.requestId,isCurrent:true}}),"current");
 // A changed profile/policy makes an old pending intent explicitly obsolete; it does not authorize replay.
 assert.equal(matchBaseRecovery(restored,{...journal,validation:{...journal.validation,contextMatches:false}}),"obsolete");
});
