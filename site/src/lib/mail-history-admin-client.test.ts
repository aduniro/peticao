import test from "node:test";import assert from "node:assert/strict";
import { historyClientCursor,parseHistoryPage,parseHistoryDetail,parseHistoryCollection,readHistoryMetadata } from "./mail-history-admin-client";
import type { HistoryRequest,HistoryRow,HistoryAttempt,HistoryEvent,HistoryDetail } from "./mail-history-admin-contract";
const stamp="2026-11-10T02:00:00.123456Z",uuid=(n:number)=>n.toString(16).padStart(8,"0")+"-0000-4000-8000-000000000000",key="message:"+uuid(1),encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString("base64url");
const request=(collection:"attempts"|"events",before?:string):Extract<HistoryRequest,{mode:"collection"}>=>({mode:"collection",key,collection,options:{limit:100,before}});
const attempt=(n:number):HistoryAttempt=>({id:uuid(n),provider:"qa",from_addr:"sender@example.test",state:"accepted",started_at:stamp,finished_at:stamp,provider_id:"QA-"+n,error_code:null});
const event=(n:number):HistoryEvent=>({id:(9007199254740993n+BigInt(n)).toString(),provider:"qa",event_type:"clicked",occurred_at:stamp,received_at:stamp,attempt_id:uuid(1)});
const attempts=Array.from({length:251},(_,i)=>attempt(251-i)),events=Array.from({length:205},(_,i)=>event(205-i));
const cursor=(collection:"attempts"|"events",row:HistoryAttempt|HistoryEvent)=>encode({v:1,key,collection,at:"started_at"in row?row.started_at:row.occurred_at,id:row.id});
const detail=():HistoryDetail=>({ok:true,key,asOf:stamp,source:"message",record:{id:uuid(1),created_at:stamp,kind:"confirmacao",channel:"transactional",to_addr:"qa@example.test",status:"accepted",previous_id:null,content_state:"stored"},content_state:"stored",attempts:attempts.slice(0,100),events:events.slice(0,100),attempts_truncated:true,events_truncated:true,attemptsPage:{total:251,returned:100,next:cursor("attempts",attempts[99]),complete:true},eventsPage:{total:205,returned:100,next:cursor("events",events[99]),complete:true}});
const legacy=():HistoryDetail=>({ok:true,key:"legacy:17",asOf:stamp,source:"legacy_attempt",record:{id:17,created_at:stamp,kind:"confirmacao",channel:"transactional",to_addr:"legacy@example.test",provider:"qa-legacy",from_addr:"Legacy <sender@example.test>",status:"sent"},content_state:"unavailable",attempts:[],events:[],attempts_truncated:false,events_truncated:false,attemptsPage:{total:0,returned:0,next:null,complete:true},eventsPage:{total:0,returned:0,next:null,complete:true}});
const rows:HistoryRow[]=Array.from({length:13},(_,i)=>({record_key:"message:"+uuid(13-i),source:"message",created_at:stamp,kind:"confirmacao",channel:"transactional",to_addr:"qa@example.test",status:"accepted",content_state:"stored",previous_id:null}));
const page=()=>({ok:true,asOf:stamp,total:13,records:rows.slice(0,10),next:encode({at:stamp,key:rows[9].record_key}),coverage:{total:13,returned:10,complete:true}});
test("complete list projection is bounded, ordered and cursor tied to exact microsecond boundary",()=>{
 const req:Extract<HistoryRequest,{mode:"list"}>={mode:"list",options:{limit:10}};assert.ok(parseHistoryPage(page(),req));assert.equal(historyClientCursor(page().next,req)?.at,stamp);
 for(const patch of [{records:rows.slice(0,9)},{next:encode({at:stamp,key:rows[8].record_key})},{records:[rows[1],rows[0],...rows.slice(2,10)]},{coverage:{total:13,returned:10,complete:false}}])assert.equal(parseHistoryPage({...page(),...patch},req),null);
 const follow={ok:true,asOf:stamp,total:13,records:rows.slice(10),next:null,coverage:{total:13,returned:3,complete:true}};assert.ok(parseHistoryPage(follow,{mode:"list",options:{limit:10,before:page().next}}));
});
test("details retain100 initial items plus explicit continuation beyond100 for each collection",()=>{
 const parsed=parseHistoryDetail(detail(),key);assert.ok(parsed);assert.equal(parsed.attemptsPage.total,251);assert.equal(parsed.eventsPage.total,205);
 for(const collection of ["attempts","events"]as const){const all=collection==="attempts"?attempts:events,before=cursor(collection,all[99]),second=all.slice(100,200),data={ok:true,key,collection,asOf:stamp,total:all.length,items:second,next:cursor(collection,all[199]),coverage:{total:all.length,returned:100,complete:true}};assert.ok(parseHistoryCollection(data,request(collection,before)));const tail={...data,items:all.slice(200),next:null,coverage:{total:all.length,returned:all.length-200,complete:true}};assert.ok(parseHistoryCollection(tail,request(collection,data.next)));}
});
test("legacy detail exposes only the real legacy provider/from/raw status and never invents an attempt or message",()=>{
 const parsed=parseHistoryDetail(legacy(),"legacy:17");assert.ok(parsed?.source==="legacy_attempt");assert.equal(parsed.record.status,"sent");assert.equal(parsed.record.provider,"qa-legacy");assert.equal(parsed.attempts.length,0);assert.ok(parseHistoryDetail({...legacy(),record:{...legacy().record,from_addr:null}},"legacy:17"));
 assert.equal(parseHistoryDetail({...legacy(),attempts:[attempt(1)],attemptsPage:{total:1,returned:1,next:null,complete:true}},"legacy:17"),null);
});
test("event IDs remain decimal bigint strings and are never rounded through Number",()=>{
 const a={...event(1),id:"10000000000000000"},b={...event(2),id:"9999999999999999"},data={ok:true,key,collection:"events",asOf:stamp,total:2,items:[a,b],next:null,coverage:{total:2,returned:2,complete:true}};const parsed=parseHistoryCollection(data,request("events"));assert.ok(parsed?.collection==="events");assert.notEqual(parsed.items[0].id,parsed.items[1].id);assert.equal(parseHistoryCollection({...data,items:[b,a]},request("events")),null);assert.equal(parseHistoryCollection({...data,items:[{...a,id:Number(a.id)},b]},request("events")),null);
});
test("collection cursor rejects different message, collection, malformed UTF8, duplicate keys and millisecond reconstruction",()=>{
 const cur=detail().attemptsPage.next!;assert.ok(historyClientCursor(cur,request("attempts")));assert.equal(historyClientCursor(cur,{...request("attempts"),key:"message:"+uuid(2)}),null);assert.equal(historyClientCursor(cur,request("events")),null);
 assert.equal(historyClientCursor(encode({v:1,key,collection:"attempts",at:"2026-11-10T02:00:00.123Z",id:uuid(152)}),request("attempts")),null);
 assert.equal(historyClientCursor(Buffer.from([255]).toString("base64url"),request("attempts")),null);const duplicate=Buffer.from(`{"at":"${stamp}","key":"${key}","key":"${key}"}`).toString("base64url");assert.equal(historyClientCursor(duplicate,{mode:"list",options:{}}),null);
});
test("extra payload/HTML/credential fields, bad context and incomplete claims are rejected",()=>{
 for(const change of [{html:"<script>bad</script>"},{payload:"secret"},{key:"message:"+uuid(2)},{attemptsPage:{...detail().attemptsPage,complete:false}},{attempts:detail().attempts.map((r,i)=>i?r:{...r,error_code:"provider free-form secret"})}])assert.equal(parseHistoryDetail({...detail(),...change},key),null);
 assert.equal(parseHistoryDetail({...detail(),record:{...detail().record,credential:"secret"}},key),null);assert.equal(parseHistoryPage({...page(),records:page().records.map((r,i)=>i?r:{...r,token:"secret"})},{mode:"list",options:{limit:10}}),null);
});
test("one fixed-origin GET validates contextual query before transport",async()=>{
 let calls=0;const fake=(async(path:unknown,init:RequestInit)=>{calls++;assert.equal(path,"/api/admin/emails/mensagens?id="+encodeURIComponent(key));assert.equal(init.method,"GET");assert.equal(init.cache,"no-store");assert.equal(init.credentials,"same-origin");assert.equal(init.redirect,"error");assert.equal(init.referrerPolicy,"no-referrer");return new Response(JSON.stringify(detail()),{headers:{"content-type":"application/json"}});})as typeof fetch;const result=await readHistoryMetadata(new URLSearchParams({id:key}),undefined,fake);assert.ok(result.ok&&result.mode==="detail");
 for(const params of [new URLSearchParams("id=bad"),new URLSearchParams({id:key,collection:"events",before:detail().attemptsPage.next!}),new URLSearchParams("limit=51"),new URLSearchParams("limit=10&limit=20")])assert.deepEqual(await readHistoryMetadata(params,undefined,fake),{ok:false,kind:"invalid"});assert.equal(calls,1);
});
test("deadline/abort/body budget/UTF8 and stuck cancellation do not retry or accept partial metadata",async()=>{
 let calls=0;const hang=(()=>{calls++;return new Promise(()=>{});})as typeof fetch,params=new URLSearchParams({id:key});const controller=new AbortController(),request=readHistoryMetadata(params,controller.signal,hang,100);controller.abort();assert.deepEqual(await request,{ok:false,kind:"aborted"});assert.deepEqual(await readHistoryMetadata(params,undefined,hang,5),{ok:false,kind:"uncertain"});assert.equal(calls,2);
 const stream=new ReadableStream({cancel:()=>new Promise(()=>{})});assert.deepEqual(await readHistoryMetadata(params,undefined,(async()=>new Response(stream,{status:403}))as typeof fetch,5),{ok:false,kind:"http",status:403});
 for(const response of [new Response('{}',{headers:{"content-type":"application/json","content-length":"4194305"}}),new Response(new Uint8Array([255]),{headers:{"content-type":"application/json"}})])assert.equal((await readHistoryMetadata(params,undefined,(async()=>response)as typeof fetch)).ok,false);
});
