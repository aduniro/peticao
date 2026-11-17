import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifyA1Pdf, isVerifiedA1Pdf, a1ValidationReady, type VerifiedA1Pdf } from "./a1-validation";
import { A1_AD_RB_POLICY, A1_PROFILE_VERSIONS, type A1WorkerBinding } from "./a1-worker-contract";
const bytes=Buffer.from("%PDF-A1-VALIDATION-FIXTURE-NOT-CRYPTOGRAPHIC-PROOF");
const digest=(value:Buffer)=>createHash("sha256").update(value).digest("hex");
const binding:A1WorkerBinding={jobId:"11111111-1111-4111-8111-111111111111",documentVersion:"a".repeat(64),inputArtifactVersionId:"22222222-2222-4222-8222-222222222222",inputSha256:"d".repeat(64),credentialVersionId:"33333333-3333-4333-8333-333333333333",profileVersion:"pades-basic-unhomologated-v1",trustStoreVersion:"c".repeat(64),expectedCnpj:"15883671000115",certificateFingerprintSha256:"b".repeat(64)};
// Deliberately fictitious private-enterprise OID. No normative ICP assertion.
const profile="QA-HOMOLOGATED-FIXTURE",policyOid="1.3.6.1.4.1.55555.1";
const envKeys=["A1_VALIDATION_ENABLED","A1_VALIDATION_ACCEPTED_POLICIES","ICP_VALIDATOR_URL","ICP_VALIDATOR_TOKEN"] as const;
async function fixture(run:()=>Promise<void>){const old=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));Object.assign(process.env,{A1_VALIDATION_ENABLED:"1",A1_VALIDATION_ACCEPTED_POLICIES:JSON.stringify([{profile,policyOid}]),ICP_VALIDATOR_URL:"https://validator.example.invalid/v2",ICP_VALIDATOR_TOKEN:"QA-TOKEN"});try{await run();}finally{for(const key of envKeys)if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
function report(){return{protocol:"peticao-a1-validation",version:2,valid:true,sha256:digest(bytes),cnpj:binding.expectedCnpj,certificateFingerprintSha256:binding.certificateFingerprintSha256,integrity:true,icpBrasilChainTrusted:true,coverage:"entire-file",modificationsAllowed:true,revocation:"good",profile,policyOid,validatedAt:new Date().toISOString(),validatorVersion:"qa-2.0"};}
const fetchResponse=(value:unknown)=>(async()=>Response.json(value)) as typeof fetch;
test("default-off and missing/malformed policy never contact validator",async()=>fixture(async()=>{
 let calls=0;const fetcher=(async()=>{calls++;return Response.json(report());}) as typeof fetch;
 assert.equal(a1ValidationReady(),true);
 delete process.env.A1_VALIDATION_ENABLED;assert.equal(a1ValidationReady(),false);assert.equal((await verifyA1Pdf(bytes,binding,fetcher)).ok,false);
 process.env.A1_VALIDATION_ENABLED="1";
 for(const policy of [undefined,"[]","not json",JSON.stringify([{profile:"*",policyOid}]),JSON.stringify([{profile,policyOid:"1.50.1"}]),JSON.stringify([{profile:"pades-basic-unhomologated-v1",policyOid}])]){
  if(policy===undefined)delete process.env.A1_VALIDATION_ACCEPTED_POLICIES;else process.env.A1_VALIDATION_ACCEPTED_POLICIES=policy;
  assert.equal(a1ValidationReady(),false);assert.equal((await verifyA1Pdf(bytes,binding,fetcher)).ok,false);
 }
 assert.equal(calls,0);
}));
test("v2 positive proof is process-local, immutable and bound to all bytes/job metadata",async()=>fixture(async()=>{
 let calls=0;
 const fetcher=(async(url,init)=>{calls++;assert.equal(url,"https://validator.example.invalid/v2");assert.equal(init?.method,"POST");assert.equal(init?.redirect,"error");assert.equal((init?.headers as Record<string,string>).authorization,"Bearer QA-TOKEN");assert.equal((init?.headers as Record<string,string>)["content-type"],"application/pdf");assert.ok(init?.signal);assert.deepEqual(Buffer.from(init?.body as Uint8Array),bytes);return Response.json(report());}) as typeof fetch;
 const result=await verifyA1Pdf(bytes,binding,fetcher);assert.ok(result.ok);assert.equal(calls,1);
 assert.ok(isVerifiedA1Pdf(result.proof,bytes,binding));
 assert.ok(Object.isFrozen(result.proof));assert.ok(Object.isFrozen(result.proof.metadata));
 for(const fake of [JSON.parse(JSON.stringify(result.proof)),{...result.proof},Object.create(result.proof),{metadata:result.proof.metadata} as VerifiedA1Pdf])assert.equal(isVerifiedA1Pdf(fake,bytes,binding),false);
 assert.equal(isVerifiedA1Pdf(result.proof,Buffer.concat([bytes,Buffer.from("changed")]),binding),false);
 for(const patch of [{jobId:"44444444-4444-4444-8444-444444444444"},{documentVersion:"e".repeat(64)},{inputSha256:"e".repeat(64)},{credentialVersionId:"44444444-4444-4444-8444-444444444444"},{trustStoreVersion:"e".repeat(64)},{certificateFingerprintSha256:"e".repeat(64)}])assert.equal(isVerifiedA1Pdf(result.proof,bytes,{...binding,...patch}),false);
 assert.equal(JSON.stringify(result.proof).includes("QA-TOKEN"),false);assert.equal(JSON.stringify(result.proof).includes("pdfBase64"),false);
 const realNow=Date.now;try{Date.now=()=>realNow()+6*60_000;assert.equal(isVerifiedA1Pdf(result.proof,bytes,binding),false);}finally{Date.now=realNow;}
 process.env.A1_VALIDATION_ENABLED="0";assert.equal(isVerifiedA1Pdf(result.proof,bytes,binding),false);
}));
test("legacy, missing evidence, indeterminate status, wrong policy and stale timestamp cannot mint proof",async()=>fixture(async()=>{
 const patches=[{version:1},{protocol:"legacy"},{valid:"true"},{valid:false},{sha256:"0".repeat(64)},{cnpj:"00000000000000"},{certificateFingerprintSha256:"0".repeat(64)},{integrity:false},{icpBrasilChainTrusted:false},{coverage:"entire-revision"},{modificationsAllowed:false},{revocation:"unknown"},{profile:"NOT-APPROVED"},{policyOid:"1.3.6.1.4.1.55555.2"},{validatedAt:"2020-01-01T00:00:00.000Z"},{validatedAt:new Date(Date.now()+120000).toISOString()},{validatedAt:"2026-11-09T10:00:00-04:00"},{validatorVersion:"x\nprivate"},{privateKey:"never allowed"}];
 for(const patch of patches)assert.equal((await verifyA1Pdf(bytes,binding,fetchResponse({...report(),...patch}))).ok,false,JSON.stringify(patch));
 assert.equal((await verifyA1Pdf(bytes,binding,fetchResponse({valid:true,cnpj:binding.expectedCnpj}))).ok,false);
 const missing:Record<string,unknown>=report();delete missing.modificationsAllowed;assert.equal((await verifyA1Pdf(bytes,binding,fetchResponse(missing))).ok,false);
}));
test("allowlist preserves profile-OID pairs, not cross-products",async()=>fixture(async()=>{
 process.env.A1_VALIDATION_ACCEPTED_POLICIES=JSON.stringify([{profile,policyOid},{profile:"OTHER-QA",policyOid:"1.3.6.1.4.1.55555.2"}]);
 assert.equal((await verifyA1Pdf(bytes,binding,fetchResponse({...report(),policyOid:"1.3.6.1.4.1.55555.2"}))).ok,false);
}));
test("HTTP failure, malformed UTF8/JSON and body over64KiB fail closed",async()=>fixture(async()=>{
 const responses=[new Response("{}",{status:503}),new Response("not JSON",{headers:{"content-type":"application/json"}}),new Response(new Uint8Array([0xff]),{headers:{"content-type":"application/json"}}),new Response("x".repeat(65537),{headers:{"content-type":"application/json"}}),new Response(JSON.stringify(report()),{headers:{"content-type":"text/plain"}})];
 for(const response of responses)assert.equal((await verifyA1Pdf(bytes,binding,(async()=>response) as typeof fetch)).ok,false);
 assert.equal((await verifyA1Pdf(bytes,binding,(async()=>{throw new Error("PRIVATE ERROR MUST NOT ESCAPE");}) as typeof fetch)).ok,false);
}));
test("policy/input mutation during fetch and later token rotation invalidate proof",async()=>fixture(async()=>{
 const mutable=Buffer.from(bytes);const fetcher=(async()=>{mutable[mutable.length-1]^=1;return Response.json(report());}) as typeof fetch;
 assert.equal((await verifyA1Pdf(mutable,binding,fetcher)).ok,false);
 const policyMutation=(async()=>{process.env.A1_VALIDATION_ACCEPTED_POLICIES="[]";return Response.json(report());}) as typeof fetch;
 assert.equal((await verifyA1Pdf(bytes,binding,policyMutation)).ok,false);
 process.env.A1_VALIDATION_ACCEPTED_POLICIES=JSON.stringify([{profile,policyOid}]);
 const result=await verifyA1Pdf(bytes,binding,fetchResponse(report()));assert.ok(result.ok);
 process.env.ICP_VALIDATOR_TOKEN="ROTATED";assert.equal(isVerifiedA1Pdf(result.proof,bytes,binding),false);
}));

test("all unhomologated producer profile names remain forbidden as accepted validation profiles",async()=>fixture(async()=>{
 for(const producer of A1_PROFILE_VERSIONS){process.env.A1_VALIDATION_ACCEPTED_POLICIES=JSON.stringify([{profile:producer,policyOid:A1_AD_RB_POLICY.oid}]);assert.equal(a1ValidationReady(),false);}
}));
test("declared AD-RB binding only accepts matching OID from the independent configured validator (mock contract only)",async()=>fixture(async()=>{
 const b:A1WorkerBinding={...binding,profileVersion:"pades-ad-rb-declared-unhomologated-v1"};
 process.env.A1_VALIDATION_ACCEPTED_POLICIES=JSON.stringify([{profile,policyOid:A1_AD_RB_POLICY.oid},{profile,policyOid}]);
 assert.equal((await verifyA1Pdf(bytes,b,fetchResponse(report()))).ok,false);
 const accepted=await verifyA1Pdf(bytes,b,fetchResponse({...report(),policyOid:A1_AD_RB_POLICY.oid}));assert.ok(accepted.ok);assert.ok(isVerifiedA1Pdf(accepted.proof,bytes,b));assert.equal(isVerifiedA1Pdf(accepted.proof,bytes,binding),false);
}));
