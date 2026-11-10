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
const variables = ["APPROVER_EMAIL", "RECIPIENTS", "MAIL_OUTBOX_DIR", "MAIL_PROVIDER", "MAIL_ARCHIVE_RETENTION", "GOVBR_BASE_ENABLED", "GOVBR_BASE_VALIDATION_ENABLED", "GOVBR_BASE_VALIDATOR_URL", "GOVBR_BASE_VALIDATION_ACCEPTED_PROFILES", "GOVBR_BASE_VALIDATOR_TOKEN", "BATCH_PACKAGE_ENABLED", "BATCH_PACKAGE_MAX_ENCODED_BYTES"];
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

import {mkdtempSync,readdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {requestApprovalCode,approveAndSend} from "./batches";
import {inspectBatchAcceptance,reconcileBatchAcceptance} from "./batch-reconciliation";
import {resolveBatchDeliveryTx} from "./batch-delivery";
async function deliveryFixture(name:string){
 const c=await packetFixture(name),dir=mkdtempSync(join(tmpdir(),'qa-packet-delivery-'));
 process.env.MAIL_PROVIDER='dev';process.env.APPROVER_EMAIL='qa-owner@example.test';process.env.RECIPIENTS='qa-recipient@example.test';process.env.MAIL_OUTBOX_DIR=dir;process.env.MAIL_ARCHIVE_RETENTION='30';
 const packet=await prepareBatchPackage(c.input(),c.actor);assert.ok(packet.ok);
 const mails=()=>readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(join(dir,f),'utf8')));
 const code=async()=>{const before=new Set(readdirSync(dir));await requestApprovalCode(c.batchId,c.actor);const added=readdirSync(dir).filter(f=>!before.has(f));assert.equal(added.length,1);return JSON.parse(readFileSync(join(dir,added[0]),'utf8')).subject.match(/: (\d{6})$/)[1]as string;};
 const close=async()=>{await(await import('./mail')).waitForBackgroundMail();await c.close();rmSync(dir,{recursive:true,force:true});};
 return{...c,dir,packet:packet.package,mails,code,close};
}

test('v2 approval sends both exact immutable PDFs once; approval and key bind package',async()=>{
 const c=await deliveryFixture('t_packet_delivery_once');try{
  const code=await c.code(),results=await Promise.all([approveAndSend(c.batchId,code,c.actor.email,c.actor),approveAndSend(c.batchId,code,c.actor.email,c.actor)]);
  assert.equal(results.filter(r=>r.ok).length,1);const mailed=c.mails().filter(m=>m.attachments?.length);assert.equal(mailed.length,1);assert.deepEqual(mailed[0].attachments.map((a:any)=>a.sha256),[hash(c.signed),hash(bytes)]);
  const approved=JSON.parse((await c.db.query("SELECT data FROM audit_log WHERE event='batch_approved'")).rows[0].data);assert.equal(approved.deliveryVersion,2);assert.equal(approved.packageId,c.packet.packageId);assert.equal(approved.packageDigest,c.packet.packageDigest);
  const message=(await c.db.query("SELECT request_key FROM mail_messages WHERE kind='lote'")).rows[0];assert.equal(message.request_key,hmac('mail-request-v1:batch-send:v2:'+c.batchId+':'+c.packet.packageDigest+':'+hmac('qa-recipient@example.test')));
  const inspected=await inspectBatchAcceptance(c.batchId,c.actor);assert.ok(inspected.ok);assert.equal(inspected.recipients[0].state,'accepted');assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.close();}
});
test('replacing a packet invalidates the old code even when PDF bytes and digest are identical',async()=>{
 const c=await deliveryFixture('t_packet_delivery_replaced');try{
  const code=await c.code(),next=await prepareBatchPackage({...c.input(),expectedPackageRevision:1},c.actor);assert.ok(next.ok);assert.notEqual(next.package.packageId,c.packet.packageId);assert.equal(next.package.packageDigest,c.packet.packageDigest);
  assert.equal((await approveAndSend(c.batchId,code,c.actor.email,c.actor)).ok,false);assert.equal(c.mails().filter(m=>m.attachments?.length).length,0);assert.equal((await c.db.query('SELECT approved_at FROM batches')).rows[0].approved_at,null);
  const fresh=await c.code();assert.equal((await approveAndSend(c.batchId,fresh,c.actor.email,c.actor)).ok,true);
 }finally{await c.close();}
});
test('v2 gates, stepup and stale validation block approval without falling back to one attachment',async t=>{
 const c=await deliveryFixture('t_packet_delivery_guards');try{
  const code=await c.code();process.env.BATCH_PACKAGE_ENABLED='0';assert.equal((await approveAndSend(c.batchId,code,c.actor.email,c.actor)).ok,false);await assert.rejects(requestApprovalCode(c.batchId,c.actor),/não está pronto/);process.env.BATCH_PACKAGE_ENABLED='1';
  assert.equal((await approveAndSend(c.batchId,code,c.actor.email,{userId:1,email:c.actor.email})).ok,false);
  const now=Date.now();t.mock.method(Date,'now',()=>now+301000);assert.equal((await approveAndSend(c.batchId,code,c.actor.email,c.actor)).ok,false);assert.equal(c.mails().filter(m=>m.attachments?.length).length,0);assert.equal((await c.db.query('SELECT 1 FROM batch_sends')).rowCount,0);
 }finally{await c.close();}
});
test('partial v2 binding and changed attachments fail closed; legacy descriptor remains v1',async()=>{
 const c=await deliveryFixture('t_packet_delivery_binding');try{
  const row=(await c.db.query<ApprovalRow>('SELECT * FROM batches')).rows[0];
  for(const binding of [{deliveryVersion:2},{packageId:c.packet.packageId},{deliveryVersion:2,packageId:c.packet.packageId,packageDigest:'f'.repeat(64)},{deliveryVersion:3}])assert.equal(await c.db.tx(tx=>resolveBatchDeliveryTx(tx,row,binding)),null);
  const old=await c.db.tx(tx=>resolveBatchDeliveryTx(tx,row,{}));assert.ok(old);assert.equal(old.message('qa@example.test').envelope.attachments?.length,1);assert.match(old.message('qa@example.test').key,/^batch-send:v1:/);
  const corrupt={...row,signed_pdf:Buffer.from('%PDF-different bytes')};assert.equal(await c.db.tx(tx=>resolveBatchDeliveryTx(tx,corrupt,{deliveryVersion:2,packageId:c.packet.packageId,packageDigest:c.packet.packageDigest})),null);await c.noSend();
 }finally{await c.close();}
});
test('accepted v2 delivery reconciles after persistence failure with gates off, without another send',async()=>{
 const c=await deliveryFixture('t_packet_delivery_receipt');try{
  const code=await c.code();await c.db.query("CREATE FUNCTION qa_delivery_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='batch_recipient_result' THEN RAISE EXCEPTION 'QA receipt fault'; END IF; RETURN NEW; END $$;CREATE TRIGGER qa_delivery_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_delivery_fault()");
  await assert.rejects(approveAndSend(c.batchId,code,c.actor.email,c.actor),/QA receipt fault/);await c.db.query('DROP TRIGGER qa_delivery_fault ON audit_log');
  process.env.BATCH_PACKAGE_ENABLED='0';process.env.GOVBR_BASE_ENABLED='0';process.env.GOVBR_BASE_VALIDATION_ENABLED='0';
  const before=c.mails(),inspect=await inspectBatchAcceptance(c.batchId,c.actor);assert.ok(inspect.ok);assert.equal(inspect.recipients[0].state,'accepted');assert.equal((await c.db.query('SELECT 1 FROM batch_sends')).rowCount,0);
  const result=await reconcileBatchAcceptance(c.batchId,inspect.proof,c.actor);assert.ok(result.ok&&result.complete);assert.deepEqual(c.mails(),before);assert.equal((await c.db.query('SELECT ok FROM batch_sends')).rows[0].ok,true);
  assert.deepEqual(await reconcileBatchAcceptance(c.batchId,inspect.proof,c.actor),{ok:true,updated:0,complete:true});assert.deepEqual(c.mails(),before);
 }finally{await c.close();}
});
test('uncertain v2 transport never opens a new approval or automatic retry',async()=>{
 const c=await deliveryFixture('t_packet_delivery_uncertain');try{
  const code=await c.code(),blocked=join(c.dir,'not-a-directory');writeFileSync(blocked,'QA');process.env.MAIL_OUTBOX_DIR=blocked;
  assert.deepEqual(await approveAndSend(c.batchId,code,c.actor.email,c.actor),{ok:true,sent:0,failed:1});process.env.MAIL_OUTBOX_DIR=c.dir;
  await assert.rejects(requestApprovalCode(c.batchId,c.actor),/não está pronto/);const read=await inspectBatchAcceptance(c.batchId,c.actor);assert.ok(read.ok);assert.equal(read.recipients[0].state,'indeterminate');assert.equal(c.mails().filter(m=>m.attachments?.length).length,0);
  assert.deepEqual(await reconcileBatchAcceptance(c.batchId,read.proof,c.actor),{ok:true,updated:0,complete:false});
 }finally{await c.close();}
});

test('changing the selected base invalidates an unconsumed code until the package is reviewed again',async()=>{
 const c=await deliveryFixture('t_packet_selected_base_changed');try{
  const code=await c.code(),validated=await persistPetitionBaseValidation(await c.proof(),c.actor);assert.ok(validated.ok);
  const captured=await capturePetitionBaseValidationInput(c.artifactId,c.actor);assert.ok(captured.ok);
  const selected=await selectPetitionBase({requestId:randomUUID(),expectedRevision:1,validationId:validated.validationId,reviewedSha256:hash(bytes),expectedTextVersion:captured.binding.petitionTextVersion},c.actor);assert.ok(selected.ok);
  assert.equal((await approveAndSend(c.batchId,code,c.actor.email,c.actor)).ok,false);assert.equal(c.mails().filter(m=>m.attachments?.length).length,0);assert.equal((await c.db.query('SELECT approved_at FROM batches')).rows[0].approved_at,null);
  const next=await prepareBatchPackage({...c.input(),expectedSelectionId:selected.selection.selectionId,expectedPackageRevision:1},c.actor);assert.ok(next.ok);
  const fresh=await c.code();assert.equal((await approveAndSend(c.batchId,fresh,c.actor.email,c.actor)).ok,true);
 }finally{await c.close();}
});
