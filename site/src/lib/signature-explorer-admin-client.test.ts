import test from "node:test";
import assert from "node:assert/strict";
import { signatureExplorerSearch } from "./signature-explorer-admin-contract";
import { parseSignatureExplorerResult, readSignatureExplorer } from "./signature-explorer-admin-client";
const options=()=>{const q=signatureExplorerSearch(new URLSearchParams());assert.ok(q.ok);return q.options;};
const line=()=>({id:1,nome:"QA Name",categoria:"apoiador",instituicao:"",cargo:"",regiao:"",campus:"",cidadeUf:"Porto Velho/RO",pais:"",status:"confirmed",criada:"2026-11-10T00:00:00.000Z",confirmada:"2026-11-10T00:00:01.000Z",cpf:false,whatsapp:"",waConfirmado:false});
const fixture=()=>({ok:true,asOf:"2026-11-10T00:00:02.000Z",capabilities:{contacts:false},coverage:{matched:500,totalRowsReturned:50,facetsComplete:true,mapComplete:true,complete:true},total:500,linhas:Array.from({length:50},(_,n)=>({...line(),id:n+1})),pontos:[{chave:"m:1100205",lat:-8.76,lon:-63.9,nome:"Porto Velho/RO",uf:"RO",conf:250,pend:250,por:{apoiador:{conf:250,pend:250}}}],facetas:{instituicao:Array.from({length:450},(_,n)=>({v:`Instituição QA ${n}`,n:700})),cargo:[],campus:[],pais:[],universidade:[],uf:[],cidade:[]},totais:{confirmadas:250,pendentes:250,servidores:0,apoiadores:500,estrangeiros:0,cpfConferido:0},semLocal:0,pagina:1,limite:50});
test("strict response preserves complete facets above300 and global filtered counts independent of page",()=>{
 const parsed=parseSignatureExplorerResult(fixture(),options());assert.ok(parsed);assert.equal(parsed.total,500);assert.equal(parsed.linhas.length,50);assert.equal(parsed.facetas.instituicao.length,450);assert.equal(parsed.facetas.instituicao[0].n,700,"disjunctive facet may exceed currently matched rows");
});
test("Leitura cannot receive a phone or additional email/CPF/token fields even if the rest of the response looks valid",()=>{
 for(const extra of [{whatsapp:"+55 69 9999-0000"},{email:"private@example.test"},{cpf_hash:"secret"},{wa_cipher:"secret"},{token:"secret"}])assert.equal(parseSignatureExplorerResult({...fixture(),linhas:[{...line(),...extra}]},options()),null);
 assert.ok(parseSignatureExplorerResult({...fixture(),capabilities:{contacts:true},linhas:fixture().linhas.map(row=>({...row,whatsapp:"+55 69 9999-0000",waConfirmado:true}))},options()));
});
test("coverage, totals, page, map and count relationships must describe the same response",()=>{
 for(const change of [{pagina:2},{limite:200},{coverage:{...fixture().coverage,totalRowsReturned:500}},{coverage:{...fixture().coverage,facetsComplete:false}},{semLocal:1},{totais:{...fixture().totais,confirmadas:249}},{pontos:[{...fixture().pontos[0],lat:95}]}])assert.equal(parseSignatureExplorerResult({...fixture(),...change},options()),null);
 assert.equal(parseSignatureExplorerResult({...fixture(),linhas:[line(),line()],coverage:{...fixture().coverage,totalRowsReturned:2}},options()),null);
});
test("one request is private, fixed same-origin GET and validates query before touching transport",async()=>{
 let calls=0;const fake=(async(path:unknown,init:RequestInit)=>{calls++;assert.equal(path,"/api/admin/assinaturas/explorar?");assert.equal(init.method,"GET");assert.equal(init.credentials,"same-origin");assert.equal(init.cache,"no-store");assert.equal(init.redirect,"error");assert.equal(init.referrerPolicy,"no-referrer");assert.equal(init.body,undefined);return new Response(JSON.stringify(fixture()),{headers:{"content-type":"application/json"}});})as typeof fetch;
 assert.ok((await readSignatureExplorer(new URLSearchParams(),undefined,fake)).ok);assert.equal(calls,1);
 assert.equal((await readSignatureExplorer(new URLSearchParams("formato=csv"),undefined,fake)).ok,false);assert.equal((await readSignatureExplorer(new URLSearchParams("pagina=1.5"),undefined,fake)).ok,false);assert.equal(calls,1);
});
test("external abort and independent deadline terminate an uncooperative fetch without any retry",async()=>{
 let calls=0;const hang=(()=>{calls++;return new Promise(()=>{});})as typeof fetch;
 const abort=new AbortController();const pending=readSignatureExplorer(new URLSearchParams(),abort.signal,hang,500);abort.abort();assert.deepEqual(await pending,{ok:false,kind:"aborted"});assert.equal(calls,1);
 assert.deepEqual(await readSignatureExplorer(new URLSearchParams(),undefined,hang,5),{ok:false,kind:"uncertain"});assert.equal(calls,2);
});
test("authorization, MIME, oversized and bad UTF-8 responses are not trusted DTOs",async()=>{
 assert.deepEqual(await readSignatureExplorer(new URLSearchParams(),undefined,(async()=>new Response("",{status:403}))as typeof fetch),{ok:false,kind:"http",status:403});
 for(const response of [new Response("{}",{headers:{"content-type":"text/html"}}),new Response("{}",{headers:{"content-type":"application/json","content-length":"33554433"}}),new Response(new Uint8Array([0xff]),{headers:{"content-type":"application/json"}})])assert.equal((await readSignatureExplorer(new URLSearchParams(),undefined,(async()=>response)as typeof fetch)).ok,false);
});

import { filtrosParaQuery, filtrosVazios, parseFiltros } from "./assinaturas-filtros";
test("comma/bracket/quoted institutions roundtrip through the shared helpers and exact admin query",()=>{
 const filters={...filtrosVazios(),instituicao:["Instituição QA, Campus Norte","[Instituição] QA","Instituição \"Quoted\""],universidade:["University, Campus"]};
 const params=new URLSearchParams(filtrosParaQuery(filters)),parsed=signatureExplorerSearch(params);assert.ok(parsed.ok);assert.deepEqual(parsed.options.filters.instituicao,filters.instituicao);assert.deepEqual(parseFiltros(params).universidade,filters.universidade);
 params.set("formato","csv");const csv=signatureExplorerSearch(params);assert.ok(csv.ok);assert.deepEqual(csv.options.filters.instituicao,filters.instituicao);
});

test("a complete-facets claim requires all seven variable facet collections",()=>{
 assert.equal(parseSignatureExplorerResult({...fixture(),facetas:{}},options()),null);
 const incomplete:Record<string,unknown>={...fixture().facetas};delete incomplete.instituicao;assert.equal(parseSignatureExplorerResult({...fixture(),facetas:incomplete},options()),null);
});

test("a falsely complete short page is rejected and known403 never waits for a stuck body cancel",async()=>{
 assert.equal(parseSignatureExplorerResult({...fixture(),linhas:[line()],coverage:{...fixture().coverage,totalRowsReturned:1}},options()),null);
 const stream=new ReadableStream({cancel:()=>new Promise(()=>{})});
 assert.deepEqual(await readSignatureExplorer(new URLSearchParams(),undefined,(async()=>new Response(stream,{status:403}))as typeof fetch,10),{ok:false,kind:"http",status:403});
});
