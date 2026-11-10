import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
(process.env as Record<string,string>).NODE_ENV="test";
process.env.MAIL_PROVIDER="dev";process.env.SIGNER="none";process.env.APPROVER_EMAIL="";process.env.RECIPIENTS="";
async function fixture(name:string){
 const db=await import("./db");await db._openForTests(name);const B=await import("./batches");
 await db.query("INSERT INTO signatures(name,email,email_hash,category,city,uf,text_version,consent_at,status,confirmed_at) VALUES('Pessoa Ficticia','qa-flow@example.test','QA-FLOW-EMAIL','apoiador','Porto Velho','RO','QA',now(),'confirmed',now())");
 const p={version:1,revision:1,enabled:true,credentialActive:true,credentialVersionId:randomUUID(),profileVersion:'pades-basic-unhomologated-v1',trustStoreVersion:'b'.repeat(64),expectedCnpj:'15883671000115',certificateFingerprintSha256:'c'.repeat(64)};
 await db.query("INSERT INTO settings(key,value)VALUES('batch_a1_policy_v1',$1)",[JSON.stringify(p)]);
 const close=async()=>{for(const key of ['BATCH_A1_ENABLED','DOCUMENT_REFERENCE_ENABLED','DOCUMENT_REFERENCE_ORIGIN'])delete process.env[key];await db._closeDbForTests();};return{db,B,close};
}
for(const mode of ['legacy','a1','reference','both'] as const) test(`real PDF preparation ${mode}: frozen flags, exact stored bytes and no signature or delivery`,async()=>{
 const c=await fixture('t_preparation_flow_'+mode);try{
 const a1=mode==='a1'||mode==='both',qr=mode==='reference'||mode==='both';
 process.env.BATCH_A1_ENABLED=a1?'1':'0';process.env.DOCUMENT_REFERENCE_ENABLED=qr?'1':'0';process.env.DOCUMENT_REFERENCE_ORIGIN='https://documents.example.org/';
 const batch=await c.B.createBatch('final');assert.ok(batch);
 const stored=(await c.db.query('SELECT * FROM batches WHERE id=$1',[batch.id])).rows[0];assert.equal(stored.status,'prepared');assert.equal(stored.signature_kind,'none');assert.equal(stored.signed_pdf,null);assert.equal(stored.approved_at,null);
 const preparation=(await c.db.query('SELECT snapshot FROM batch_preparations WHERE batch_id=$1',[batch.id])).rows[0];const frozen=JSON.parse(preparation.snapshot);assert.equal(frozen.version,a1||qr?2:1);assert.equal(frozen.meta.signaturePreparation,a1?'a1':undefined);assert.equal(frozen.meta.signedNote,a1?'':'NAO ASSINADO (teste)');
 const references=(await c.db.query('SELECT id FROM document_references WHERE batch_id=$1',[batch.id])).rows;assert.equal(references.length,qr?1:0);if(qr){assert.equal(frozen.meta.documentReference.id,references[0].id);assert.ok(frozen.meta.documentReference.url.endsWith(references[0].id));}else assert.equal(frozen.meta.documentReference,undefined);
 const history=(await c.db.query('SELECT bytes,sha256 FROM batch_document_versions WHERE batch_id=$1',[batch.id])).rows;assert.equal(history.length,1);assert.deepEqual(history[0].bytes,stored.pdf);assert.equal(history[0].sha256,stored.pdf_sha256);
 assert.equal((await c.db.query('SELECT 1 FROM batch_a1_jobs UNION ALL SELECT 1 FROM document_reference_bindings UNION ALL SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox')).rowCount,0);assert.ok((await c.db.verifyAuditChain()).ok);
 if(process.env.QA_PREPARATION_PDF_DIR)writeFileSync(join(process.env.QA_PREPARATION_PDF_DIR,mode+'.pdf'),stored.pdf,{flag:'wx',mode:0o600});
 }finally{await c.close();}
});
test('invalid configured QR origin rolls back batch and signer allocation before rendering',async()=>{
 const c=await fixture('t_preparation_flow_rollback');try{process.env.DOCUMENT_REFERENCE_ENABLED='1';process.env.DOCUMENT_REFERENCE_ORIGIN='http://example.org/';await assert.rejects(c.B.createBatch('final'),/origin_invalid/);assert.equal((await c.db.query('SELECT 1 FROM batches UNION ALL SELECT 1 FROM document_references UNION ALL SELECT 1 FROM batch_preparations')).rowCount,0);assert.equal((await c.db.query('SELECT batch_id FROM signatures')).rows[0].batch_id,null);assert.equal((await c.db.query('SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox')).rowCount,0);}finally{await c.close();}
});
