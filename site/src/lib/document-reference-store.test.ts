import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { DOCUMENT_REFERENCE_SCHEMA_SQL } from "./document-reference-schema";
import { reserveDocumentReferenceTx,bindDocumentReferenceTx,resolveDocumentReference,snapshotReferenceMatchesTx } from "./document-reference-store";
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
async function setup(name:string){
 const db=await import("./db");await db._openForTests(name);await db.query(DOCUMENT_REFERENCE_SCHEMA_SQL);
 await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash) VALUES(1,'qr-owner@example.test','QA QR','total','NOT-A-PASSWORD')");
 const id=(await db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash) VALUES(1,'final','preparing',0,1,$1) RETURNING id",['a'.repeat(64)])).rows[0].id as number;
 process.env.DOCUMENT_REFERENCE_ENABLED='1';process.env.DOCUMENT_REFERENCE_ORIGIN='https://documents.example.org/';delete process.env.DOCUMENT_VERIFICATION_PUBLIC;
 const reserve=()=>db.tx(c=>reserveDocumentReferenceTx(c,id,1));
 const bytes=Buffer.from('%PDF-QA-reference-immutable');
 async function prepare(){const versionId=randomUUID();await db.query("INSERT INTO batch_document_versions(id,batch_id,ordinal,variant,bytes,sha256,list_hash,signature_kind,source,author_id,recorded_by) VALUES($1,$2,1,'signed',$3,$4,$5,'icp-brasil','upload',1,1)",[versionId,id,bytes,sha(bytes),'a'.repeat(64)]);await db.query("UPDATE batches SET status='prepared',pdf=$1,pdf_sha256=$2,signed_pdf=$1,signed_pdf_sha256=$2,signature_kind='icp-brasil' WHERE id=$3",[bytes,sha(bytes),id]);return versionId;}
 const close=async()=>{delete process.env.DOCUMENT_REFERENCE_ENABLED;delete process.env.DOCUMENT_REFERENCE_ORIGIN;delete process.env.DOCUMENT_VERIFICATION_PUBLIC;await db._closeDbForTests();};
 return {db,id,reserve,prepare,bytes,close};
}
test('reservation is disabled without DB access; unknown runtime inputs and origins fail closed',async()=>{
 delete process.env.DOCUMENT_REFERENCE_ENABLED;assert.equal(await reserveDocumentReferenceTx(null as any,1,1),null);assert.equal(await resolveDocumentReference(randomUUID()),null);
 const c=await setup('t_qr_bad');try{process.env.DOCUMENT_REFERENCE_ORIGIN='http://example.org/';await assert.rejects(c.reserve(),/origin_invalid/);assert.equal((await c.db.query('SELECT 1 FROM document_references')).rowCount,0);}finally{await c.close();}
});
test('concurrent reservation has one immutable UUID and one audit before rendering',async()=>{
 const c=await setup('t_qr_reserve');try{const results=await Promise.all([c.reserve(),c.reserve(),c.reserve()]);assert.ok(results.every(r=>r?.id===results[0]?.id));assert.equal((await c.db.query('SELECT 1 FROM document_references')).rowCount,1);assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='document_reference_reserved'")).rowCount,1);
 process.env.DOCUMENT_REFERENCE_ORIGIN='https://changed.example.org/';await assert.rejects(c.reserve(),/origin_changed/);process.env.DOCUMENT_REFERENCE_ORIGIN='https://documents.example.org/';await c.prepare();await assert.rejects(c.reserve(),/reservation_closed/);
 }finally{await c.close();}
});
test('audit failure rolls back reservation and does not send messages',async()=>{
 const c=await setup('t_qr_rollback');try{await c.db.query("CREATE FUNCTION qa_qr_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='document_reference_reserved' THEN RAISE EXCEPTION 'QA QR audit'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_qr_fail BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_qr_fail()");await assert.rejects(c.reserve(),/QA QR audit/);assert.equal((await c.db.query('SELECT 1 FROM document_references')).rowCount,0);assert.equal((await c.db.query('SELECT 1 FROM mail_outbox')).rowCount,0);}finally{await c.close();}
});
test('exact final bytes bind once after approval; retries are idempotent and never retarget',async()=>{
 const c=await setup('t_qr_bind');try{const reference=await c.reserve();assert.ok(reference);const version=await c.prepare();const bind=()=>c.db.tx(tx=>bindDocumentReferenceTx(tx,version,sha(c.bytes),1));assert.deepEqual(await bind(),{ok:false,error:'reference_ineligible'});await c.db.query("UPDATE batches SET approved_at=$1,approved_by='QA' WHERE id=$2",[new Date().toISOString(),c.id]);assert.deepEqual(await bind(),{ok:true,bound:true,existing:false});assert.deepEqual(await bind(),{ok:true,bound:true,existing:true});
 const next=randomUUID();await c.db.query("INSERT INTO batch_document_versions(id,batch_id,ordinal,variant,bytes,sha256,list_hash,signature_kind,source,author_id,recorded_by) VALUES($1,$2,2,'signed',$3,$4,$5,'icp-brasil','upload',1,1)",[next,c.id,c.bytes,sha(c.bytes),'a'.repeat(64)]);assert.deepEqual(await c.db.tx(tx=>bindDocumentReferenceTx(tx,next,sha(c.bytes),1)),{ok:false,error:'reference_already_bound'});
 assert.equal(await resolveDocumentReference(reference.id),null);process.env.DOCUMENT_VERIFICATION_PUBLIC='1';assert.deepEqual(await resolveDocumentReference(reference.id),{versionId:version,sha256:sha(c.bytes)});process.env.DOCUMENT_REFERENCE_ENABLED='0';assert.equal(await resolveDocumentReference(reference.id),null);
 for(const table of ['document_references','document_reference_bindings']) for(const sql of [`UPDATE ${table} SET ${table==='document_references'?'origin=origin':'sha256=sha256'}`,`DELETE FROM ${table}`,`TRUNCATE ${table} CASCADE`]) await assert.rejects(c.db.query(sql),/immutable/);
 }finally{await c.close();}
});
test('database rejects cross-batch and wrong-hash binding even for direct inserts',async()=>{
 const c=await setup('t_qr_mismatch');try{const reference=await c.reserve();assert.ok(reference);const version=await c.prepare();await assert.rejects(c.db.query('INSERT INTO document_reference_bindings(reference_id,version_id,sha256,bound_by) VALUES($1,$2,$3,1)',[reference.id,version,'b'.repeat(64)]),/binding_mismatch/);
 const second=(await c.db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash) VALUES(2,'partial','preparing',0,1,$1) RETURNING id",['a'.repeat(64)])).rows[0].id;const other=await c.db.tx(tx=>reserveDocumentReferenceTx(tx,second,1));assert.ok(other);await assert.rejects(c.db.query('INSERT INTO document_reference_bindings(reference_id,version_id,sha256,bound_by) VALUES($1,$2,$3,1)',[other.id,version,sha(c.bytes)]),/binding_mismatch/);assert.equal((await c.db.query('SELECT 1 FROM document_reference_bindings')).rowCount,0);
 }finally{await c.close();}
});

test('binding audit failure rolls back final association; reservation stays unchanged',async()=>{
 const c=await setup('t_qr_bind_rollback');try{
  const reference=await c.reserve();assert.ok(reference);const version=await c.prepare();await c.db.query("UPDATE batches SET approved_at=$1,approved_by='QA' WHERE id=$2",[new Date().toISOString(),c.id]);
  await c.db.query("CREATE FUNCTION qa_qr_bind_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='document_reference_bound' THEN RAISE EXCEPTION 'QA QR binding audit'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_qr_bind_fail BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_qr_bind_fail()");
  await assert.rejects(c.db.tx(tx=>bindDocumentReferenceTx(tx,version,sha(c.bytes),1)),/QA QR binding audit/);
  assert.equal((await c.db.query('SELECT 1 FROM document_reference_bindings')).rowCount,0);
  assert.equal((await c.db.query('SELECT id FROM document_references')).rows[0].id,reference.id);
  assert.equal((await c.db.query('SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox')).rowCount,0);
 }finally{await c.close();}
});

test('frozen metadata must match reservation; legacy absence cannot hide or acquire a reference',async()=>{
 const c=await setup('t_qr_snapshot_match');try{
 const match=(value:unknown)=>c.db.tx(tx=>snapshotReferenceMatchesTx(tx,c.id,value));assert.equal(await match(undefined),true);assert.equal(await match({id:randomUUID(),url:'https://example.org/'}),false);
 const reference=await c.reserve();assert.ok(reference);assert.equal(await match(undefined),false);assert.equal(await match(reference),true);assert.equal(await match({...reference,id:randomUUID()}),false);assert.equal(await match({...reference,url:'https://changed.example.org/'}),false);assert.equal(await match({...reference,sha256:'a'.repeat(64)}),false);
 }finally{await c.close();}
});

test('additive schema reapplication preserves reservations, bindings and timestamps',async()=>{
 const c=await setup('t_qr_schema_replay');try{
  await c.reserve();const version=await c.prepare();await c.db.query("UPDATE batches SET approved_at=$1,approved_by='QA' WHERE id=$2",[new Date().toISOString(),c.id]);assert.ok((await c.db.tx(tx=>bindDocumentReferenceTx(tx,version,sha(c.bytes),1))).ok);
  const snapshot=async()=> (await c.db.query("SELECT 'reference' kind,row_to_json(r)::text value FROM document_references r UNION ALL SELECT 'binding',row_to_json(b)::text FROM document_reference_bindings b ORDER BY kind,value")).rows;
  const before=await snapshot();await c.db.query(DOCUMENT_REFERENCE_SCHEMA_SQL);await c.db.query(DOCUMENT_REFERENCE_SCHEMA_SQL);assert.deepEqual(await snapshot(),before);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.close();}
});

test('public reference requires explicit release and rechecks exact current approval without exposing identity or PDF',async()=>{
 const c=await setup('t_qr_public_gates');try{
  const reference=await c.reserve();assert.ok(reference);const version=await c.prepare();
  const U=await import('./admin-users'),B=await import('./batches'),V=await import('./document-verification'),P=await import('./document-reference-public');
  const token=(await U.abrirSessao(1,'127.0.0.1')).token;await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=1");const actor=(await U.sessaoPorToken(token))!;
  const row=(await c.db.query('SELECT * FROM batches WHERE id=$1',[c.id])).rows[0];await c.db.tx(async tx=>{await tx.query("UPDATE batches SET approved_at=$1,approved_by='QA PRIVATE' WHERE id=$2",[new Date().toISOString(),c.id]);await c.db.audit('batch_approved',null,{batchId:c.id,documentVersion:B.documentVersion(row),sentSha256:sha(c.bytes)},tx);});
  assert.ok((await c.db.tx(tx=>bindDocumentReferenceTx(tx,version,sha(c.bytes),1))).ok);process.env.DOCUMENT_VERIFICATION_PUBLIC='1';assert.deepEqual(await P.publicDocumentReference(reference.id),{ok:false});
  assert.ok((await V.setDocumentPublication({versionId:version,sha256:sha(c.bytes),enabled:true,expectedRevision:0},actor)).ok);const result=await P.publicDocumentReference(reference.id);assert.ok(result.ok);assert.equal(result.metadata.sha256,sha(c.bytes));assert.equal(result.metadata.signature.onlineValidationPerformed,false);
  for(const hidden of ['PRIVATE','@','bytes','list_hash','recipients','approved_by'])assert.ok(!JSON.stringify(result).includes(hidden));
  assert.ok((await V.setDocumentPublication({versionId:version,sha256:sha(c.bytes),enabled:false,expectedRevision:1},actor)).ok);assert.deepEqual(await P.publicDocumentReference(reference.id),{ok:false});assert.equal((await c.db.query('SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox')).rowCount,0);
 }finally{await c.close();}
});
