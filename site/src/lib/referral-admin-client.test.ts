import test from "node:test";
import assert from "node:assert/strict";
import { appendReferralRows, parseReferralPeople, parseReferralStats, referralRequest } from "./referral-admin-client";
import { abandonLegacyReferral, applyReferralResult, parseManagedPage, parseMutationResult, parseReferralMutation, readyMutation, recoveredMutation, type ReferralMutation } from "./referral-management-client";
const stamp = "2026-11-10T00:00:00.123Z", code = (n: number) => String(n).padStart(7, "2").replace(/0/g,"3").replace(/1/g,"4");
const statsRow = (n: number) => ({ id: n, code: code(n), kind: "organization" as const, name: null, label: "QA Organization", createdAt: stamp, archivedAt: null, visits: 3, signed: 1, pending: 1 });
const stats = (rows = [statsRow(5)], nextBefore: number | null = null) => ({ ok: true, totals: { codes: 1200, personalCodes: 1100, organizationCodes: 100, visits: 9999, signed: 5000, pending: 800 }, rows, nextBefore });
const intent: ReferralMutation = { id: 5, version: "9007199254740993", requestId: "00000000-0000-4000-8000-000000000001", operation: "edit", label: "QA new label" };
const row = { id: 5, code: "ABCDEFG", label: "QA new label", version: "9007199254740994", archivedAt: null };
const result = { ok: true, requestId: intent.requestId, operation: "edit", context: { id: 5, expectedVersion: intent.version }, row, changed: true };
test("global totals remain global and strict stats preserve kinds, archived and text without exposing secrets", () => {
 const parsed = parseReferralStats(stats());assert.ok(parsed);assert.equal(parsed.totals.codes,1200);assert.equal(parsed.rows.length,1);
 for(const extra of [{manageToken:"secret"},{email:"qa@example.test"},{cpf:"private"},{version:"1"}])assert.equal(parseReferralStats(stats([{...statsRow(5),...extra}])),null);
 assert.equal(parseReferralStats({...stats(),totals:{...stats().totals,codes:1199}}),null);
 assert.equal(parseReferralStats({...stats(),totals:{...stats().totals,visits:Number.MAX_SAFE_INTEGER+1}}),null);
});
test("descending cursor pagination rejects duplicates, wrong context, partial cursors and invalid IDs",()=>{
 const first=parseReferralStats(stats([statsRow(5),statsRow(4)],4),undefined,2);assert.ok(first);
 assert.equal(parseReferralStats(stats([statsRow(3)],3),4,2),null);
 assert.equal(parseReferralStats(stats([statsRow(4)],null),4),null);
 assert.equal(parseReferralStats(stats([statsRow(4),statsRow(5)],null)),null);
 assert.equal(parseReferralStats(stats([statsRow(4),statsRow(4)],null)),null);
 assert.deepEqual(appendReferralRows(first.rows,[statsRow(3)],4,4)?.map(r=>r.id),[5,4,3]);assert.equal(appendReferralRows(first.rows,[statsRow(3)],4,3),null);
});
test("people DTO is code-scoped, strict, bounded and accepts both statuses/three categories",()=>{
 const v={ok:true,code:"ABCDEFG",total:130,rows:[{id:99,name:"QA Person",status:"pending",category:"estrangeiro"}],nextBefore:null};
 assert.ok(parseReferralPeople(v,"ABCDEFG"));assert.equal(parseReferralPeople(v,"BCDEFGH"),null);
 assert.equal(parseReferralPeople({...v,rows:[{...v.rows[0],email:"qa@example.test"}]},"ABCDEFG"),null);
 assert.equal(parseReferralPeople({...v,rows:[{...v.rows[0],status:"unknown"}]},"ABCDEFG"),null);
});
test("management result uses exact UUID, operation, immutable context and BigInt increment",()=>{
 assert.ok(parseReferralMutation(intent));assert.ok(parseMutationResult(result,intent));
 for(const wrong of [{requestId:"00000000-0000-4000-8000-000000000002"},{operation:"archive"},{context:{id:5,expectedVersion:"9007199254740992"}},{row:{...row,version:"9007199254740995"}},{row:{...row,label:"Other label"}},{token:"not allowed"}])assert.equal(parseMutationResult({...result,...wrong},intent),null);
 assert.equal(parseReferralMutation({...intent,version:"9223372036854775808"}),null);
 assert.equal(parseReferralMutation({...intent,label:"needs  normalization"}),null);
 assert.equal(parseReferralMutation({...intent,requestId:"00000000-0000-0000-0000-000000000001"}),null);
});
test("archive/restore and no-op results retain precise state/versions, legacy envelopes fail closed",()=>{
 const archive={...intent,operation:"archive" as const};delete archive.label;
 assert.ok(parseMutationResult({...result,operation:"archive",row:{...row,archivedAt:stamp}},archive));
 assert.equal(parseMutationResult({...result,operation:"archive"},archive),null);
 const restore={...archive,operation:"restore" as const};assert.ok(parseMutationResult({...result,operation:"restore"},restore));
 assert.ok(parseMutationResult({...result,changed:false,row:{...row,version:intent.version}},intent));
 assert.equal(parseMutationResult({ok:true,row,changed:true},intent),null);
});
test("unknown never becomes ready or a new nonce; only GET404 enables same-intent repeat",()=>{
 const state={...readyMutation(),mode:"uncertain" as const,intent};
 assert.equal(recoveredMutation(state,null,503).mode,"uncertain");assert.equal(recoveredMutation(state,null,404).mode,"not-found");
 assert.equal(recoveredMutation(state,null,409).mode,"uncertain");assert.equal(recoveredMutation(state,null,409,"legacy_unavailable").mode,"legacy");assert.equal(recoveredMutation(state,result).mode,"confirmed");assert.equal(recoveredMutation(state,null,404).intent,intent);
});
test("managed inventories enforce filter, exact rows and closed cursors",()=>{
 assert.ok(parseManagedPage({ok:true,rows:[{...row,version:"1"}],nextBefore:null}));
 assert.equal(parseManagedPage({ok:true,rows:[{...row,archivedAt:stamp}],nextBefore:null}),null);
 assert.ok(parseManagedPage({ok:true,rows:[{...row,archivedAt:stamp}],nextBefore:null},undefined,"archived"));
 assert.equal(parseManagedPage({ok:true,rows:[{...row,manage_token_hash:"secret"}],nextBefore:null}),null);
});
test("one-shot transport closes paths, enforces method/cache/origin, timeout and no auto retries",async()=>{
 let calls=0;const fake=(async(url:unknown,options:RequestInit)=>{calls++;assert.equal(url,"/api/admin/indicacoes/estatisticas");assert.equal(options.method,"GET");assert.equal(options.redirect,"error");assert.equal(options.credentials,"same-origin");assert.equal(options.cache,"no-store");assert.equal(options.body,undefined);return new Response(JSON.stringify(stats()),{headers:{"content-type":"application/json"}});}) as typeof fetch;
 assert.ok((await referralRequest("/api/admin/indicacoes/estatisticas","GET",undefined,fake)).ok);assert.equal(calls,1);
 assert.equal((await referralRequest("https://outside.test/api/admin/indicacoes/estatisticas","GET",undefined,fake)).ok,false);assert.equal(calls,1);
 assert.equal((await referralRequest("/api/admin/indicacoes/estatisticas","POST",{},fake)).ok,false);assert.equal(calls,1);
 const hang=(()=>{calls++;return new Promise(()=>{});})as typeof fetch;assert.deepEqual(await referralRequest("/api/admin/indicacoes/estatisticas","GET",undefined,hang,5),{ok:false,kind:"uncertain"});assert.equal(calls,2);
});
test("both error/erro stepup gates are recognized without rendering arbitrary messages",async()=>{
 for(const body of [{ok:false,erro:"stepup"},{ok:false,error:"stepup"}])assert.deepEqual(await referralRequest("/api/admin/indicacoes/gestao?requestId="+intent.requestId,"GET",undefined,(async()=>new Response(JSON.stringify(body),{status:403,headers:{"content-type":"application/json"}}))as typeof fetch),{ok:false,kind:"http",status:403,reason:"stepup"});
 const unknown=await referralRequest("/api/admin/indicacoes/gestao","POST",intent,(async()=>new Response(JSON.stringify({error:"sensitive arbitrary SQL"}),{status:503,headers:{"content-type":"application/json"}}))as typeof fetch);assert.deepEqual(unknown,{ok:false,kind:"http",status:503});
});

test("durable historical result never overwrites or removes a newer row",()=>{
 const newer={...row,version:"9007199254740995",label:"Later operator label",archivedAt:null};
 assert.deepEqual(applyReferralResult([newer],{...row,archivedAt:stamp},"active"),[newer]);
 assert.deepEqual(applyReferralResult([{...row,version:"9007199254740993"}],row,"active"),[row]);
});

test("transport rejects oversized, non-JSON and malformed UTF-8 replies before trusting any DTO",async()=>{
 for(const response of [new Response("{}",{headers:{"content-type":"text/html"}}),new Response("{}",{headers:{"content-type":"application/json","content-length":"4194305"}}),new Response(new Uint8Array([0xff,0xfe]),{headers:{"content-type":"application/json"}})])assert.equal((await referralRequest("/api/admin/indicacoes/estatisticas","GET",undefined,(async()=>response)as typeof fetch)).ok,false);
});

test("legacy local exit requires exact legacy outcome, a later current-row read and explicit consent",()=>{
 const uncertain={...readyMutation(),mode:"uncertain" as const,intent};const legacy=recoveredMutation(uncertain,null,409,"legacy_unavailable");
 const current={...row,version:"9007199254740999"};
 assert.equal(abandonLegacyReferral(uncertain,current,1,2,true),null);assert.equal(abandonLegacyReferral(recoveredMutation(uncertain,null,409,"conflict"),current,1,2,true),null);
 assert.equal(abandonLegacyReferral(legacy,current,2,2,true),null);assert.equal(abandonLegacyReferral(legacy,current,1,2,false),null);assert.equal(abandonLegacyReferral(legacy,{...current,id:6},1,2,true),null);
 const exit=abandonLegacyReferral(legacy,current,1,2,true);assert.ok(exit);assert.equal(exit.state.mode,"ready");assert.equal(exit.state.intent,null);assert.equal(exit.reference.requestId,intent.requestId);assert.equal(exit.reference.observedVersion,current.version);
});
