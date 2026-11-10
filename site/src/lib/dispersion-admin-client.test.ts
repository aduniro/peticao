import test from "node:test";
import assert from "node:assert/strict";
import { appendDispersionRows, dispersionPath, dispersionQuery, enterDispersionNode, getDispersion } from "./dispersion-admin-client";
import { parseDispersionEnvelopeCore, parseDispersionNode, validDispersionRows } from "./dispersion-admin-view";
const node = (id = 30) => ({ id, name: "QA Person", status: "confirmed", origin: "pessoal", attributionState: "personal", ownerId: 31, parentName: "Global Parent Outside Page", generation: 28, chainState: "rooted", rootIssueId: null, cycleSize: null, invited: 5, invitedConfirmed: 3, reach: 7 });
test("query allowlist isolates parent/cursor contexts and fixed private path",()=>{
 assert.equal(dispersionPath({view:"children",parentId:31,before:30,limit:50}),"/api/admin/dispersao/dados?view=children&parentId=31&before=30&limit=50");
 for(const bad of [{view:"children"},{view:"roots",parentId:1},{view:"all",limit:101},{view:"all",before:0},{view:"all",token:"secret"},{view:"all",before:"1"}])assert.equal(dispersionQuery(bad),null);
});
test("drill-down traverses chains beyond former depths without recursive DOM and refuses ancestral loops",()=>{
 let path:number[]=[];for(let id=1;id<=250;id++){const next=enterDispersionNode(path,id);assert.ok(next.ok);path=next.path;}
 assert.equal(path.length,250);assert.deepEqual(enterDispersionNode(path,1),{ok:false,reason:"cycle"});assert.deepEqual(enterDispersionNode(path,-1),{ok:false,reason:"invalid"});
});
test("tree DTO excludes email/secrets, preserves global parent and does not call an ambiguous link an invalid signature",()=>{
 const parsed=parseDispersionNode(node());assert.ok(parsed);assert.equal(parsed.parentName,"Global Parent Outside Page");assert.equal(parsed.generation,28);
 for(const extra of [{email:"private@example.test"},{token:"secret"},{cpf:"secret"}])assert.equal(parseDispersionNode({...node(),...extra}),null);
 const cyclic={...node(),generation:null,chainState:"cycle",rootIssueId:30,cycleSize:2,reach:null};assert.ok(parseDispersionNode(cyclic));assert.equal(parseDispersionNode(cyclic)?.status,"confirmed");
 assert.equal(parseDispersionNode({...cyclic,generation:0}),null);
});
test("children and diagnostics retain strict ID ordering and correct parent scope",()=>{
 assert.ok(validDispersionRows([node(30),node(29)],{view:"children",parentId:31}));
 assert.equal(validDispersionRows([node(30)],{view:"children",parentId:32}),null);
 assert.equal(validDispersionRows([node(29),node(30)],{view:"all"}),null);
 assert.equal(validDispersionRows([node(30)],{view:"diagnostics"}),null);
 assert.equal(appendDispersionRows([{id:31}],[{id:30}],31,29),null);
});
test("each response keeps its own asOf and requires focus only for children",()=>{
 const value={ok:true,view:"children",asOf:"2026-11-10T00:00:00.123Z",summary:{},coverage:{},total:1,rows:[node(30)],nextBefore:null,focus:{...node(31),ownerId:null,generation:0,origin:"direto",attributionState:"direct"}};
 assert.ok(parseDispersionEnvelopeCore(value,{view:"children",parentId:31}));assert.equal(parseDispersionEnvelopeCore({...value,focus:null},{view:"children",parentId:31}),null);
 assert.equal(parseDispersionEnvelopeCore({...value,rows:[{...node(),password:"secret"}]},{view:"children",parentId:31}),null);
});
test("single-attempt transport is private, GET-only and has an independent deadline",async()=>{
 let calls=0;const fake=(async(path:unknown,options:RequestInit)=>{calls++;assert.equal(path,"/api/admin/dispersao/dados?view=all");assert.equal(options.method,"GET");assert.equal(options.body,undefined);assert.equal(options.credentials,"same-origin");assert.equal(options.cache,"no-store");assert.equal(options.redirect,"error");return new Response("{}",{headers:{"content-type":"application/json"}});})as typeof fetch;
 assert.ok((await getDispersion({view:"all"},fake)).ok);assert.equal(calls,1);
 assert.equal((await getDispersion({view:"children"},fake)).ok,false);assert.equal(calls,1);
 assert.deepEqual(await getDispersion({view:"roots"},(()=>{calls++;return new Promise(()=>{});})as typeof fetch,5),{ok:false,kind:"uncertain"});assert.equal(calls,2);
 assert.deepEqual(await getDispersion({view:"all"},(async()=>new Response("{}",{status:503}))as typeof fetch),{ok:false,kind:"http",status:503});
});

import { analyzeDispersionGraph } from "./dispersion-graph";
import { parseDispersionPage } from "./dispersion-admin-view";
test("full parser accepts canonical graph summaries including unknown buckets/metrics without recomputing totals from a page",()=>{
 const graph=analyzeDispersionGraph([{id:1,name:"Root",status:"confirmed",refCode:null,referrerFound:false,ownerId:null,referrerDisplayName:null,orgLabel:null,confirmSameVisitor:null},{id:2,name:"Unknown",status:"confirmed",refCode:"missing",referrerFound:false,ownerId:null,referrerDisplayName:null,orgLabel:null,confirmSameVisitor:false}]);
 const v={ok:true,view:"roots",asOf:"2026-11-10T00:00:00.123Z",summary:graph.summary,coverage:graph.coverage,total:graph.roots.length,rows:graph.roots.map(id=>graph.byId.get(id)),nextBefore:null,focus:null};
 assert.ok(parseDispersionPage(v,{view:"roots"}));assert.equal(parseDispersionPage({...v,summary:{...graph.summary,total:999}},{view:"roots"}),null);
 const parsed=parseDispersionPage(v,{view:"roots"})!;assert.equal(parsed.summary.total,2);assert.equal(parsed.summary.byGeneration.at(-1)?.generation,null);assert.equal(parsed.summary.deepShare,null);
});
test("generation parser retains the complete array beyond the visible fifty buckets",()=>{
 const graph=analyzeDispersionGraph(Array.from({length:501},(_,n)=>({id:n+1,name:`QA${n+1}`,status:"confirmed" as const,refCode:n?`Q${n}`:null,referrerFound:n>0,ownerId:n?n:null,referrerDisplayName:n?"Parent":null,orgLabel:null,confirmSameVisitor:null})));
 const v={ok:true,view:"roots",asOf:"2026-11-10T00:00:00.123Z",summary:graph.summary,coverage:graph.coverage,total:graph.roots.length,rows:graph.roots.map(id=>graph.byId.get(id)),nextBefore:null,focus:null};
 const parsed=parseDispersionPage(v,{view:"roots"});assert.ok(parsed);assert.equal(parsed.summary.byGeneration.length,501);assert.equal(parsed.summary.byGeneration.at(-1)?.generation,500);
});
