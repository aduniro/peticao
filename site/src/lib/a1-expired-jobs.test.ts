import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { ownHash } from "./president-own-document-contract";
import { PRESIDENT_OWN_DOCUMENT_SCHEMA_SQL } from "./president-own-document-schema";
import { PRESIDENT_OWN_A1_SCHEMA_SQL } from "./president-own-a1-schema";
import { _openForTests, _closeDbForTests, query, tx, audit, verifyAuditChain } from "./db";
import { abrirSessao, sessaoPorToken } from "./admin-users";
import { appendDocumentVersion } from "./batch-document-history";
import { freezePreparation } from "./batch-preparation";
import { documentVersion, type ApprovalRow } from "./batches";
import { configurePresidentProfile, issueConfiguredPresidentChallenge, confirmConfiguredPresidentChallenge } from "./president-portal-store";
import { mockProvider } from "./cpf-check";
import { createPresidentOwnDocument } from "./president-own-document-store";
import { BATCH_A1_POLICY_KEY, admitA1Job, claimA1Job, finishA1Job, getA1JobByRequest, getA1Availability, failA1Job, closeExpiredA1Job, getExpiredA1Closure, type A1ServerPolicy } from "./batch-a1-jobs";
import { verifyA1Pdf } from "./a1-validation";

(process.env as Record<string,string>).NODE_ENV="test";
process.env.MAIL_PROVIDER="dev";
const cpf="52998224725";
async function fixture(schema:string){
 const url=new URL(process.env.DATABASE_URL!);assert.ok(["127.0.0.1","localhost","[::1]"].includes(url.hostname));assert.ok(url.port&&url.port!=="5432");
 await _openForTests(schema);await query(PRESIDENT_OWN_DOCUMENT_SCHEMA_SQL);await query(PRESIDENT_OWN_A1_SCHEMA_SQL);
 await query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash)VALUES(1,'own-a1-owner@example.test','QA Owner','total','QA-NO-LOGIN'),(2,'own-a1-president@example.test','Pessoa Responsavel QA','leitura','QA-NO-LOGIN')");
 const session=await abrirSessao(1,"127.0.0.1");await query("UPDATE admin_sessions SET stepup_ate=now()+interval '9 minutes' WHERE user_id=1");const actor=(await sessaoPorToken(session.token))!;
 const pdf=await PDFDocument.create();pdf.addPage([300,400]).drawText("FICTITIOUS OWN A1 QA");const bytes=Buffer.from(await pdf.save());
 const rows=[{id:1,name:"Pessoa Ficticia QA",category:"apoiador",institution:null,role:null,city:"QA",uf:"RO"}];const listHash=ownHash(JSON.stringify(rows));
 const b=(await query<ApprovalRow>("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf,pdf_sha256,signature_kind)VALUES(1,'final','prepared',0,1,$1,$2,$3,'none')RETURNING *",[listHash,bytes,ownHash(bytes)])).rows[0];
 const prep=freezePreparation(rows,{seq:1,kind:"final",generatedAt:"2026-11-09T12:00:00.000Z",listHash,nServidor:0,nApoiador:1,signedNote:"",signaturePreparation:"a1"},{kind:"scheduler"});
 await query("INSERT INTO batch_preparations(batch_id,snapshot,snapshot_sha256)VALUES($1,$2,$3)",[b.id,prep.snapshot,prep.sha256]);await audit("batch_created",null,{batchId:b.id,snapshotSha256:prep.sha256,source:"scheduler"});
 const original=await tx(c=>appendDocumentVersion(c,{batchId:b.id,variant:"original",bytes,sha256:ownHash(bytes),listHash,signatureKind:"none",note:null,source:"prepared",authorId:1,recordedBy:1}));
 const provider=mockProvider({[cpf]:{nome:"Pessoa Responsavel QA",nasc:"01/01/2000"}});
 assert.ok((await configurePresidentProfile(actor,{responsibleId:2,cpf,enabled:true,expectedRevision:0})).ok);
 const issued=await issueConfiguredPresidentChallenge(b.id,actor,provider);assert.ok(issued.ok);const confirmed=await confirmConfiguredPresidentChallenge({...issued,cpf,birthDate:"2000-01-01"},provider);assert.ok(confirmed.ok);
 const own=await createPresidentOwnDocument({requestId:randomUUID(),batchId:b.id,receiptId:confirmed.receiptId,expectedDocumentVersion:issued.documentVersion},actor);assert.ok(own.ok);assert.equal(own.document.state,"completed");assert.ok(own.document.artifactId);
 const artifact=(await query("SELECT * FROM president_own_document_artifacts WHERE id=$1",[own.document.artifactId])).rows[0];
 const policy:A1ServerPolicy={version:1,revision:1,enabled:true,credentialActive:true,credentialVersionId:randomUUID(),profileVersion:"pades-basic-unhomologated-v1",trustStoreVersion:"b".repeat(64),expectedCnpj:"15883671000115",certificateFingerprintSha256:"c".repeat(64)};
 await query("INSERT INTO settings(key,value)VALUES($1,$2)",[BATCH_A1_POLICY_KEY,JSON.stringify(policy)]);process.env.BATCH_A1_ENABLED="1";
 const input={batchId:b.id,requestId:randomUUID(),expectedDocumentVersion:documentVersion(b),expectedPolicyRevision:1,expectedOwnArtifactId:artifact.id as string};
 const snapshot=async()=>(await query("SELECT row_to_json(b)::text raw FROM batches b")).rows;
 const noSend=async()=>{assert.equal((await query("SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM batch_sends")).rowCount,0);assert.ok((await verifyAuditChain()).ok);};
 return{actor,session,b,bytes,original,issued,confirmed,artifact,policy,input,snapshot,noSend};
}
async function close(){delete process.env.BATCH_A1_ENABLED;delete process.env.A1_VALIDATION_ENABLED;delete process.env.A1_VALIDATION_ACCEPTED_POLICIES;delete process.env.ICP_VALIDATOR_URL;await _closeDbForTests();}
async function proof(binding:Parameters<typeof verifyA1Pdf>[1],bytes:Buffer){
 process.env.A1_VALIDATION_ENABLED="1";process.env.A1_VALIDATION_ACCEPTED_POLICIES=JSON.stringify([{profile:"QA-OWN-A1-FIXTURE",policyOid:"1.3.6.1.4.1.55555.1"}]);process.env.ICP_VALIDATOR_URL="http://127.0.0.1:54379/never-called";
 const result=await verifyA1Pdf(bytes,binding,async()=>Response.json({protocol:"peticao-a1-validation",version:2,valid:true,sha256:ownHash(bytes),cnpj:binding.expectedCnpj,certificateFingerprintSha256:binding.certificateFingerprintSha256,integrity:true,icpBrasilChainTrusted:true,coverage:"entire-file",modificationsAllowed:true,revocation:"good",profile:"QA-OWN-A1-FIXTURE",policyOid:"1.3.6.1.4.1.55555.1",validatedAt:new Date().toISOString(),validatorVersion:"qa-fixture"}));assert.ok(result.ok);return result.proof;
}

async function expiredJob(f:Awaited<ReturnType<typeof fixture>>,mode:"queued"|"running"|"validating"="running",liveLease=false,liveAuth=false){
 const a=await admitA1Job(f.input,f.actor);assert.ok(a.ok);
 await query("UPDATE batch_a1_jobs SET state='failed',error_code='worker_unavailable' WHERE id=$1",[a.job.jobId]);
 const id=randomUUID(),token=randomUUID();
 await query(`INSERT INTO batch_a1_jobs SELECT (jsonb_populate_record(NULL::batch_a1_jobs,to_jsonb(j)||jsonb_build_object('id',$2::text,'request_id',$3::text,'authorization_id',$4::text,'authorized_at',clock_timestamp()-interval '5 minutes','authorization_expires_at',CASE WHEN $8::boolean THEN clock_timestamp()+interval '1 minute' ELSE clock_timestamp()-interval '1 minute' END,'state',$5::text,'revision',1,'attempts',1,'error_code',NULL,'lease_token',CASE WHEN $5::text='queued' THEN NULL ELSE $6::text END,'lease_until',CASE WHEN $5::text='queued' THEN NULL WHEN $7::boolean THEN clock_timestamp()+interval '1 minute' ELSE clock_timestamp()-interval '1 second' END))).* FROM batch_a1_jobs j WHERE id=$1`,[a.job.jobId,id,randomUUID(),randomUUID(),mode,token,liveLease,liveAuth]);
 return {id,token,input:{batchId:f.b.id,requestId:randomUUID(),jobId:id,expectedRevision:1,expectedDocumentVersion:f.input.expectedDocumentVersion,expectedOwnArtifactId:f.artifact.id}};
}
test("A1 explicit expired close fences old worker, preserves PDFs, and recovers exact nonce",async()=>{
 for(const mode of ["queued","running","validating"]as const){const f=await fixture("t_expclose_"+mode);try{
 const j=await expiredJob(f,mode),before=await f.snapshot();const results=await Promise.all([closeExpiredA1Job(j.input,f.actor),closeExpiredA1Job(j.input,f.actor)]);assert.ok(results.every(r=>r.ok));const r=results[0];assert.ok(r.ok);assert.equal(r.job.state,"stale");assert.equal(r.job.revision,2);assert.equal(r.job.leaseUntil,null);assert.equal(r.job.ownArtifactId,f.artifact.id);assert.notEqual(r.job.requestId,j.input.requestId);assert.deepEqual(await f.snapshot(),before);
 const recovery=await getExpiredA1Closure(f.b.id,j.input.requestId,f.actor);assert.ok(recovery.ok);assert.equal(recovery.replayed,true);assert.equal(recovery.closeRequestId,j.input.requestId);assert.equal((await claimA1Job(j.id,1)as any).error,"conflict");assert.equal((await failA1Job(j.id,j.token,1,"signing_failed")as any).error,"conflict");assert.equal((await query("SELECT 1 FROM audit_log WHERE event='batch_a1_expired_closed'")).rowCount,1);await f.noSend();
 }finally{await close();}}
});
test("A1 explicit close refuses live auth or live lease independently",async()=>{
 for(const live of ["auth","lease"]as const){const f=await fixture("t_expclose_live_"+live);try{const j=await expiredJob(f,"running",live==="lease",live==="auth");assert.equal((await closeExpiredA1Job(j.input,f.actor)as any).error,"not_expired");assert.equal((await query("SELECT state FROM batch_a1_jobs WHERE id=$1",[j.id])).rows[0].state,"running");assert.equal((await query("SELECT 1 FROM audit_log WHERE event='batch_a1_expired_closed'")).rowCount,0);await f.noSend();}finally{await close();}}
});
test("A1 explicit close rejects revision, document and source mode mismatches",async()=>{
 const f=await fixture("t_expclose_cas");try{const j=await expiredJob(f);for(const change of [{expectedRevision:2},{expectedDocumentVersion:"a".repeat(64)},{expectedOwnArtifactId:randomUUID()}])assert.equal((await closeExpiredA1Job({...j.input,...change},f.actor)as any).error,"conflict");const {expectedOwnArtifactId:_,...original}=j.input;assert.equal((await closeExpiredA1Job(original,f.actor)as any).error,"conflict");assert.equal((await query("SELECT revision FROM batch_a1_jobs WHERE id=$1",[j.id])).rows[0].revision,1);await f.noSend();}finally{await close();}
});
test("A1 explicit close remains available after policy/profile/batch changes, with current Total stepup",async()=>{
 const f=await fixture("t_expclose_changed");try{const j=await expiredJob(f);delete process.env.BATCH_A1_ENABLED;await configurePresidentProfile(f.actor,{responsibleId:2,enabled:true,expectedRevision:1});await query("UPDATE batches SET list_hash='changed-after-job' WHERE id=$1",[f.b.id]);assert.ok((await closeExpiredA1Job(j.input,f.actor)).ok);await f.noSend();}finally{await close();}
});
test("A1 explicit close journal is actor-scoped and immutable across payload replay",async()=>{
 const f=await fixture("t_expclose_nonce");try{const j=await expiredJob(f);assert.ok((await closeExpiredA1Job(j.input,f.actor)).ok);assert.equal((await closeExpiredA1Job({...j.input,expectedRevision:2},f.actor)as any).error,"request_conflict");assert.equal((await closeExpiredA1Job({...j.input,requestId:randomUUID()},f.actor)as any).error,"conflict");await query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash)VALUES(3,'other-closer@example.test','Other Total QA','total','QA-NO-LOGIN')");const session=await abrirSessao(3,"127.0.0.1");await query("UPDATE admin_sessions SET stepup_ate=now()+interval '9 minutes' WHERE user_id=3");const actor=(await sessaoPorToken(session.token))!;assert.equal((await getExpiredA1Closure(f.b.id,j.input.requestId,actor)as any).error,"not_found");await query("UPDATE admin_sessions SET stepup_ate=clock_timestamp()-interval '1 second' WHERE id=$1",[f.actor.sessaoId]);assert.equal((await getExpiredA1Closure(f.b.id,j.input.requestId,f.actor)as any).error,"forbidden");assert.equal((await closeExpiredA1Job(j.input,f.actor)as any).error,"forbidden");await f.noSend();}finally{await close();}
});
test("A1 explicit close failed audit rolls back state/revision/lease and permits same nonce later",async()=>{
 const f=await fixture("t_expclose_audit");try{const j=await expiredJob(f);const before=(await query("SELECT row_to_json(j)::text raw FROM batch_a1_jobs j WHERE id=$1",[j.id])).rows;await query("CREATE FUNCTION qa_close_audit_fail()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event='batch_a1_expired_closed' THEN RAISE EXCEPTION 'qa close audit failure'; END IF;RETURN NEW;END;$$;CREATE TRIGGER qa_close_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_close_audit_fail()");await assert.rejects(closeExpiredA1Job(j.input,f.actor),/qa close audit failure/);assert.deepEqual((await query("SELECT row_to_json(j)::text raw FROM batch_a1_jobs j WHERE id=$1",[j.id])).rows,before);assert.equal((await getExpiredA1Closure(f.b.id,j.input.requestId,f.actor)as any).error,"not_found");await query("DROP TRIGGER qa_close_audit ON audit_log");assert.ok((await closeExpiredA1Job(j.input,f.actor)).ok);await f.noSend();}finally{await close();}
});

test("A1 original close never requires own UUID and terminal jobs are not reclosed",async()=>{
 const f=await fixture("t_expclose_original");try{
 const {expectedOwnArtifactId:_,...original}=f.input;f.input=original as typeof f.input;
 const j=await expiredJob(f,"queued");const {expectedOwnArtifactId:__,...intent}=j.input;
 assert.equal((await closeExpiredA1Job({...intent,expectedOwnArtifactId:f.artifact.id},f.actor)as any).error,"conflict");
 const r=await closeExpiredA1Job(intent,f.actor);assert.ok(r.ok);assert.equal(r.job.ownArtifactId,null);
 assert.equal((await closeExpiredA1Job({...intent,requestId:randomUUID(),expectedRevision:r.job.revision},f.actor)as any).error,"not_closeable");
 assert.equal((await getExpiredA1Closure(f.b.id,randomUUID(),f.actor)as any).error,"not_found");await f.noSend();
 }finally{await close();}
});
test("A1 expired close fences even a validator-approved late worker result",async()=>{
 const f=await fixture("t_expclose_late_finish");try{const j=await expiredJob(f,"running"),before=await f.snapshot();const r=await closeExpiredA1Job(j.input,f.actor);assert.ok(r.ok);const output=Buffer.concat([f.artifact.bytes,Buffer.from("\n% FICTITIOUS LATE WORKER RESULT\n")]);const verified=await proof(r.job,output);assert.equal((await finishA1Job(j.id,j.token,1,output,verified)as any).error,"conflict");assert.deepEqual(await f.snapshot(),before);assert.equal((await query("SELECT 1 FROM batch_a1_validations")).rowCount,0);assert.equal((await query("SELECT 1 FROM batch_document_versions WHERE source='a1-worker'")).rowCount,0);await f.noSend();}finally{await close();}
});
