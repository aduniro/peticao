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
import { BATCH_A1_POLICY_KEY, admitA1Job, claimA1Job, finishA1Job, getA1JobByRequest, getA1Availability, failA1Job, type A1ServerPolicy } from "./batch-a1-jobs";
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

test("own→A1 default still admits prepared original, never automatically chooses own artifact",async()=>{
 const f=await fixture("t_own_a1_default");try{const {expectedOwnArtifactId:_,...input}=f.input;const a=await admitA1Job(input,f.actor);assert.ok(a.ok);assert.equal(a.job.ownArtifactId,null);assert.equal(a.job.inputArtifactVersionId,f.original.id);const c=await claimA1Job(a.job.jobId,a.job.revision);assert.ok(c.ok);assert.ok(c.bytes.equals(f.bytes));assert.equal((await query("SELECT 1 FROM president_own_a1_inputs")).rowCount,0);await f.noSend();}finally{await close();}
});
test("own→A1 concurrent explicit nonce freezes one exact provenance/history/job without batch mutation",async()=>{
 const f=await fixture("t_own_a1_freeze");try{const before=await f.snapshot();const all=await Promise.all([admitA1Job(f.input,f.actor),admitA1Job(f.input,f.actor)]);assert.ok(all.every(r=>r.ok));const a=all[0];assert.ok(a.ok);assert.equal(a.job.ownArtifactId,f.artifact.id);assert.notEqual(a.job.inputArtifactVersionId,f.original.id);assert.equal(a.job.inputSha256,f.artifact.sha256);assert.deepEqual(await f.snapshot(),before);assert.equal((await query("SELECT 1 FROM president_own_a1_inputs")).rowCount,1);assert.equal((await query("SELECT 1 FROM batch_document_versions WHERE source='president-own' AND variant='signed' AND signature_kind='own-confirmation'")).rowCount,1);const read=await getA1JobByRequest(f.b.id,f.input.requestId,f.actor);assert.ok(read.ok);assert.equal(read.job.ownArtifactId,f.artifact.id);const c=await claimA1Job(a.job.jobId,a.job.revision);assert.ok(c.ok);assert.ok(c.bytes.equals(f.artifact.bytes));assert.equal((await PDFDocument.load(c.bytes)).getPageCount(),2);assert.equal(c.binding.inputSha256,f.artifact.sha256);await f.noSend();}finally{await close();}
});
test("own→A1 used nonce cannot change own UUID or silently remove combined mode",async()=>{
 const f=await fixture("t_own_a1_nonce");try{const a=await admitA1Job(f.input,f.actor);assert.ok(a.ok);assert.equal((await admitA1Job({...f.input,expectedOwnArtifactId:randomUUID()},f.actor)as any).error,"request_conflict");const {expectedOwnArtifactId:_,...original}=f.input;assert.equal((await admitA1Job(original,f.actor)as any).error,"request_conflict");assert.equal((await query("SELECT 1 FROM president_own_a1_inputs")).rowCount,1);await f.noSend();}finally{await close();}
});
test("own→A1 missing artifact or profile changed before admission creates no history/job",async()=>{
 for(const mode of ["missing","profile"]as const){const f=await fixture("t_own_a1_admit_"+mode);try{if(mode==="profile")assert.ok((await configurePresidentProfile(f.actor,{responsibleId:2,enabled:true,expectedRevision:1})).ok);const a=await admitA1Job({...f.input,...(mode==="missing"?{expectedOwnArtifactId:randomUUID()}:{})},f.actor);assert.equal((a as any).error,"document_conflict");assert.equal((await query("SELECT 1 FROM batch_a1_jobs UNION ALL SELECT 1 FROM president_own_a1_inputs")).rowCount,0);await f.noSend();}finally{await close();}}
});
test("own→A1 receipt/profile/account changes after admission stale the claim without fallback",async()=>{
 for(const mode of ["profile","name","receipt","signed"]as const){const f=await fixture("t_own_a1_claim_"+mode);try{const a=await admitA1Job(f.input,f.actor);assert.ok(a.ok);if(mode==="profile")await configurePresidentProfile(f.actor,{responsibleId:2,enabled:true,expectedRevision:1});if(mode==="name")await query("UPDATE admin_users SET nome='Changed QA' WHERE id=2");if(mode==="receipt")await query("UPDATE president_challenges SET state='revoked',receipt_id=NULL,confirmed_at=NULL WHERE id=$1",[f.issued.id]);if(mode==="signed")await query("UPDATE batches SET signed_pdf=$1,signed_pdf_sha256=$2,signature_kind='externa-nao-validada' WHERE id=$3",[f.bytes,ownHash(f.bytes),f.b.id]);assert.equal((await claimA1Job(a.job.jobId,a.job.revision)as any).error,"stale");assert.equal((await query("SELECT state FROM batch_a1_jobs")).rows[0].state,"stale");await f.noSend();}finally{await close();}}
});
test("own→A1 fresh profile CAS after worker prevents publishing obsolete signed result",async()=>{
 const f=await fixture("t_own_a1_finish_cas");try{const a=await admitA1Job(f.input,f.actor);assert.ok(a.ok);const c=await claimA1Job(a.job.jobId,a.job.revision);assert.ok(c.ok);const output=Buffer.concat([c.bytes,Buffer.from("\n% QA PROTOCOL OUTPUT\n")]);const verified=await proof(c.binding,output);await configurePresidentProfile(f.actor,{responsibleId:2,enabled:true,expectedRevision:1});assert.equal((await finishA1Job(c.job.jobId,c.leaseToken,c.job.revision,output,verified)as any).error,"stale");assert.equal((await query("SELECT signed_pdf FROM batches")).rows[0].signed_pdf,null);assert.equal((await query("SELECT 1 FROM batch_a1_validations")).rowCount,0);await f.noSend();}finally{await close();}
});
test("own→A1 successful protocol-fixture finish preserves own/original and succeeds on exact replay",async()=>{
 const f=await fixture("t_own_a1_finish_replay");try{const a=await admitA1Job(f.input,f.actor);assert.ok(a.ok);const c=await claimA1Job(a.job.jobId,a.job.revision);assert.ok(c.ok);const output=Buffer.concat([c.bytes,Buffer.from("\n% QA PROTOCOL OUTPUT NOT REAL ICP\n")]);const verified=await proof(c.binding,output);const first=await finishA1Job(c.job.jobId,c.leaseToken,c.job.revision,output,verified);assert.ok(first.ok);assert.equal(first.replayed,false);const replay=await finishA1Job(c.job.jobId,c.leaseToken,c.job.revision,output,verified);assert.ok(replay.ok);assert.equal(replay.replayed,true);const batch=(await query("SELECT * FROM batches")).rows[0];assert.ok(batch.pdf.equals(f.bytes));assert.ok(batch.signed_pdf.equals(output));assert.equal(batch.signature_kind,"icp-brasil");const history=(await query("SELECT source,bytes FROM batch_document_versions ORDER BY ordinal")).rows;assert.deepEqual(history.map(r=>r.source),["prepared","president-own","a1-worker"]);assert.ok(history[1].bytes.equals(f.artifact.bytes));assert.equal((await query("SELECT input_sha256 FROM batch_a1_validations")).rows[0].input_sha256,f.artifact.sha256);await f.noSend();}finally{await close();}
});
test("own→A1 failed admission audit rolls back history bridge and job atomically",async()=>{
 const f=await fixture("t_own_a1_audit");try{await query("CREATE FUNCTION qa_own_a1_fail_audit()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.event='batch_a1_job_admitted' THEN RAISE EXCEPTION 'qa own A1 audit failure'; END IF;RETURN NEW;END;$$;CREATE TRIGGER qa_own_a1_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_own_a1_fail_audit()");await assert.rejects(admitA1Job(f.input,f.actor),/qa own A1 audit failure/);assert.equal((await query("SELECT 1 FROM batch_a1_jobs UNION ALL SELECT 1 FROM president_own_a1_inputs UNION ALL SELECT 1 FROM batch_document_versions WHERE source='president-own'")).rowCount,0);assert.equal((await query("SELECT 1 FROM president_own_document_artifacts")).rowCount,1);await f.noSend();}finally{await close();}
});
test("own→A1 bridge is immutable, rejects forged source and survives migration replay",async()=>{
 const f=await fixture("t_own_a1_immutable");try{const a=await admitA1Job(f.input,f.actor);assert.ok(a.ok);await query(PRESIDENT_OWN_A1_SCHEMA_SQL);assert.equal((await query("SELECT 1 FROM president_own_a1_inputs")).rowCount,1);await assert.rejects(query("UPDATE president_own_a1_inputs SET original_version_id=input_version_id"),/immutable/);await assert.rejects(query("DELETE FROM president_own_a1_inputs"),/immutable/);await assert.rejects(query("TRUNCATE president_own_a1_inputs"),/immutable/);const invalid=await tx(c=>appendDocumentVersion(c,{batchId:f.b.id,variant:"signed",bytes:f.artifact.bytes,sha256:f.artifact.sha256,listHash:f.b.list_hash,signatureKind:"own-confirmation",note:null,source:"upload",authorId:2,recordedBy:1}));await assert.rejects(query("INSERT INTO president_own_a1_inputs(own_artifact_id,input_version_id,original_version_id,created_by) VALUES($1,$2,$3,1)",[f.artifact.id,invalid.id,f.original.id]),/provenance mismatch/);await f.noSend();}finally{await close();}
});

test("own→A1 frozen own history alone cannot become a package or a public signed document",async()=>{
 const f=await fixture("t_own_a1_package_guard");
 const vars=["BATCH_PACKAGE_ENABLED","GOVBR_BASE_ENABLED","GOVBR_BASE_VALIDATION_ENABLED","GOVBR_BASE_VALIDATOR_URL","GOVBR_BASE_VALIDATION_ACCEPTED_PROFILES"];
 const old=Object.fromEntries(vars.map(k=>[k,process.env[k]]));
 try{
  const a=await admitA1Job(f.input,f.actor);assert.ok(a.ok);
  process.env.BATCH_PACKAGE_ENABLED="1";process.env.GOVBR_BASE_ENABLED="1";process.env.GOVBR_BASE_VALIDATION_ENABLED="1";process.env.GOVBR_BASE_VALIDATOR_URL="http://127.0.0.1:1/never-called";process.env.GOVBR_BASE_VALIDATION_ACCEPTED_PROFILES='["QA-GOVBR-PROOF"]';
  const {petitionBaseValidationReady}=await import("./petition-base-validation");assert.equal(petitionBaseValidationReady(),true,"gate is enabled; denial must be the document guard");
  const {prepareBatchPackage}=await import("./batch-package-store");
  assert.deepEqual(await prepareBatchPackage({batchId:f.b.id,requestId:randomUUID(),expectedDocumentVersion:f.input.expectedDocumentVersion,expectedSelectionId:randomUUID(),expectedPackageRevision:0},f.actor),{ok:false,error:"document_conflict"});
  const {setDocumentPublication}=await import("./document-verification");
  assert.deepEqual(await setDocumentPublication({versionId:a.job.inputArtifactVersionId,sha256:f.artifact.sha256,enabled:true,expectedRevision:0},f.actor),{ok:false,error:"ineligible"});
  assert.equal((await query("SELECT 1 FROM batch_packages")).rowCount,0);assert.equal((await query("SELECT signed_pdf FROM batches")).rows[0].signed_pdf,null);await f.noSend();
 }finally{for(const k of vars){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}await close();}
});


test("own→A1 availability is an exact fresh read with no history freeze or job",async()=>{
 const f=await fixture("t_own_a1_available_read");try{
  const r=await getA1Availability(f.b.id,f.actor,f.artifact.id);assert.ok(r.ok);assert.equal(r.available,true);assert.equal(r.ownArtifactId,f.artifact.id);assert.equal(r.documentVersion,f.input.expectedDocumentVersion);assert.notEqual(r.documentVersion,f.issued.documentVersion);
  assert.equal((await query("SELECT 1 FROM president_own_a1_inputs UNION ALL SELECT 1 FROM batch_a1_jobs UNION ALL SELECT 1 FROM batch_document_versions WHERE source='president-own'")).rowCount,0);
  assert.equal((await getA1Availability(f.b.id,f.actor,"bad")as any).error,"parameters");const missing=await getA1Availability(f.b.id,f.actor,randomUUID());assert.ok(missing.ok);assert.equal(missing.available,false);assert.equal(missing.error,"own_document_unavailable");await f.noSend();
 }finally{await close();}
});
test("own→A1 availability reflects profile changes while original readiness is preserved",async()=>{
 const f=await fixture("t_own_a1_available_profile");try{
  assert.equal((await getA1Availability(f.b.id,f.actor,f.artifact.id)as any).available,true);await configurePresidentProfile(f.actor,{responsibleId:2,enabled:true,expectedRevision:1});const r=await getA1Availability(f.b.id,f.actor,f.artifact.id);assert.ok(r.ok);assert.equal(r.available,false);assert.equal(r.error,"own_document_unavailable");assert.equal((await getA1Availability(f.b.id,f.actor)as any).available,true);assert.equal((await admitA1Job(f.input,f.actor)as any).error,"document_conflict");await f.noSend();
 }finally{await close();}
});
test("own→A1 timely consumed receipt survives access expiry, but expired admin stepup denies readiness",async()=>{
 const f=await fixture("t_own_a1_available_expiry");try{
  await query("UPDATE president_challenges SET expires_at=confirmed_at+interval '1 millisecond' WHERE id=$1",[f.issued.id]);assert.equal((await getA1Availability(f.b.id,f.actor,f.artifact.id)as any).available,true);
  await query("UPDATE admin_sessions SET stepup_ate=clock_timestamp()-interval '1 second' WHERE id=$1",[f.actor.sessaoId]);assert.equal((await getA1Availability(f.b.id,f.actor,f.artifact.id)as any).error,"forbidden");await f.noSend();
 }finally{await close();}
});
test("own→A1 other-mode active job blocks without being projected as combined result",async()=>{
 const f=await fixture("t_own_a1_available_foreign");try{
  const {expectedOwnArtifactId:_,...original}=f.input;const a=await admitA1Job(original,f.actor);assert.ok(a.ok);const blocked=await getA1Availability(f.b.id,f.actor,f.artifact.id);assert.ok(blocked.ok);assert.equal(blocked.available,false);assert.equal(blocked.error,"active_job");assert.equal(blocked.latestJob,undefined);
  const c=await claimA1Job(a.job.jobId,a.job.revision);assert.ok(c.ok);assert.ok((await failA1Job(c.job.jobId,c.leaseToken,c.job.revision,"worker_unavailable")).ok);const ready=await getA1Availability(f.b.id,f.actor,f.artifact.id);assert.ok(ready.ok);assert.equal(ready.available,true);assert.equal(ready.latestJob,undefined);const global=await getA1Availability(f.b.id,f.actor);assert.ok(global.ok);assert.equal(global.latestJob?.jobId,a.job.jobId);await f.noSend();
 }finally{await close();}
});
