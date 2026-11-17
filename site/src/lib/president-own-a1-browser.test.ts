import test from "node:test";
import assert from "node:assert/strict";
import { submitA1Intent, readA1Intent, readA1Availability } from "./a1-request";
import { readA1Reconciliation } from "./a1-reconciliation";
import { createA1JobViewState, updateA1JobView, a1JobView } from "./a1-job-view";
const own="33333333-3333-4333-8333-333333333333";
const intent={batchId:1,requestId:"11111111-1111-4111-8111-111111111111",expectedDocumentVersion:"a".repeat(64),expectedPolicyRevision:1,expectedOwnArtifactId:own};
const job={jobId:"22222222-2222-4222-8222-222222222222",requestId:intent.requestId,batchId:1,documentVersion:intent.expectedDocumentVersion,policyRevision:1,revision:1,state:"queued"as const,ownArtifactId:own};
test("combined transport projects explicit own UUID and requires same UUID in acknowledgment",async()=>{
 let calls=0;
 const f=(async(_:unknown,init?:RequestInit)=>{calls++;assert.equal(JSON.parse(init?.body as string).expectedOwnArtifactId,own);return Response.json({ok:true,replayed:false,job},{status:202});})as typeof fetch;
 assert.equal((await submitA1Intent(intent,f)).kind,"success");assert.equal(calls,1);
 for(const id of [undefined,null,"44444444-4444-4444-8444-444444444444"])assert.equal((await submitA1Intent(intent,(async()=>Response.json({ok:true,replayed:false,job:{...job,ownArtifactId:id}},{status:202}))as typeof fetch)).kind,"uncertain");
});
test("exact GET recovery requires same own UUID and never sends selection in a POST",async()=>{
 let calls=0;
 const f=(async(path,init)=>{calls++;assert.equal(path,"/api/admin/lotes/1/a1?requestId="+intent.requestId);assert.equal(init?.method,"GET");assert.equal(init?.body,undefined);return Response.json({ok:true,job});})as typeof fetch;
 assert.equal((await readA1Intent(intent,f)).kind,"success");assert.equal(calls,1);
});
test("client reducer preserves selected own UUID and rejects original-only acknowledgment",()=>{
 let state=updateA1JobView(createA1JobViewState(1),{type:"read_received",availability:{ok:true,available:true,documentVersion:intent.expectedDocumentVersion,policyRevision:1,ownArtifactId:own}});
 state=updateA1JobView(state,{type:"request_started",intent});assert.equal(state.intent?.expectedOwnArtifactId,own);
 const mismatched=updateA1JobView(state,{type:"request_admitted",requestId:intent.requestId,job:{...job,ownArtifactId:null}});assert.equal(mismatched.resultUncertain,true);assert.equal(a1JobView(mismatched).effects.repeatPost,false);
 const matched=updateA1JobView(state,{type:"request_admitted",requestId:intent.requestId,job});assert.equal(matched.resultUncertain,false);assert.equal(matched.job?.ownArtifactId,own);
});

test("own-mode availability GET projects exact requested mode and rejects cross-mode metadata",async()=>{
 let calls=0;const f=(async(path,init)=>{calls++;assert.equal(path,"/api/admin/lotes/1/a1?expectedOwnArtifactId="+own);assert.equal(init?.method,"GET");return Response.json({ok:true,available:true,documentVersion:intent.expectedDocumentVersion,policyRevision:1,ownArtifactId:own});})as typeof fetch;
 assert.equal((await readA1Availability(1,f,15000,own)).kind,"success");assert.equal(calls,1);
 for(const patch of [{ownArtifactId:null},{ownArtifactId:"44444444-4444-4444-8444-444444444444"},{latestJob:{...job,ownArtifactId:null}}])assert.equal((await readA1Availability(1,(async()=>Response.json({ok:true,available:true,documentVersion:intent.expectedDocumentVersion,policyRevision:1,ownArtifactId:own,...patch}))as typeof fetch,15000,own)).kind,"uncertain");
});
test("own reconciliation preserves fourth-argument mode and reducer never binds a foreign latest job",async()=>{
 let calls=0;const f=(async(path)=>{calls++;assert.equal(path,"/api/admin/lotes/1/a1?expectedOwnArtifactId="+own);return Response.json({ok:true,available:true,documentVersion:intent.expectedDocumentVersion,policyRevision:1,ownArtifactId:own});})as typeof fetch;
 const state=createA1JobViewState(1);const r=await readA1Reconciliation(state,f,15000,own);assert.equal(r.event.type,"read_received");assert.equal(calls,1);
 const foreign=updateA1JobView(state,{type:"read_received",availability:{ok:true,available:true,documentVersion:intent.expectedDocumentVersion,policyRevision:1,ownArtifactId:own,latestJob:{...job,ownArtifactId:null}}});assert.equal(foreign.errorCode,"job_binding_mismatch");assert.equal(a1JobView(foreign).controls.canRequest,false);
});
