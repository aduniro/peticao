import test from "node:test";
import assert from "node:assert/strict";
import { readPendingEmailJson } from "./pending-email-admin-client";
test("pending reader is one private fixed-origin GET",async()=>{
 let calls=0;const fake=(async(path:unknown,init:RequestInit)=>{calls++;assert.equal(path,"/api/admin/emails/pendentes?limit=50");assert.equal(init.method,"GET");assert.equal(init.credentials,"same-origin");assert.equal(init.cache,"no-store");assert.equal(init.redirect,"error");assert.equal(init.referrerPolicy,"no-referrer");assert.equal(init.body,undefined);return new Response('{"ok":true}',{headers:{"content-type":"application/json"}});})as typeof fetch;
 assert.deepEqual(await readPendingEmailJson(new URLSearchParams("limit=50"),undefined,fake),{ok:true,value:{ok:true}});assert.equal(calls,1);
});
test("abort and deadline terminate uncooperative fetch without retry",async()=>{
 let calls=0;const hang=(()=>{calls++;return new Promise(()=>{});})as typeof fetch;
 const controller=new AbortController(),pending=readPendingEmailJson(new URLSearchParams(),controller.signal,hang,1000);controller.abort();assert.deepEqual(await pending,{ok:false,kind:"aborted"});assert.equal(calls,1);
 assert.deepEqual(await readPendingEmailJson(new URLSearchParams(),undefined,hang,5),{ok:false,kind:"uncertain"});assert.equal(calls,2);
});
test("known authorization errors never wait for stuck cancellation",async()=>{
 for(const status of [401,403]){const stream=new ReadableStream({cancel:()=>new Promise(()=>{})});assert.deepEqual(await readPendingEmailJson(new URLSearchParams(),undefined,(async()=>new Response(stream,{status}))as typeof fetch,10),{ok:false,kind:"http",status});}
});
test("wrong MIME, oversized declaration and invalid UTF8 fail closed",async()=>{
 for(const response of [new Response('{}',{headers:{"content-type":"text/html"}}),new Response('{}',{headers:{"content-type":"application/json","content-length":"33554433"}}),new Response(new Uint8Array([255]),{headers:{"content-type":"application/json"}})])assert.equal((await readPendingEmailJson(new URLSearchParams(),undefined,(async()=>response)as typeof fetch)).ok,false);
});

import { parsePendingEmailReadResult,readPendingEmails } from "./pending-email-admin-client";
import { encodePendingEmailBefore } from "./pending-email-admin-contract";
const states=()=>({clicked:0,opened:0,delivered:0,adverse:0,accepted:0,unrecorded:600});
const row=(id:number)=>({id,version:"42",name:"QA Pessoa",email:"qa@example.test",category:"servidor",instituicao:"Instituição QA, Campus Norte",criada:"2026-11-10T00:00:00.000001Z",criadaTxt:"09/11/2026",motivo:"sem registro",detalhe:"Sem sinal registrado",provedor:"",dominio:"example.test",sugestao:null,motivoSugestao:null,suggestionSource:"none",state:"unrecorded",hasAcceptance:false,hasAdverse:false,providers:[],suppressed:false,suppressionReason:null,queued:false,queueSources:[],evidence:{scope:"none",registrationLink:"email_only",lastSignal:null,lastAcceptedAt:null,deliveredAt:null,openedAt:null,clickedAt:null,lastAdverse:null,legacyEngagementFirstOnly:false,latestConfirmationMessage:null}});
const fixture=()=>{const counts={total:600,byState:states(),suppressed:0,queued:0,withSuggestion:0,withAcceptance:0,withAdverse:0};return{ok:true,asOf:"2026-11-10T01:00:00.123456Z",unit:"pending_registration",summary:{global:counts,filtered:counts},coverage:{pending:600,matched:600,totalRowsReturned:50,complete:true,facetsComplete:true},rows:Array.from({length:50},(_,i)=>row(600-i)),next:encodePendingEmailBefore(551),facets:{category:[{value:"servidor",count:600}],institution:[{value:"Instituição QA, Campus Norte",count:600}],domain:[{value:"example.test",count:600}],provider:[],state:[{value:"unrecorded",count:600}]}};};
test("global counts above500 remain independent of the 50-row page and canonical next cursor",()=>{
 const data=parsePendingEmailReadResult(fixture());assert.ok(data);assert.equal(data.summary.global.total,600);assert.equal(data.rows.length,50);assert.equal(data.asOf,"2026-11-10T01:00:00.123456Z");
 for(const patch of [{next:"garbage"},{next:encodePendingEmailBefore(552)},{coverage:{...fixture().coverage,facetsComplete:false}},{facets:{}},{rows:fixture().rows.slice(1)}])assert.equal(parsePendingEmailReadResult({...fixture(),...patch}),null);
});
test("protected DTO rejects extra credentials, duplicate rows, invalid chronology shape and wrong evidence scope",()=>{
 for(const patch of [{emailToken:"private"},{evidence:{...row(1).evidence,registrationLink:"current_message"}},{state:"clicked"},{queued:true},{hasAcceptance:true},{criada:"2026-02-31T00:00:00Z"}])assert.equal(parsePendingEmailReadResult({...fixture(),rows:fixture().rows.map((r,i)=>i? r:{...r,...patch})}),null);
 assert.equal(parsePendingEmailReadResult({...fixture(),rows:fixture().rows.map(()=>row(600))}),null);
});
test("a page must obey its declared cursor and explicit orthogonal filters",()=>{
 assert.equal(parsePendingEmailReadResult(fixture(),{before:encodePendingEmailBefore(599)}),null);
 assert.equal(parsePendingEmailReadResult(fixture(),{filters:{queued:"yes"}}),null);
 assert.equal(parsePendingEmailReadResult(fixture(),{filters:{state:"unrecorded",hasAcceptance:"no",category:"servidor"}})?.rows.length,50);
});
test("public read validates strict query before transport and never accepts CSV as JSON",async()=>{
 let calls=0;const fake=(async()=>{calls++;return new Response(JSON.stringify(fixture()),{headers:{"content-type":"application/json"}});})as typeof fetch;
 assert.ok((await readPendingEmails(new URLSearchParams(),undefined,fake)).ok);
 for(const query of ["formato=csv","limit=101","state=unknown","q=a&q=b"])assert.deepEqual(await readPendingEmails(new URLSearchParams(query),undefined,fake),{ok:false,kind:"invalid"});assert.equal(calls,1);
});

test("latest adverse can coexist with older click/acceptance without turning aggregate history into message proof",()=>{
 const r={...row(1),state:"adverse",hasAcceptance:true,hasAdverse:true,providers:["qa"],provedor:"qa",evidence:{...row(1).evidence,scope:"address_aggregate",lastSignal:{state:"adverse",at:"2026-11-10T02:00:00.123456Z",provider:"qa",source:"legacy_event"},lastAcceptedAt:"2026-11-10T00:00:00.123456Z",clickedAt:"2026-11-10T01:00:00.123456Z",lastAdverse:{type:"hard_bounce",at:"2026-11-10T02:00:00.123456Z",provider:"qa",reason:"QA fake bounce"}}};
 const counts={total:1,byState:{clicked:0,opened:0,delivered:0,adverse:1,accepted:0,unrecorded:0},suppressed:0,queued:0,withSuggestion:0,withAcceptance:1,withAdverse:1};
 const v={...fixture(),summary:{global:counts,filtered:counts},coverage:{pending:1,matched:1,totalRowsReturned:1,complete:true,facetsComplete:true},rows:[r],next:null,facets:{category:[{value:"servidor",count:1}],institution:[{value:r.instituicao,count:1}],domain:[{value:r.dominio,count:1}],provider:[{value:"qa",count:1}],state:[{value:"adverse",count:1}]}};
 const parsed=parsePendingEmailReadResult(v);assert.ok(parsed);assert.equal(parsed.rows[0].state,"adverse");assert.equal(parsed.rows[0].evidence.registrationLink,"email_only");assert.equal(parsed.rows[0].evidence.lastSignal?.at,"2026-11-10T02:00:00.123456Z");
 assert.equal(parsePendingEmailReadResult({...v,rows:[{...r,state:"clicked"}]}),null);
});
test("malformed JSON is invalid, not a network uncertainty",async()=>assert.deepEqual(await readPendingEmailJson(new URLSearchParams(),undefined,(async()=>new Response('{',{headers:{"content-type":"application/json"}}))as typeof fetch),{ok:false,kind:"invalid"}));

import { pendingDetailParts } from "./pending-email-detail";
test("presentation breaks preserve exact16KiB SMTP and Unicode code points without touching normal words",()=>{
 for(const original of ["X".repeat(16384),"😀".repeat(4000)+" SMTP "+"ação".repeat(500),"SMTP 550 temporary failure"]){const parts=pendingDetailParts(original);assert.equal(parts.map(p=>p.text).join(""),original);assert.ok(parts.every(p=>!/[\uD800-\uDBFF]$/.test(p.text)&&! /^[\uDC00-\uDFFF]/.test(p.text)));if(!original.includes("temporary"))assert.ok(parts.some(p=>p.breakAfter));else assert.ok(parts.every(p=>!p.breakAfter));}
 const data=fixture();data.rows[0].detalhe="X".repeat(16384);assert.ok(parsePendingEmailReadResult(data));data.rows[0].detalhe+="X";assert.equal(parsePendingEmailReadResult(data),null);
});
