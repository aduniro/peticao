import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { _openForTests, _closeDbForTests, query } from "./db";
import { abrirSessao, sessaoPorToken } from "./admin-users";
import { documentVersion, type ApprovalRow } from "./batches";
import { admitA1Job, claimA1Job, getA1Availability, BATCH_A1_POLICY_KEY } from "./batch-a1-jobs";

(process.env as Record<string,string>).NODE_ENV="test";
process.env.MAIL_PROVIDER="dev";
const digest=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
async function fixture(name:string){
  const url=new URL(process.env.DATABASE_URL!);assert.ok(["127.0.0.1","localhost","[::1]"].includes(url.hostname));assert.ok(url.port&&url.port!=="5432");assert.equal(process.env.MAIL_PROVIDER,"dev");
  delete process.env.PETICAO_RUNTIME;delete process.env.BATCH_LEGACY_CONTROL;
  await _openForTests(name);await query("SELECT 1");
  await query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS runtime_owner text NOT NULL DEFAULT 'legacy'; CREATE TABLE IF NOT EXISTS batch_runtime_control(singleton boolean PRIMARY KEY,controller text NOT NULL); INSERT INTO batch_runtime_control VALUES(true,'v2')");
  await query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash)VALUES(1,'qa-legacy@example.invalid','QA Legacy','total','QA-NO-LOGIN')");
  const session=await abrirSessao(1,"127.0.0.1");await query("UPDATE admin_sessions SET stepup_ate=clock_timestamp()+interval '9 minutes'");const actor=(await sessaoPorToken(session.token))!;
  const pdf=await PDFDocument.create();pdf.addPage([200,200]);const bytes=Buffer.from(await pdf.save());const listHash=digest(Buffer.from("legacy-list-known-hash-no-snapshot"));
  const b=(await query<ApprovalRow>("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf,pdf_sha256,signature_kind,runtime_owner)VALUES(1,'partial','prepared',2,3,$1,$2,$3,'none','legacy')RETURNING *",[listHash,bytes,digest(bytes)])).rows[0];
  const policy={version:1,revision:1,enabled:true,credentialActive:true,credentialVersionId:randomUUID(),profileVersion:"pades-ad-rb-declared-unhomologated-v1",trustStoreVersion:"b".repeat(64),expectedCnpj:"15883671000115",certificateFingerprintSha256:"c".repeat(64)};
  await query("INSERT INTO settings(key,value)VALUES($1,$2)",[BATCH_A1_POLICY_KEY,JSON.stringify(policy)]);
  process.env.BATCH_A1_ENABLED="1";process.env.PETICAO_RUNTIME="admin-v2";process.env.BATCH_LEGACY_CONTROL="admin-v2";
  const input={batchId:b.id,requestId:randomUUID(),expectedDocumentVersion:documentVersion(b),expectedPolicyRevision:1};
  const batch=async()=>(await query("SELECT row_to_json(b)::text raw FROM batches b WHERE id=$1",[b.id])).rows;
  const effects=async()=>(await query("SELECT (SELECT count(*)::int FROM batch_document_versions) versions,(SELECT count(*)::int FROM audit_log WHERE event='batch_legacy_a1_adopted') adoptions,(SELECT count(*)::int FROM batch_a1_jobs) jobs,(SELECT count(*)::int FROM batch_preparations) preparations,(SELECT count(*)::int FROM batch_sends)+(SELECT count(*)::int FROM mail_outbox)+(SELECT count(*)::int FROM mail_messages) sends")).rows[0];
  return{actor,input,bytes,batch,effects};
}
async function close(){delete process.env.PETICAO_RUNTIME;delete process.env.BATCH_LEGACY_CONTROL;delete process.env.BATCH_A1_ENABLED;await _closeDbForTests();}

test("legacy A1: availability observes exact existing PDF without writing preparation, history, job or adoption",async()=>{
  const f=await fixture("t_a1_legacy_read");try{
    const before=await f.batch();const r=await getA1Availability(f.input.batchId,f.actor);assert.ok(r.ok&&r.available);assert.equal((r as any).documentVersion,f.input.expectedDocumentVersion);
    assert.deepEqual(await f.effects(),{versions:0,adoptions:0,jobs:0,preparations:0,sends:0});assert.deepEqual(await f.batch(),before);
  }finally{await close()}
});

test("legacy A1: unauthorized, changed document, changed policy and own-artifact requests never adopt",async()=>{
  const f=await fixture("t_a1_legacy_denied");try{
    assert.equal((await admitA1Job(f.input,{...f.actor,sessaoId:null})as any).error,"forbidden");
    assert.equal((await admitA1Job({...f.input,expectedDocumentVersion:"a".repeat(64)},f.actor)as any).error,"document_conflict");
    assert.equal((await admitA1Job({...f.input,expectedPolicyRevision:2},f.actor)as any).error,"policy_conflict");
    assert.equal((await admitA1Job({...f.input,expectedOwnArtifactId:randomUUID()},f.actor)as any).error,"document_conflict");
    assert.deepEqual(await f.effects(),{versions:0,adoptions:0,jobs:0,preparations:0,sends:0});
  }finally{await close()}
});

test("legacy A1: explicit idempotent admission captures observed bytes once and claim returns exact original",async()=>{
  const f=await fixture("t_a1_legacy_adopt");try{
    const before=await f.batch();const results=await Promise.all([admitA1Job(f.input,f.actor),admitA1Job(f.input,f.actor)]);assert.ok(results.every(r=>r.ok));assert.equal(results.filter(r=>r.ok&&!r.replayed).length,1);
    const r=results[0];if(!r.ok)throw Error("admission rejected");
    assert.deepEqual(await f.effects(),{versions:1,adoptions:1,jobs:1,preparations:0,sends:0});assert.deepEqual(await f.batch(),before);
    const version=(await query("SELECT * FROM batch_document_versions")).rows[0];assert.equal(version.source,"legacy-observed");assert.equal(version.author_id,null);assert.ok(version.bytes.equals(f.bytes));
    const proof=JSON.parse((await query("SELECT data FROM audit_log WHERE event='batch_legacy_a1_adopted'")).rows[0].data);assert.equal(proof.originalVersionId,version.id);assert.equal(proof.documentVersion,f.input.expectedDocumentVersion);assert.equal(proof.pdfSha256,digest(f.bytes));
    const claimed=await claimA1Job(r.job.jobId,r.job.revision);assert.ok(claimed.ok);if(!claimed.ok)throw Error("claim rejected");assert.ok(claimed.bytes.equals(f.bytes));assert.equal(claimed.binding.inputArtifactVersionId,version.id);
    await assert.rejects(query("UPDATE batch_document_versions SET source='prepared' WHERE id=$1",[version.id]),/immutable/);assert.deepEqual(await f.batch(),before);
  }finally{await close()}
});

test("legacy A1: split controller, V2 provenance, malformed PDF and any preparation cannot bypass the normal gates",async()=>{
  for(const condition of ["split","v2","hash","preparation"]as const){
    const f=await fixture("t_a1_legacy_gate_"+condition);try{
      if(condition==="split")await query("UPDATE batch_runtime_control SET controller='split'");
      if(condition==="v2")await query("UPDATE batches SET runtime_owner='v2'");
      if(condition==="hash")await query("UPDATE batches SET pdf=pdf||decode('00','hex')");
      if(condition==="preparation")await query("INSERT INTO batch_preparations(batch_id,snapshot,snapshot_sha256)VALUES($1,'untrusted-no-reconstruction',$2)",[f.input.batchId,"a".repeat(64)]);
      const r=await getA1Availability(f.input.batchId,f.actor);assert.ok(r.ok&&!r.available);
      assert.equal((await admitA1Job(f.input,f.actor)as any).error,"document_conflict");const e=await f.effects();assert.equal(e.versions,0);assert.equal(e.adoptions,0);assert.equal(e.jobs,0);assert.equal(e.sends,0);
    }finally{await close()}
  }
});

test("legacy A1: adoption audit failure rolls back observed history and job, preserving the batch",async()=>{
  const f=await fixture("t_a1_legacy_rollback");try{
    const before=await f.batch();await query("CREATE FUNCTION fail_legacy_adoption()RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='batch_legacy_a1_adopted' THEN RAISE EXCEPTION 'QA adoption audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_legacy_adoption BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_legacy_adoption()");
    await assert.rejects(admitA1Job(f.input,f.actor),/QA adoption audit failure/);assert.deepEqual(await f.effects(),{versions:0,adoptions:0,jobs:0,preparations:0,sends:0});assert.deepEqual(await f.batch(),before);
  }finally{await close()}
});
