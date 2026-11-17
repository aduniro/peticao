import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { PETITION_BASE_SCHEMA_SQL } from "./petition-base-schema";
import { capturePetitionBaseValidationInput, persistPetitionBaseValidation } from "./petition-base-validation-store";
import { stagePetitionBase } from "./petition-base-store";
import { verifyPetitionBasePdf } from "./petition-base-validation";
import { hmac } from "./security";
const cpf = "52998224725", bytes = Buffer.from("%PDF-1.7 QA BASE STORE synthetic fixture");
const hash = (v: Buffer) => createHash("sha256").update(v).digest("hex");
const variables = ["GOVBR_BASE_ENABLED", "GOVBR_BASE_VALIDATION_ENABLED", "GOVBR_BASE_VALIDATOR_URL", "GOVBR_BASE_VALIDATION_ACCEPTED_PROFILES", "GOVBR_BASE_VALIDATOR_TOKEN", "BATCH_PACKAGE_ENABLED", "BATCH_PACKAGE_MAX_ENCODED_BYTES"];
async function fixture(name: string) {
  const db = await import("./db"); await db._openForTests(name); await db.query(PETITION_BASE_SCHEMA_SQL); await db.query(BATCH_PACKAGE_SCHEMA_SQL);
  await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash)VALUES(1,'qa-base-proof@example.test','QA Total','total','NOT-A-PASSWORD'),(2,'qa-base-reader@example.test','QA Reader','leitura','NOT-A-PASSWORD')");
  const U = await import("./admin-users");
  const session = await U.abrirSessao(1, "127.0.0.1"), readerSession = await U.abrirSessao(2, "127.0.0.1"); await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes'");
  const actor = (await U.sessaoPorToken(session.token))!, reader = (await U.sessaoPorToken(readerSession.token))!;
  const original = Object.fromEntries(variables.map(n => [n, process.env[n]]));
  process.env.GOVBR_BASE_ENABLED = "1"; process.env.GOVBR_BASE_VALIDATION_ENABLED = "1"; process.env.GOVBR_BASE_VALIDATOR_URL = "http://127.0.0.1:1/validate"; process.env.GOVBR_BASE_VALIDATION_ACCEPTED_PROFILES = '["QA-GOVBR-PROOF"]'; process.env.GOVBR_BASE_VALIDATOR_TOKEN = "QA-BASE-ONLY";
  process.env.BATCH_PACKAGE_ENABLED = "1"; delete process.env.BATCH_PACKAGE_MAX_ENCODED_BYTES;
  const profile = { version: 1, revision: 1, responsibleId: 1, cpfHash: hmac("president-cpf:v1:" + cpf), enabled: true, whatsappCipher: null };
  await db.query("INSERT INTO settings(key,value)VALUES('president_profile_v1',$1)", [JSON.stringify(profile)]);
  const staged = await stagePetitionBase({ requestId: randomUUID(), bytes }, actor); assert.ok(staged.ok); const artifactId = staged.artifactId;
  async function proof() {
    const captured = await capturePetitionBaseValidationInput(artifactId, actor); assert.ok(captured.ok);
    const report = { protocol: "peticao-base-validation", version: 1, valid: true, sha256: hash(bytes), method: "gov-br-advanced", signerCpf: cpf, certificateFingerprintSha256: "b".repeat(64), integrity: true, govBrChainTrusted: true, coverage: "entire-file", modificationsAllowed: true, revocation: "good", profile: "QA-GOVBR-PROOF", validatedAt: new Date().toISOString(), validatorVersion: "qa-1" };
    const checked = await verifyPetitionBasePdf(captured.bytes, captured.binding, (async () => new Response(JSON.stringify(report), { headers: { "content-type": "application/json" } })) as typeof fetch); assert.ok(checked.ok);
    return { binding: captured.binding, proof: checked.proof };
  }
  const close = async () => { for (const n of variables) if (original[n] === undefined) delete process.env[n]; else process.env[n] = original[n]; await db._closeDbForTests(); };
  const noSend = async () => assert.equal((await db.query("SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM batch_sends")).rowCount, 0);
  return { db, actor, reader, profile, artifactId, proof, close, noSend };
}
import { selectPetitionBase, currentPetitionBaseSelection } from "./petition-base-selection";
async function intent(c: Awaited<ReturnType<typeof fixture>>, expectedRevision = 0) {
  const verified = await c.proof(), saved = await persistPetitionBaseValidation(verified, c.actor); assert.ok(saved.ok);
  return { requestId: randomUUID(), expectedRevision, validationId: saved.validationId, reviewedSha256: hash(bytes), expectedTextVersion: verified.binding.petitionTextVersion };
}

import {BATCH_PACKAGE_SCHEMA_SQL} from "./batch-package-schema";
import {prepareBatchPackage,readFrozenBatchPackage} from "./batch-package-store";
import {documentVersion,type ApprovalRow} from "./batches";
import {appendDocumentVersion} from "./batch-document-history";
async function packetFixture(name:string){
 const c=await fixture(name),chosen=await selectPetitionBase(await intent(c),c.actor);assert.ok(chosen.ok);
 const original=Buffer.from('%PDF-1.7 QA ORIGINAL PACKET fixture'),signed=Buffer.from('%PDF-1.7 QA SIGNED PACKET fixture -- protocol test, not real ICP');
 const batchId=(await c.db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,n_estrangeiro,list_hash,pdf,pdf_sha256,signed_pdf,signed_pdf_sha256,signature_kind)VALUES(1,'partial','prepared',0,1,0,'QA-PACK-LIST',$1,$2,$3,$4,'icp-brasil')RETURNING id",[original,hash(original),signed,hash(signed)])).rows[0].id as number;
 const version=await c.db.tx(client=>appendDocumentVersion(client,{batchId,variant:'signed',bytes:signed,sha256:hash(signed),listHash:'QA-PACK-LIST',signatureKind:'icp-brasil',note:null,source:'upload',authorId:1,recordedBy:1}));
 const row=(await c.db.query<ApprovalRow>('SELECT * FROM batches WHERE id=$1',[batchId])).rows[0];
 const input=()=>({batchId,requestId:randomUUID(),expectedDocumentVersion:documentVersion(row),expectedSelectionId:chosen.selection.selectionId,expectedPackageRevision:0});
 return{...c,original,signed,batchId,version,input};
}

test('packet preparation is disabled by default without opening a database',async()=>{
 const old=process.env.BATCH_PACKAGE_ENABLED;delete process.env.BATCH_PACKAGE_ENABLED;try{assert.deepEqual(await prepareBatchPackage({}as any,null),{ok:false,error:'disabled'});}finally{if(old!==undefined)process.env.BATCH_PACKAGE_ENABLED=old;}
});
test('one immutable packet captures both exact artifacts; replay does not approve or dispatch',async()=>{
 const c=await packetFixture('t_packet_replay');try{
  const input=c.input(),results=await Promise.all([prepareBatchPackage(input,c.actor),prepareBatchPackage(input,c.actor),prepareBatchPackage(input,c.actor)]);assert.ok(results.every(r=>r.ok));assert.equal(results.filter(r=>r.ok&&!r.replayed).length,1);
  const first=results[0];assert.ok(first.ok);for(const r of results){assert.ok(r.ok);assert.equal(r.package.packageId,first.package.packageId);assert.equal(r.package.createdAt,first.package.createdAt);assert.equal(r.package.dispatchAllowed,false);}
  const read=await readFrozenBatchPackage(first.package.packageId,c.actor);assert.ok(read.ok);assert.deepEqual(read.manifest.attachments.map(a=>a.role),['batch','petition-base']);assert.deepEqual(read.bytes.get(c.version.id),c.signed);assert.deepEqual(read.bytes.get(c.artifactId),bytes);
  read.bytes.get(c.artifactId)![10]^=1;const again=await readFrozenBatchPackage(first.package.packageId,c.actor);assert.ok(again.ok);assert.deepEqual(again.bytes.get(c.artifactId),bytes);
  assert.equal((await c.db.query('SELECT 1 FROM batch_packages')).rowCount,1);assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='batch_package_frozen'")).rowCount,1);assert.equal((await c.db.query('SELECT approved_at FROM batches WHERE id=$1',[c.batchId])).rows[0].approved_at,null);await c.noSend();
 }finally{await c.close();}
});
test('new explicit packet versions use CAS; old replay and history retain the original base',async()=>{
 const c=await packetFixture('t_packet_versions');try{
  const original=c.input(),first=await prepareBatchPackage(original,c.actor);assert.ok(first.ok);
  const nextBytes=Buffer.from('%PDF-1.7 QA DISTINCT BASE second exact artifact');
  const staged=await stagePetitionBase({requestId:randomUUID(),bytes:nextBytes},c.actor);assert.ok(staged.ok);
  const captured=await capturePetitionBaseValidationInput(staged.artifactId,c.actor);assert.ok(captured.ok);
  const report={protocol:'peticao-base-validation',version:1,valid:true,sha256:hash(nextBytes),method:'gov-br-advanced',signerCpf:cpf,certificateFingerprintSha256:'b'.repeat(64),integrity:true,govBrChainTrusted:true,coverage:'entire-file',modificationsAllowed:true,revocation:'good',profile:'QA-GOVBR-PROOF',validatedAt:new Date().toISOString(),validatorVersion:'qa-1'};
  const checked=await verifyPetitionBasePdf(captured.bytes,captured.binding,(async()=>new Response(JSON.stringify(report),{headers:{'content-type':'application/json'}}))as typeof fetch);assert.ok(checked.ok);
  const validated=await persistPetitionBaseValidation({binding:captured.binding,proof:checked.proof},c.actor);assert.ok(validated.ok);
  const selected=await selectPetitionBase({requestId:randomUUID(),expectedRevision:1,validationId:validated.validationId,reviewedSha256:hash(nextBytes),expectedTextVersion:captured.binding.petitionTextVersion},c.actor);assert.ok(selected.ok);
  const next={...original,requestId:randomUUID(),expectedSelectionId:selected.selection.selectionId,expectedPackageRevision:1},other={...next,requestId:randomUUID()};const results=await Promise.all([prepareBatchPackage(next,c.actor),prepareBatchPackage(other,c.actor)]);assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.filter(r=>!r.ok&&r.error==='revision_conflict').length,1);
  const winner=results.find(r=>r.ok);assert.ok(winner?.ok);const secondRead=await readFrozenBatchPackage(winner.package.packageId,c.actor);assert.ok(secondRead.ok);assert.deepEqual(secondRead.bytes.get(staged.artifactId),nextBytes);assert.notEqual(secondRead.package.packageDigest,first.package.packageDigest);
  const replay=await prepareBatchPackage(original,c.actor);assert.ok(replay.ok);assert.equal(replay.isCurrent,false);assert.equal(replay.package.ordinal,1);
  const read=await readFrozenBatchPackage(first.package.packageId,c.actor);assert.ok(read.ok);assert.equal(read.package.selectionId,original.expectedSelectionId);assert.deepEqual(read.bytes.get(c.artifactId),bytes);await c.noSend();
 }finally{await c.close();}
});
test('auth, stepup, source version and selected base cannot be forged',async()=>{
 const c=await packetFixture('t_packet_authority');try{
  for(const actor of [null,c.reader,{...c.actor,sessaoId:null}])assert.equal((await prepareBatchPackage(c.input(),actor)as any).error,'forbidden');
  assert.equal((await prepareBatchPackage({...c.input(),expectedDocumentVersion:'f'.repeat(64)},c.actor)as any).error,'document_conflict');assert.equal((await prepareBatchPackage({...c.input(),expectedSelectionId:randomUUID()},c.actor)as any).error,'selection_conflict');
  await c.db.query('UPDATE admin_sessions SET stepup_ate=NULL WHERE user_id=1');assert.equal((await prepareBatchPackage(c.input(),c.actor)as any).error,'forbidden');assert.equal((await c.db.query('SELECT 1 FROM batch_packages')).rowCount,0);await c.noSend();
 }finally{await c.close();}
});
test('approved, attempted or unhistoried signed bytes cannot create a new packet',async()=>{
 const c=await packetFixture('t_packet_source_freeze');try{
  await c.db.query("UPDATE batches SET approved_at='QA-APPROVED' WHERE id=$1",[c.batchId]);assert.equal((await prepareBatchPackage(c.input(),c.actor)as any).error,'document_conflict');await c.db.query('UPDATE batches SET approved_at=NULL WHERE id=$1',[c.batchId]);
  await c.db.query("INSERT INTO batch_sends(batch_id,recipient,ok,at)VALUES($1,'qa-only@example.test',false,'QA')",[c.batchId]);assert.equal((await prepareBatchPackage(c.input(),c.actor)as any).error,'delivery_started');await c.db.query('DELETE FROM batch_sends WHERE batch_id=$1',[c.batchId]);
  const changed=Buffer.from('%PDF-1.7 QA altered signed bytes without history');await c.db.query('UPDATE batches SET signed_pdf=$1,signed_pdf_sha256=$2 WHERE id=$3',[changed,hash(changed),c.batchId]);const row=(await c.db.query<ApprovalRow>('SELECT * FROM batches WHERE id=$1',[c.batchId])).rows[0];assert.equal((await prepareBatchPackage({...c.input(),expectedDocumentVersion:documentVersion(row)},c.actor)as any).error,'document_conflict');assert.equal((await c.db.query('SELECT 1 FROM batch_packages')).rowCount,0);
 }finally{await c.close();}
});
test('audit failure rolls back package; DDL replay and immutable fences preserve history',async()=>{
 const c=await packetFixture('t_packet_atomic');try{
  const input=c.input();await c.db.query("CREATE FUNCTION qa_packet_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='batch_package_frozen' THEN RAISE EXCEPTION 'QA package audit'; END IF; RETURN NEW; END $$;CREATE TRIGGER qa_packet_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_packet_fault()");await assert.rejects(prepareBatchPackage(input,c.actor),/QA package audit/);assert.equal((await c.db.query('SELECT 1 FROM batch_packages')).rowCount,0);await c.db.query('DROP TRIGGER qa_packet_fault ON audit_log');
  assert.ok((await prepareBatchPackage(input,c.actor)).ok);const snapshot=async()=>(await c.db.query('SELECT row_to_json(p)::text value FROM batch_packages p')).rows;const before=await snapshot();await c.db.query(BATCH_PACKAGE_SCHEMA_SQL);await c.db.query(BATCH_PACKAGE_SCHEMA_SQL);assert.deepEqual(await snapshot(),before);
  for(const sql of ['UPDATE batch_packages SET ordinal=ordinal','DELETE FROM batch_packages','TRUNCATE batch_packages CASCADE','TRUNCATE petition_base_artifacts CASCADE'])await assert.rejects(c.db.query(sql),/immutable/);assert.deepEqual(await snapshot(),before);await c.noSend();
 }finally{await c.close();}
});
test('historical read works with gates off but refuses a corrupted manifest and unauthorized actor',async()=>{
 const c=await packetFixture('t_packet_read');try{
  const prepared=await prepareBatchPackage(c.input(),c.actor);assert.ok(prepared.ok);process.env.BATCH_PACKAGE_ENABLED='0';process.env.GOVBR_BASE_ENABLED='0';assert.ok((await readFrozenBatchPackage(prepared.package.packageId,c.actor)).ok);assert.equal((await readFrozenBatchPackage(prepared.package.packageId,c.reader)as any).error,'forbidden');
  await c.db.query('DROP TRIGGER batch_packages_immutable ON batch_packages');await c.db.query("UPDATE batch_packages SET manifest='null' WHERE id=$1",[prepared.package.packageId]);assert.equal((await readFrozenBatchPackage(prepared.package.packageId,c.actor)as any).error,'integrity');await c.noSend();
 }finally{await c.close();}
});

test('attachment budget rejects the full pair without dropping a file or creating a packet',async()=>{
 const c=await packetFixture('t_packet_budget');try{
  process.env.BATCH_PACKAGE_MAX_ENCODED_BYTES='262145';assert.equal((await prepareBatchPackage(c.input(),c.actor)as any).error,'package_too_large');assert.equal((await c.db.query('SELECT 1 FROM batch_packages')).rowCount,0);await c.noSend();
 }finally{await c.close();}
});
test('expired base evidence requires revalidation while keeping the signed artifact unchanged',async t=>{
 const c=await packetFixture('t_packet_stale_evidence');try{
  const now=Date.now();t.mock.method(Date,'now',()=>now+301000);
  assert.equal((await prepareBatchPackage(c.input(),c.actor)as any).error,'validation_required');assert.equal((await c.db.query('SELECT 1 FROM batch_packages')).rowCount,0);assert.deepEqual((await c.db.query('SELECT bytes FROM petition_base_artifacts WHERE id=$1',[c.artifactId])).rows[0].bytes,bytes);await c.noSend();
 }finally{await c.close();}
});
