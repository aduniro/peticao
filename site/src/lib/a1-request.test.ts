import test from "node:test";
import assert from "node:assert/strict";
import {readA1Availability,readA1Intent,submitA1Intent} from "./a1-request";
import type {A1SigningIntent} from "./a1-job-view";
const intent:A1SigningIntent={batchId:1,requestId:"11111111-1111-4111-8111-111111111111",expectedDocumentVersion:"a".repeat(64),expectedPolicyRevision:1};
const job=()=>({jobId:"22222222-2222-4222-8222-222222222222",requestId:intent.requestId,batchId:1,documentVersion:intent.expectedDocumentVersion,policyRevision:1,revision:1,state:"queued",outputVersionId:null,outputSha256:null,errorCode:null});
const accepted=(patch:Record<string,unknown>={})=>Response.json({ok:true,replayed:false,job:job(),...patch},{status:202});
const fetcher=(body:unknown,status=200)=>(async()=>Response.json(body,{status})) as typeof fetch;
test("explicit A1 POST has one projected payload and exact bound result",async()=>{
 let calls=0;
 const f=(async(url,init)=>{calls++;assert.equal(url,"/api/admin/lotes/1/a1");assert.equal(init?.method,"POST");assert.equal(init?.credentials,"same-origin");assert.equal(init?.cache,"no-store");assert.equal(init?.redirect,"error");assert.ok(init?.signal);assert.deepEqual(JSON.parse(init?.body as string),{requestId:intent.requestId,expectedDocumentVersion:intent.expectedDocumentVersion,expectedPolicyRevision:1});return accepted();}) as typeof fetch;
 const r=await submitA1Intent(intent,f);assert.equal(r.kind,"success");assert.equal(calls,1);
 const replay=await submitA1Intent(intent,fetcher({ok:true,replayed:true,job:job()},200));assert.equal(replay.kind,"success");
});
test("foreign request, document, policy, batch and inconsistent HTTP outcome are uncertain",async()=>{
 for(const patch of [{requestId:"33333333-3333-4333-8333-333333333333"},{documentVersion:"b".repeat(64)},{policyRevision:2},{batchId:2},{revision:0}])assert.equal((await submitA1Intent(intent,fetcher({ok:true,replayed:false,job:{...job(),...patch}},202))).kind,"uncertain");
 assert.equal((await submitA1Intent(intent,fetcher({ok:true,replayed:true,job:job()},202))).kind,"uncertain");assert.equal((await submitA1Intent(intent,fetcher({ok:true,replayed:false,job:job()},200))).kind,"uncertain");
});
test("invalid inputs never open transport or project credential fields",async()=>{
 let calls=0;const f=(async()=>{calls++;return accepted();}) as typeof fetch;
 for(const input of [{...intent,batchId:-1},{...intent,requestId:"../escape"},{...intent,pfxPath:"NEVER-PROJECT"},{...intent,expectedPolicyRevision:0}])assert.equal((await submitA1Intent(input as any,f)).kind,"rejected");
 assert.equal((await readA1Availability(0,f)).kind,"rejected");assert.equal((await readA1Intent({...intent,requestId:"bad"},f)).kind,"rejected");assert.equal(calls,0);
});
test("lost response and timeout never retry even when transport ignores abort",async()=>{
 let calls=0,signal:AbortSignal|undefined;
 const f=(async(_url,init)=>{calls++;signal=init?.signal as AbortSignal;return new Promise<Response>(()=>{});}) as typeof fetch;
 const result=await submitA1Intent(intent,f,5);assert.equal(result.kind,"uncertain");assert.equal(calls,1);assert.equal(signal?.aborted,true);
 const lost=(async()=>{calls++;throw new Error("PRIVATE ERROR");}) as typeof fetch;assert.equal((await submitA1Intent(intent,lost)).kind,"uncertain");assert.equal(calls,2);
});
test("deadline covers response stream and cancels an unfinished body",async()=>{
 let cancelled=false,calls=0;
 const response=new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('{"ok":true'));},cancel(){cancelled=true;}}),{status:202,headers:{"content-type":"application/json"}});
 const f=(async()=>{calls++;return response;}) as typeof fetch;
 assert.equal((await submitA1Intent(intent,f,5)).kind,"uncertain");assert.equal(cancelled,true);assert.equal(calls,1);
});
test("bounded UTF8/JSON and content-type checks cannot turn malformed data into success",async()=>{
 const responses=[new Response("{}",{headers:{"content-type":"text/html"}}),new Response(new Uint8Array([255]),{headers:{"content-type":"application/json"}}),new Response("x".repeat(65537),{headers:{"content-type":"application/json","content-length":"1"}}),new Response("{}",{headers:{"content-type":"application/json","content-length":"9999999"}}),Response.json([]),Response.json({ok:true,available:"true"})];
 for(const response of responses)assert.equal((await readA1Availability(1,(async()=>response) as typeof fetch)).kind,"uncertain");
});
test("availability and exact-intent reads are GET only and project metadata without secrets",async()=>{
 let calls=0;
 const f=(async(url,init)=>{calls++;assert.equal(url,"/api/admin/lotes/1/a1?requestId="+intent.requestId);assert.equal(init?.method,"GET");assert.equal(init?.body,undefined);return Response.json({ok:true,job:{...job(),leaseToken:"NEVER-EXPOSE",pfxPath:"NEVER-EXPOSE"}});}) as typeof fetch;
 const result=await readA1Intent(intent,f);assert.equal(result.kind,"success");assert.ok(!JSON.stringify(result).includes("NEVER-EXPOSE"));assert.equal(calls,1);
 const ready=await readA1Availability(1,fetcher({ok:true,available:true,documentVersion:intent.expectedDocumentVersion,policyRevision:1,latestJob:job()}));assert.equal(ready.kind,"success");
 assert.equal((await readA1Availability(1,fetcher({ok:true,available:true}))).kind,"uncertain");
});
test("HTTP denial is distinct from server/network uncertainty; absent intent does not POST",async()=>{
 assert.deepEqual(await submitA1Intent(intent,fetcher({ok:false,error:"active_job"},409)),{kind:"rejected",status:409,error:"active_job"});
 assert.equal((await submitA1Intent(intent,fetcher({ok:false,error:"unavailable"},503))).kind,"uncertain");
 assert.deepEqual(await readA1Intent(intent,fetcher({ok:false,error:"not_found"},404)),{kind:"rejected",status:404,error:"not_found"});
 assert.deepEqual(await readA1Availability(1,fetcher({ok:false,erro:"stepup"},403)),{kind:"rejected",status:403,error:"stepup_required"});
});

test("unexpected response type cancels its body without reading or retrying",async()=>{
 let cancelled=false,calls=0;
 const response=new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{"content-type":"text/html"}});
 const result=await readA1Availability(1,(async()=>{calls++;return response;}) as typeof fetch);assert.equal(result.kind,"uncertain");assert.equal(cancelled,true);assert.equal(calls,1);
});
