import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { freezeBatchPackage, verifyBatchPackage, batchPackageMessageKey } from "./batch-package-contract";
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
const batch=Buffer.from("%PDF-batch immutable synthetic fixture"),base=Buffer.from("%PDF-base immutable synthetic fixture");
const input=()=>({batchId:1,documentVersion:"a".repeat(64),batch:{versionId:"11111111-1111-4111-8111-111111111111",sha256:sha(batch),byteLength:batch.length},basePetition:{artifactId:"22222222-2222-4222-8222-222222222222",versionId:"33333333-3333-4333-8333-333333333333",sha256:sha(base),byteLength:base.length,validationState:"valid" as const,method:"gov-br-advanced" as const}});
const budget={maxEncodedBytes:25000000,reservedEnvelopeBytes:65536};
test("package v2 is deterministic, immutable and references separate exact artifacts",()=>{const source=input(),a=freezeBatchPackage(source),b=freezeBatchPackage(input());assert.ok(a.ok&&b.ok);assert.equal(a.packageDigest,b.packageDigest);assert.deepEqual(a.manifest.attachments.map(x=>x.role),['batch','petition-base']);source.basePetition.versionId='44444444-4444-4444-8444-444444444444';assert.notEqual(source.basePetition.versionId,a.manifest.basePetition.versionId);assert.ok(Object.isFrozen(a.manifest.attachments[0]));assert.ok(!a.canonical.includes(a.packageDigest));});
test("changing base version invalidates the old package and key",()=>{const a=freezeBatchPackage(input());assert.ok(a.ok);const changed=input();changed.basePetition.versionId='44444444-4444-4444-8444-444444444444';const b=freezeBatchPackage(changed);assert.ok(b.ok);assert.notEqual(a.packageDigest,b.packageDigest);assert.notEqual(batchPackageMessageKey(1,a.packageDigest,'b'.repeat(64)),batchPackageMessageKey(1,b.packageDigest,'b'.repeat(64)));assert.match(batchPackageMessageKey(1,a.packageDigest,'b'.repeat(64)),/^batch-send:v2:/);});
test("both exact PDFs required; an altered or missing attachment never passes",()=>{const a=freezeBatchPackage(input());assert.ok(a.ok);const blobs=new Map([[a.manifest.batch.versionId,batch],[a.manifest.basePetition.versionId,base]]);assert.ok(verifyBatchPackage(a.manifest,a.packageDigest,blobs,budget).ok);blobs.set(a.manifest.basePetition.versionId,Buffer.from('%PDF-altered'));assert.equal(verifyBatchPackage(a.manifest,a.packageDigest,blobs,budget).ok,false);blobs.delete(a.manifest.basePetition.versionId);assert.equal(verifyBatchPackage(a.manifest,a.packageDigest,blobs,budget).ok,false);});
test("unknown signature state, role collision and attachment budget fail closed",()=>{const source=input();assert.equal(freezeBatchPackage({...source,basePetition:{...source.basePetition,validationState:'unknown' as any}}).ok,false);assert.equal(freezeBatchPackage({...source,basePetition:{...source.basePetition,versionId:source.batch.versionId}}).ok,false);const a=freezeBatchPackage(source);assert.ok(a.ok);assert.equal(verifyBatchPackage(a.manifest,a.packageDigest,new Map([[a.manifest.batch.versionId,batch],[a.manifest.basePetition.versionId,base]]),{maxEncodedBytes:100,reservedEnvelopeBytes:50}).ok,false);});

test("malformed runtime inputs fail closed without throwing", () => {
  const valid = freezeBatchPackage(input()); assert.ok(valid.ok);
  for (const [manifest, blobs, limits] of [[null, new Map(), budget], [valid.manifest, null, budget], [valid.manifest, new Map(), null], [valid.manifest, {}, budget]]) {
    assert.deepEqual(verifyBatchPackage(manifest as any, valid.packageDigest, blobs as any, limits as any), { ok: false, error: "package_invalid" });
  }
});
