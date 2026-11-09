import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { Pool } from "pg";
import { BATCH_A1_SCHEMA_SQL, BATCH_A1_POLICY_KEY, admitA1Job, claimA1Job, failA1Job, finishA1Job, getA1Job, getA1Availability, type A1ServerPolicy } from "./batch-a1-jobs";
import { _openForTests, _closeDbForTests, query, tx } from "./db";
import { abrirSessao, sessaoPorToken } from "./admin-users";
import { appendDocumentVersion } from "./batch-document-history";
import { verifyA1Pdf } from "./a1-validation";
import { documentVersion, type ApprovalRow } from "./batches";

(process.env as Record<string,string>).NODE_ENV="test";
process.env.MAIL_PROVIDER="dev";
const digest=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
async function fixture(name:string) {
  const url=new URL(process.env.DATABASE_URL!);
  assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.MAIL_PROVIDER,'dev');
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'somente PostgreSQL local fictício');
  assert.ok(url.port&&url.port!=='5432','porta QA explícita distinta da produção');
  if(process.env.DEV_DB_DIR)assert.ok(/(?:\.cache|qa|test)/i.test(process.env.DEV_DB_DIR),'diretório PostgreSQL de QA');
  await _openForTests(name);await query(BATCH_A1_SCHEMA_SQL);
  await query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash) VALUES(1,'qa-a1@example.invalid','QA A1','total','QA-NO-LOGIN'),(2,'qa-read@example.invalid','QA Read','leitura','QA-NO-LOGIN')");
  const session=await abrirSessao(1,"127.0.0.1");await query("UPDATE admin_sessions SET stepup_ate=clock_timestamp()+interval '9 minutes' WHERE user_id=1");
  const actor=(await sessaoPorToken(session.token))!;
  const pdf=await PDFDocument.create();pdf.addPage([200,200]);const bytes=name.startsWith('t_a1_finish')&&process.env.QA_A1_ORIGINAL_PDF?readFileSync(process.env.QA_A1_ORIGINAL_PDF):Buffer.from(await pdf.save());
  const b=(await query<ApprovalRow>("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf,pdf_sha256,signature_kind)VALUES(1,'final','prepared',0,1,$1,$2,$3,'none')RETURNING *",['a'.repeat(64),bytes,digest(bytes)])).rows[0];
  const original=await tx(c=>appendDocumentVersion(c,{batchId:b.id,variant:'original',bytes,sha256:digest(bytes),listHash:b.list_hash,signatureKind:'none',note:null,source:'prepared',authorId:1,recordedBy:1}));
  const policy:A1ServerPolicy={version:1,revision:1,enabled:true,credentialActive:true,credentialVersionId:randomUUID(),profileVersion:'pades-basic-unhomologated-v1',trustStoreVersion:'b'.repeat(64),expectedCnpj:'15883671000115',certificateFingerprintSha256:'c'.repeat(64)};
  await query("INSERT INTO settings(key,value)VALUES($1,$2)",[BATCH_A1_POLICY_KEY,JSON.stringify(policy)]);
  process.env.BATCH_A1_ENABLED='1';
  const input={batchId:b.id,requestId:randomUUID(),expectedDocumentVersion:documentVersion(b),expectedPolicyRevision:1};
  const snapshot=async()=>({batch:(await query("SELECT row_to_json(b)::text raw FROM batches b ORDER BY id")).rows,history:(await query("SELECT row_to_json(d)::text raw FROM batch_document_versions d ORDER BY ordinal")).rows});
  const noSend=async()=>assert.equal((await query("SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM batch_sends")).rowCount,0);
  return{actor,input,bytes,original,policy,snapshot,noSend};
}
async function close(){delete process.env.A1_VALIDATION_ENABLED;delete process.env.A1_VALIDATION_ACCEPTED_POLICIES;delete process.env.ICP_VALIDATOR_URL;delete process.env.BATCH_A1_ENABLED;await _closeDbForTests();}

test("A1 jobs: gate duplo fechado, Total/sessão/stepup reais e payload estrito",async()=>{
 const f=await fixture('t_a1_gate');
 try {
  delete process.env.BATCH_A1_ENABLED;assert.equal((await getA1Availability(f.input.batchId,f.actor)as any).error,'disabled');assert.equal((await admitA1Job(f.input,f.actor) as any).error,'disabled');
  process.env.BATCH_A1_ENABLED='1';await query("DELETE FROM settings WHERE key=$1",[BATCH_A1_POLICY_KEY]);assert.equal((await admitA1Job(f.input,f.actor) as any).error,'disabled');
  await query("INSERT INTO settings(key,value)VALUES($1,$2)",[BATCH_A1_POLICY_KEY,JSON.stringify(f.policy)]);
  assert.equal((await admitA1Job({...f.input,pfxPath:'/tmp/not-allowed'}as any,f.actor)as any).error,'parameters');
  assert.equal((await admitA1Job(f.input,{...f.actor,sessaoId:null})as any).error,'forbidden');
  await query("UPDATE admin_users SET nivel='leitura' WHERE id=1");assert.equal((await admitA1Job(f.input,{...f.actor})as any).error,'forbidden');
  await query("UPDATE admin_users SET nivel='total' WHERE id=1");await query("UPDATE admin_sessions SET stepup_ate=clock_timestamp()-interval '1 second' WHERE id=$1",[f.actor.sessaoId]);
  assert.equal((await admitA1Job(f.input,f.actor)as any).error,'forbidden');
  assert.equal((await query("SELECT 1 FROM batch_a1_jobs")).rowCount,0);await f.noSend();
 }finally{await close();}
});

test("A1 jobs: intenção idempotente e concorrente, bytes originais imutáveis, projeção sem segredos e replay DDL",async()=>{
 const f=await fixture('t_a1_admit');
 try {
  const before=await f.snapshot();const available=await getA1Availability(f.input.batchId,f.actor);assert.ok(available.ok&&available.available);assert.equal((available as any).documentVersion,f.input.expectedDocumentVersion);
  const results=await Promise.all([admitA1Job(f.input,f.actor),admitA1Job(f.input,f.actor)]);assert.ok(results.every(r=>r.ok));
  const a=results[0];if(!a.ok)return;assert.equal(a.job.requestId,f.input.requestId);assert.equal((await getA1Availability(f.input.batchId,f.actor)as any).error,'active_job');
  assert.equal((results[1]as any).job.jobId,a.job.jobId);assert.equal((await query("SELECT 1 FROM batch_a1_jobs")).rowCount,1);
  assert.equal((await query("SELECT 1 FROM audit_log WHERE event='batch_a1_job_admitted'")).rowCount,1);
  assert.equal((await admitA1Job({...f.input,expectedPolicyRevision:2},f.actor)as any).error,'request_conflict');
  assert.equal((await admitA1Job({...f.input,requestId:randomUUID()},f.actor)as any).error,'active_job');
  assert.equal(a.job.inputArtifactVersionId,f.original.id);assert.equal(a.job.inputSha256,digest(f.bytes));assert.equal(a.job.credentialVersionId,f.policy.credentialVersionId);
  await query(BATCH_A1_SCHEMA_SQL);assert.equal((await query("SELECT 1 FROM batch_a1_jobs")).rowCount,1);
  await assert.rejects(query("UPDATE batch_a1_jobs SET credential_version_id=$2 WHERE id=$1",[a.job.jobId,randomUUID()]),/batch_a1_binding_immutable/);
  // Independent connection reads the persisted job; no in-memory lease/idempotency store is involved.
  const pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${process.env.DATABASE_SCHEMA}`});
  try{assert.equal((await pool.query("SELECT input_sha256 FROM batch_a1_jobs WHERE id=$1",[a.job.jobId])).rows[0].input_sha256,digest(f.bytes));}finally{await pool.end();}
  const read=await getA1Job(a.job.jobId,f.actor);assert.ok(read.ok);const publicJson=JSON.stringify(read);for(const forbidden of ['lease_token','leaseToken','authorization_id','actor_email','pdfBase64','bytes','pfx','password'])assert.ok(!publicJson.includes(forbidden),forbidden);
  assert.deepEqual(await f.snapshot(),before);await f.noSend();
 }finally{await close();}
});

test("A1 jobs: claim por CAS, lease/fencing e takeover não permitem falha tardia nem trocar job",async()=>{
 const f=await fixture('t_a1_lease');
 try {
  const before=await f.snapshot();const a=await admitA1Job(f.input,f.actor);assert.ok(a.ok);if(!a.ok)return;
  const claims=await Promise.all([claimA1Job(a.job.jobId,1),claimA1Job(a.job.jobId,1)]);assert.equal(claims.filter(x=>x.ok).length,1);
  const c=claims.find(x=>x.ok)!;if(!c.ok)return;assert.ok(c.bytes.equals(f.bytes));assert.equal(c.binding.inputArtifactVersionId,f.original.id);assert.equal(c.binding.expectedCnpj,'15883671000115');
  assert.equal((await claimA1Job(c.job.jobId,c.job.revision)as any).error,'busy');
  await query("UPDATE batch_a1_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[c.job.jobId]);
  assert.equal((await failA1Job(c.job.jobId,c.leaseToken,c.job.revision,'result_uncertain')as any).error,'lease_expired');
  const next=await claimA1Job(c.job.jobId,c.job.revision);assert.ok(next.ok);if(!next.ok)return;assert.notEqual(next.leaseToken,c.leaseToken);assert.equal(next.job.attempts,2);
  assert.equal((await failA1Job(c.job.jobId,c.leaseToken,next.job.revision,'signing_failed')as any).error,'conflict');
  assert.equal((await failA1Job(randomUUID(),next.leaseToken,next.job.revision,'signing_failed')as any).error,'not_found');
  assert.equal((await failA1Job(c.job.jobId,next.leaseToken,next.job.revision,'https://secret.invalid/pfx' as any)as any).error,'parameters');
  const failed=await failA1Job(c.job.jobId,next.leaseToken,next.job.revision,'result_uncertain');assert.ok(failed.ok);if(failed.ok){assert.equal(failed.job.state,'failed');assert.equal(failed.job.errorCode,'result_uncertain');}
  assert.equal((await claimA1Job(c.job.jobId,next.job.revision+1)as any).error,'not_claimable');
  assert.deepEqual(await f.snapshot(),before);await f.noSend();
 }finally{await close();}
});

test("A1 jobs: política alterada sem revisão, ator revogado e documento trocado invalidam claims",async()=>{
 for(const condition of ['policy','actor','session','document']as const){
  const f=await fixture('t_a1_stale_'+condition);
  try{
   const a=await admitA1Job(f.input,f.actor);assert.ok(a.ok);if(!a.ok)continue;
   if(condition==='policy')await query("UPDATE settings SET value=$2 WHERE key=$1",[BATCH_A1_POLICY_KEY,JSON.stringify({...f.policy,credentialVersionId:randomUUID()})]);
   if(condition==='actor')await query("UPDATE admin_users SET ativo=false WHERE id=1");
   if(condition==='session')await query("DELETE FROM admin_sessions WHERE id=$1",[f.actor.sessaoId]);
   if(condition==='document')await query("UPDATE batches SET pdf=$2 WHERE id=$1",[f.input.batchId,Buffer.concat([f.bytes,Buffer.from('changed')])]);
   const claimed=await claimA1Job(a.job.jobId,1);assert.equal(claimed.ok,false);assert.equal((claimed as any).error,'stale',condition);
   const stored=(await query("SELECT state,error_code,output_version_id FROM batch_a1_jobs WHERE id=$1",[a.job.jobId])).rows[0];assert.equal(stored.state,'stale');assert.equal(stored.output_version_id,null);await f.noSend();
  }finally{await close();}
 }
});

test("A1 jobs: auditoria falha reverte admissão, claim e falha; nenhum efeito criptográfico ou publicação",async()=>{
 const f=await fixture('t_a1_audit');
 try {
  await query(`CREATE FUNCTION fail_a1_audit_fixture() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
    IF NEW.event LIKE 'batch_a1_job_%' THEN RAISE EXCEPTION 'fixture_a1_audit_failed'; END IF; RETURN NEW; END;$f$;
    CREATE TRIGGER fail_a1_audit_fixture BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_a1_audit_fixture()`);
  await assert.rejects(admitA1Job(f.input,f.actor),/fixture_a1_audit_failed/);assert.equal((await query("SELECT 1 FROM batch_a1_jobs")).rowCount,0);
  await query("DROP TRIGGER fail_a1_audit_fixture ON audit_log");const a=await admitA1Job(f.input,f.actor);assert.ok(a.ok);if(!a.ok)return;
  const queued=(await query("SELECT row_to_json(j)::text value FROM batch_a1_jobs j")).rows;
  await query("CREATE TRIGGER fail_a1_audit_fixture BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_a1_audit_fixture()");
  await assert.rejects(claimA1Job(a.job.jobId,1),/fixture_a1_audit_failed/);assert.deepEqual((await query("SELECT row_to_json(j)::text value FROM batch_a1_jobs j")).rows,queued);
  await query("DROP TRIGGER fail_a1_audit_fixture ON audit_log");const c=await claimA1Job(a.job.jobId,1);assert.ok(c.ok);if(!c.ok)return;
  const running=(await query("SELECT row_to_json(j)::text value FROM batch_a1_jobs j")).rows;
  await query("CREATE TRIGGER fail_a1_audit_fixture BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_a1_audit_fixture()");
  await assert.rejects(failA1Job(c.job.jobId,c.leaseToken,c.job.revision,'validation_failed'),/fixture_a1_audit_failed/);assert.deepEqual((await query("SELECT row_to_json(j)::text value FROM batch_a1_jobs j")).rows,running);
  const b=(await query("SELECT signature_kind,signed_pdf FROM batches WHERE id=$1",[f.input.batchId])).rows[0];assert.equal(b.signature_kind,'none');assert.equal(b.signed_pdf,null);await f.noSend();
 }finally{await close();}
});


const signedOutput=(bytes:Buffer)=>process.env.QA_A1_SIGNED_PDF?readFileSync(process.env.QA_A1_SIGNED_PDF):Buffer.concat([bytes,Buffer.from('\n% QA output protocol fixture\n')]);
// Protocol integration fixture only: this fake adapter response does not establish real ICP homologation.
async function verifiedOutput(binding:Parameters<typeof verifyA1Pdf>[1],bytes:Buffer){
 process.env.A1_VALIDATION_ENABLED='1';process.env.A1_VALIDATION_ACCEPTED_POLICIES=JSON.stringify([{profile:'QA-HOMOLOGATED-FIXTURE',policyOid:'1.3.6.1.4.1.55555.1'}]);process.env.ICP_VALIDATOR_URL='http://127.0.0.1:54379/qa-never-called';
 const metadata={protocol:'peticao-a1-validation',version:2,valid:true,sha256:digest(bytes),cnpj:binding.expectedCnpj,certificateFingerprintSha256:binding.certificateFingerprintSha256,integrity:true,icpBrasilChainTrusted:true,coverage:'entire-file',modificationsAllowed:true,revocation:'good',profile:'QA-HOMOLOGATED-FIXTURE',policyOid:'1.3.6.1.4.1.55555.1',validatedAt:new Date().toISOString(),validatorVersion:'qa-2.0'};
 const result=await verifyA1Pdf(bytes,binding,async()=>new Response(JSON.stringify(metadata),{status:200,headers:{'content-type':'application/json'}}));assert.ok(result.ok);if(!result.ok)throw Error('fixture adapter refused');return result.proof;
}
async function running(f:Awaited<ReturnType<typeof fixture>>){const a=await admitA1Job(f.input,f.actor);assert.ok(a.ok);if(!a.ok)throw Error('admit');const c=await claimA1Job(a.job.jobId,a.job.revision);assert.ok(c.ok);if(!c.ok)throw Error('claim');return c;}

test('A1 finish: runtime proof, bytes/binding e commit atômico concorrente com replay único',async()=>{
 const f=await fixture('t_a1_finish');try{
  const c=await running(f),output=signedOutput(f.bytes),proof=await verifiedOutput(c.binding,output);
  assert.equal((await finishA1Job(c.job.jobId,c.leaseToken,c.job.revision,output,JSON.parse(JSON.stringify(proof)))as any).error,'invalid_proof');
  assert.equal((await finishA1Job(c.job.jobId,c.leaseToken,c.job.revision,Buffer.concat([output,Buffer.from('changed')]),proof)as any).error,'invalid_proof');
  await query("UPDATE batches SET approval_code_hash='qa-old-code',approval_code_expires_at=clock_timestamp()+interval '1 minute',approval_attempts=4 WHERE id=$1",[f.input.batchId]);
  const results=await Promise.all([finishA1Job(c.job.jobId,c.leaseToken,c.job.revision,output,proof),finishA1Job(c.job.jobId,c.leaseToken,c.job.revision,output,proof)]);
  assert.ok(results.every(x=>x.ok));assert.equal(results.filter(x=>x.ok&&!x.replayed).length,1);assert.equal(results.filter(x=>x.ok&&x.replayed).length,1);
  const r=results[0];if(!r.ok)return;
  assert.equal((await query("SELECT 1 FROM batch_a1_validations")).rowCount,1);assert.equal((await query("SELECT 1 FROM batch_document_versions WHERE variant='signed' AND source='a1-worker'")).rowCount,1);
  assert.equal((await query("SELECT 1 FROM audit_log WHERE event='batch_a1_job_succeeded'")).rowCount,1);
  const b=(await query("SELECT * FROM batches WHERE id=$1",[f.input.batchId])).rows[0];assert.ok(b.signed_pdf.equals(output));assert.ok(b.pdf.equals(f.bytes));assert.equal(b.signed_pdf_sha256,digest(output));assert.equal(b.signature_kind,'icp-brasil');assert.equal(b.status,'prepared');assert.equal(b.approved_at,null);assert.equal(b.approval_code_hash,null);assert.equal(b.approval_code_expires_at,null);assert.equal(b.approval_attempts,0);
  const report=(await query("SELECT * FROM batch_a1_validations")).rows[0];assert.equal(report.output_version_id,r.outputVersionId);assert.equal(report.output_sha256,digest(output));assert.equal(report.input_sha256,digest(f.bytes));assert.equal(report.metadata.validatorVersion,'qa-2.0');await assert.rejects(query("UPDATE batch_a1_validations SET metadata='{}' WHERE id=$1",[report.id]),/batch_a1_validation_immutable/);assert.ok(!JSON.stringify(report.metadata).includes('pdfBase64'));
  assert.equal((await finishA1Job(c.job.jobId,randomUUID(),c.job.revision,output,proof)as any).error,'conflict');await f.noSend();
 }finally{await close();}
});

test('A1 finish: auditoria falha reverte PDF, histórico, relatório e job',async()=>{
 const f=await fixture('t_a1_finish_rollback');try{
  const c=await running(f),output=signedOutput(f.bytes),proof=await verifiedOutput(c.binding,output),before=await f.snapshot();
  const beforeJob=(await query("SELECT row_to_json(j)::text raw FROM batch_a1_jobs j")).rows;
  await query(`CREATE FUNCTION qa_fail_finish_audit()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event='batch_a1_job_succeeded' THEN RAISE EXCEPTION 'qa finish audit failure'; END IF;RETURN NEW;END;$$;CREATE TRIGGER qa_finish_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_fail_finish_audit()`);
  await assert.rejects(finishA1Job(c.job.jobId,c.leaseToken,c.job.revision,output,proof),/qa finish audit failure/);
  assert.deepEqual(await f.snapshot(),before);assert.deepEqual((await query("SELECT row_to_json(j)::text raw FROM batch_a1_jobs j")).rows,beforeJob);assert.equal((await query("SELECT 1 FROM batch_a1_validations")).rowCount,0);await f.noSend();
 }finally{await close();}
});

test('A1 finish: revogação, política, documento, aprovação e lease impedem publicação tardia',async()=>{
 for(const mode of ['revoke','policy','document','approved','lease']as const){
  const f=await fixture('t_a1_finish_'+mode);try{
   const c=await running(f),output=signedOutput(f.bytes),proof=await verifiedOutput(c.binding,output);
   if(mode==='revoke')await query("DELETE FROM admin_sessions WHERE id=$1",[f.actor.sessaoId]);
   if(mode==='policy')await query("UPDATE settings SET value=$2 WHERE key=$1",[BATCH_A1_POLICY_KEY,JSON.stringify({...f.policy,credentialActive:false})]);
   if(mode==='document')await query("UPDATE batches SET signature_kind='changed' WHERE id=$1",[f.input.batchId]);
   if(mode==='approved')await query("UPDATE batches SET approved_at=clock_timestamp() WHERE id=$1",[f.input.batchId]);
   if(mode==='lease')await query("UPDATE batch_a1_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[c.job.jobId]);
   const r=await finishA1Job(c.job.jobId,c.leaseToken,c.job.revision,output,proof);assert.equal((r as any).error,mode==='lease'?'lease_expired':'stale');
   assert.equal((await query("SELECT 1 FROM batch_a1_validations")).rowCount,0);assert.equal((await query("SELECT 1 FROM batch_document_versions WHERE variant='signed'")).rowCount,0);assert.equal((await query("SELECT signed_pdf FROM batches WHERE id=$1",[f.input.batchId])).rows[0].signed_pdf,null);await f.noSend();
  }finally{await close();}
 }
});
