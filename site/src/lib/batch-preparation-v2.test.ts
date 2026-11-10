import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { freezePreparation, thawPreparation } from "./batch-preparation";
import golden from "./batch-preparation-v1-fixture.json";
process.env.SIGNER="none";
const rows:any[]=[{id:1,name:"QA Pessoa",category:"apoiador",institution:null,role:null,city:"QA",uf:"RO",campus:null,campus_ibge:null,verify_code:"QA-CODE"}];
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const meta=()=>({seq:1,kind:'final' as const,generatedAt:'2026-11-09T12:00:00.000Z',listHash:digest(JSON.stringify(rows)),nServidor:0,nApoiador:1,signedNote:'QA',origin:'https://example.org/'});
const batch=()=>({seq:1,kind:'final',list_hash:meta().listHash,n_servidor:0,n_apoiador:1,n_estrangeiro:0});
const ref=()=>({id:'11111111-1111-4111-8111-111111111111',url:'https://documents.example.org/api/documentos/referencia/11111111-1111-4111-8111-111111111111'});
test('legacy snapshot serialization/hash remain byte-identical and resumable',()=>{
 const current=freezePreparation(rows,meta(),{kind:'scheduler'}),old={snapshot:golden.snapshot,sha256:golden.sha256};assert.deepEqual(current,old);assert.equal(thawPreparation(current.snapshot,current.sha256,batch())?.version,1);
});
test('reference snapshot v2 binds the reserved UUID/url before PDF signing without final hash',()=>{
 const frozen=freezePreparation(rows,{...meta(),documentReference:ref()},{kind:'scheduler'});const thawed=thawPreparation(frozen.snapshot,frozen.sha256,batch());assert.ok(thawed);assert.equal(thawed.version,2);assert.deepEqual(thawed.meta.documentReference,ref());assert.ok(!ref().url.includes(frozen.sha256));
 const altered=JSON.parse(frozen.snapshot);altered.meta.documentReference.id='22222222-2222-4222-8222-222222222222';const serialized=JSON.stringify(altered);assert.equal(thawPreparation(serialized,digest(serialized),batch()),null);
});
test('v1 cannot silently acquire reference metadata and v2 requires canonical safe reference',()=>{
 const frozen=freezePreparation(rows,meta(),{kind:'scheduler'}),v=JSON.parse(frozen.snapshot);v.meta.documentReference=ref();const s=JSON.stringify(v);assert.equal(thawPreparation(s,digest(s),batch()),null);
 for(const reference of [{...ref(),url:'https://evil.example.org/'},{...ref(),extra:true},{...ref(),url:ref().url+'?sha256=untrusted'}])assert.throws(()=>freezePreparation(rows,{...meta(),documentReference:reference},{kind:'scheduler'}),/invalid_snapshot_document_reference/);
});

test('A1 footer omission applies only to explicit new v2 preparation and never changes legacy test mode',()=>{
 const frozen=freezePreparation(rows,{...meta(),signedNote:'',signaturePreparation:'a1'},{kind:'scheduler'}),v=thawPreparation(frozen.snapshot,frozen.sha256,batch());assert.ok(v);assert.equal(v.version,2);assert.equal(v.meta.signedNote,'');assert.equal(v.meta.signaturePreparation,'a1');
 assert.throws(()=>freezePreparation(rows,{...meta(),signaturePreparation:'a1'},{kind:'scheduler'}),/invalid_snapshot_signing_preparation/);
 const legacy=freezePreparation(rows,meta(),{kind:'scheduler'});assert.equal(JSON.parse(legacy.snapshot).version,1);assert.equal(JSON.parse(legacy.snapshot).meta.signedNote,'QA');
 const invalid=JSON.parse(frozen.snapshot);invalid.meta.signedNote='assinado ICP-Brasil';const s=JSON.stringify(invalid);assert.equal(thawPreparation(s,digest(s),batch()),null);
});
