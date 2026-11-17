import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parsePresidentState, parsePresidentConfirmation, presidentJsonRequest, presidentPdfRequest, samePresidentDocument, validPresidentCredentials, type PresidentDocument } from "./president-client";
const credentials={token:"t".repeat(43),password:"p".repeat(12)};
const bytes=new TextEncoder().encode("%PDF-1.7 FICTITIOUS TEST DOCUMENT ONLY");
const sha=createHash("sha256").update(bytes).digest("hex");
const doc:PresidentDocument={batchId:1,seq:1,kind:"partial",documentVersion:"a".repeat(64),sha256:sha,byteLength:bytes.byteLength};
const receipt={receiptId:"00000000-0000-4000-8000-000000000001",confirmedAt:"2026-11-10T08:00:00.000Z",assurance:"own-confirmation",icpBrasil:false,govBr:false};
const snapshot=()=>({ok:true,state:"issued",canConfirm:true,expiresAt:"2026-11-10T09:00:00.000Z",document:{...doc},receipt:null});
const mock=(f:(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>)=>f as typeof fetch;
test("state parser keeps consumed receipt distinct from ICP/gov.br and rejects mismatched state",()=>{
 assert.ok(parsePresidentState(snapshot()));
 assert.ok(parsePresidentState({...snapshot(),state:"consumed",canConfirm:false,receipt}));
 for(const bad of [{state:"consumed",receipt:null},{state:"consumed",receipt},{state:"consumed",canConfirm:false,receipt:{...receipt,icpBrasil:true}},{state:"issued",receipt},{document:{...doc,byteLength:26*1024*1024}},{document:{...doc,documentVersion:"bad"}},{canConfirm:"yes"}])assert.equal(parsePresidentState({...snapshot(),...bad}),null);
 assert.ok(parsePresidentConfirmation({ok:true,...receipt}));assert.equal(parsePresidentConfirmation({ok:true,...receipt,govBr:true}),null);
 assert.equal(samePresidentDocument(doc,{...doc,sha256:"b".repeat(64)}),false);
 assert.equal(validPresidentCredentials(credentials),true);assert.equal(validPresidentCredentials({...credentials,token:"bad"}),false);
});
test("JSON transport sends one credential-bound POST, omits cookies and never retries lost/rejected responses",async()=>{
 let calls=0;
 const transport=mock(async(path,init)=>{calls++;assert.equal(path,"/api/presidente/estado");assert.equal(init?.method,"POST");assert.equal(init?.credentials,"omit");assert.equal(init?.redirect,"error");assert.equal(init?.referrerPolicy,"no-referrer");assert.deepEqual(JSON.parse(init?.body as string),credentials);return Response.json(snapshot());});
 const result=await presidentJsonRequest("/api/presidente/estado",credentials,transport);assert.equal(result.ok,true);assert.equal(calls,1);
 calls=0;const failed=await presidentJsonRequest("/api/presidente/confirmar",{},mock(async()=>{calls++;throw Error("lost after commit");}));assert.deepEqual(failed,{ok:false,kind:"uncertain"});assert.equal(calls,1);
 calls=0;const rejected=await presidentJsonRequest("/api/presidente/confirmar",{},mock(async()=>{calls++;return new Response("",{status:409});}));assert.deepEqual(rejected,{ok:false,kind:"http",status:409});assert.equal(calls,1);
});
test("JSON refuses HTML, malformed UTF-8, oversized declared and streamed bodies",async()=>{
 const responses=[new Response("<html>login</html>",{headers:{"content-type":"text/html"}}),new Response(new Uint8Array([255]),{headers:{"content-type":"application/json"}}),new Response("{}",{headers:{"content-type":"application/json","content-length":"20000"}}),new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(17000));c.close();}}),{headers:{"content-type":"application/json"}})];
 for(const response of responses){const result=await presidentJsonRequest("/api/presidente/estado",{},mock(async()=>response));assert.deepEqual(result,{ok:false,kind:"invalid"});}
});
test("deadline returns uncertain once for a hung fetch or response stream and aborts transport",async()=>{
 let calls=0,signal:AbortSignal|undefined;
 const result=await presidentJsonRequest("/api/presidente/confirmar",{},mock(async(_p,init)=>{calls++;signal=init?.signal??undefined;return new Promise<Response>(()=>{});}),15);
 assert.deepEqual(result,{ok:false,kind:"uncertain"});assert.equal(calls,1);assert.equal(signal?.aborted,true);
 let cancelled=false;
 const stream=new ReadableStream<Uint8Array>({pull(){return new Promise<void>(()=>{});},cancel(){cancelled=true;}});
 assert.deepEqual(await presidentJsonRequest("/api/presidente/estado",{},mock(async()=>new Response(stream,{headers:{"content-type":"application/json"}})),15),{ok:false,kind:"uncertain"});
 assert.equal(cancelled,true);
});
test("PDF download verifies exact version, advertised SHA, bytes length, PDF header and independently computed SHA",async()=>{
 const response=(body:Uint8Array=bytes,headers:Record<string,string>={})=>new Response(new Uint8Array(body).buffer,{headers:{"content-type":"application/pdf","x-document-version":doc.documentVersion,"x-document-sha256":sha,...headers}});
 let calls=0;
 const good=await presidentPdfRequest(credentials,doc,mock(async(_p,init)=>{calls++;assert.equal(init?.credentials,"omit");return response();}));assert.ok(good.ok);assert.deepEqual(good.data,bytes);assert.equal(calls,1);
 const changed=new Uint8Array(bytes);changed[15]^=1;
 for(const r of [response(changed),response(bytes,{"x-document-version":"b".repeat(64)}),response(bytes,{"x-document-sha256":"c".repeat(64)}),response(bytes,{"content-type":"text/html"}),response(bytes.slice(1))])assert.deepEqual(await presidentPdfRequest(credentials,doc,mock(async()=>r)),{ok:false,kind:"invalid"});
});
