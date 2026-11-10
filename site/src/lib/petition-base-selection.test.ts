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
const variables = ["GOVBR_BASE_ENABLED", "GOVBR_BASE_VALIDATION_ENABLED", "GOVBR_BASE_VALIDATOR_URL", "GOVBR_BASE_VALIDATION_ACCEPTED_PROFILES", "GOVBR_BASE_VALIDATOR_TOKEN"];
async function fixture(name: string) {
  const db = await import("./db"); await db._openForTests(name); await db.query(PETITION_BASE_SCHEMA_SQL);
  await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash)VALUES(1,'qa-base-proof@example.test','QA Total','total','NOT-A-PASSWORD'),(2,'qa-base-reader@example.test','QA Reader','leitura','NOT-A-PASSWORD')");
  const U = await import("./admin-users");
  const session = await U.abrirSessao(1, "127.0.0.1"), readerSession = await U.abrirSessao(2, "127.0.0.1"); await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes'");
  const actor = (await U.sessaoPorToken(session.token))!, reader = (await U.sessaoPorToken(readerSession.token))!;
  const original = Object.fromEntries(variables.map(n => [n, process.env[n]]));
  process.env.GOVBR_BASE_ENABLED = "1"; process.env.GOVBR_BASE_VALIDATION_ENABLED = "1"; process.env.GOVBR_BASE_VALIDATOR_URL = "http://127.0.0.1:1/validate"; process.env.GOVBR_BASE_VALIDATION_ACCEPTED_PROFILES = '["QA-GOVBR-PROOF"]'; process.env.GOVBR_BASE_VALIDATOR_TOKEN = "QA-BASE-ONLY";
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

test("explicit selection preserves exact base, author and review; concurrent replay creates one revision and audit", async () => {
 const c = await fixture("t_base_selection_replay"); try {
  const input = await intent(c), results = await Promise.all([selectPetitionBase(input,c.actor),selectPetitionBase(input,c.actor),selectPetitionBase(input,c.actor)]);
  assert.ok(results.every(r=>r.ok));assert.equal(results.filter(r=>r.ok&&!r.replayed).length,1);
  const first=results[0];assert.ok(first.ok);assert.equal(first.selection.revision,1);assert.equal(first.selection.usableInPackage,false);
  for(const r of results){assert.ok(r.ok);assert.equal(r.selection.selectionId,first.selection.selectionId);assert.equal(r.selection.createdAt,first.selection.createdAt);assert.equal(r.selection.createdBy,1);}
  assert.equal((await c.db.query("SELECT 1 FROM petition_base_selections")).rowCount,1);assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='petition_base_selected'")).rowCount,1);
  const current=await currentPetitionBaseSelection(c.actor);assert.ok(current.ok&&current.selection);assert.equal(current.currentBindingMatches,true);await c.noSend();
 }finally{await c.close();}
});
test("CAS blocks lost updates; replaying an earlier decision never reselects it", async () => {
 const c=await fixture("t_base_selection_cas");try{
  const original=await intent(c), first=await selectPetitionBase(original,c.actor);assert.ok(first.ok);
  const next={...original,requestId:randomUUID(),expectedRevision:1},other={...next,requestId:randomUUID()};const results=await Promise.all([selectPetitionBase(next,c.actor),selectPetitionBase(other,c.actor)]);
  assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.filter(r=>!r.ok&&r.error==='revision_conflict').length,1);
  const replay=await selectPetitionBase(original,c.actor);assert.ok(replay.ok);assert.equal(replay.isCurrent,false);assert.equal(replay.selection.revision,1);
  const current=await currentPetitionBaseSelection(c.actor);assert.ok(current.ok&&current.selection);assert.equal(current.selection.revision,2);
  assert.equal((await selectPetitionBase({...original,reviewedSha256:'c'.repeat(64)},c.actor)as any).error,'request_conflict');
 }finally{await c.close();}
});
test("current Total and stepup, exact review hash, text and profile are required", async()=>{
 const c=await fixture('t_base_selection_auth');try{
  const input=await intent(c);
  for(const actor of [null,c.reader,{...c.actor,sessaoId:null}])assert.equal((await selectPetitionBase(input,actor)as any).error,'forbidden');
  assert.equal((await selectPetitionBase({...input,reviewedSha256:'c'.repeat(64)},c.actor)as any).error,'validation_unavailable');
  assert.equal((await selectPetitionBase({...input,expectedTextVersion:'c'.repeat(64)},c.actor)as any).error,'profile_conflict');
  await c.db.query("UPDATE admin_sessions SET stepup_ate=NULL WHERE user_id=1");assert.equal((await selectPetitionBase(input,c.actor)as any).error,'forbidden');await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes'");
  await c.db.query("UPDATE settings SET value=$1 WHERE key='president_profile_v1'",[JSON.stringify({...c.profile,revision:2})]);assert.equal((await selectPetitionBase(input,c.actor)as any).error,'profile_conflict');
  assert.equal((await c.db.query('SELECT 1 FROM petition_base_selections')).rowCount,0);await c.noSend();
 }finally{await c.close();}
});
test("a changed verifier or a legacy receipt lacking policy identity cannot elect a base",async()=>{
 const c=await fixture('t_base_selection_policy');try{
  const input=await intent(c);process.env.GOVBR_BASE_VALIDATOR_TOKEN='QA-ROTATED';assert.equal((await selectPetitionBase(input,c.actor)as any).error,'validation_unavailable');process.env.GOVBR_BASE_VALIDATOR_TOKEN='QA-BASE-ONLY';
  const legacy=randomUUID();await c.db.query("INSERT INTO petition_base_validations(id,artifact_id,artifact_sha256,petition_text_version,responsible_id,profile_revision,signer_cpf_hash,binding_sha256,report_sha256,report,created_by) SELECT $1,artifact_id,artifact_sha256,petition_text_version,responsible_id,profile_revision,signer_cpf_hash,binding_sha256,$2,report,created_by FROM petition_base_validations WHERE id=$3",[legacy,'e'.repeat(64),input.validationId]);
  assert.equal((await selectPetitionBase({...input,validationId:legacy},c.actor)as any).error,'validation_unavailable');assert.equal((await c.db.query('SELECT 1 FROM petition_base_selections')).rowCount,0);
 }finally{await c.close();}
});
test("audit failure rolls back selection; immutable DDL preserves the successful decision",async()=>{
 const c=await fixture('t_base_selection_atomic');try{
  const input=await intent(c);await c.db.query("CREATE FUNCTION qa_select_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='petition_base_selected' THEN RAISE EXCEPTION 'QA select audit'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_select_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_select_fault()");
  await assert.rejects(selectPetitionBase(input,c.actor),/QA select audit/);assert.equal((await c.db.query('SELECT 1 FROM petition_base_selections')).rowCount,0);await c.db.query('DROP TRIGGER qa_select_fault ON audit_log');
  assert.ok((await selectPetitionBase(input,c.actor)).ok);const rows=async()=>(await c.db.query('SELECT row_to_json(s)::text value FROM petition_base_selections s ORDER BY revision')).rows;const before=await rows();await c.db.query(PETITION_BASE_SCHEMA_SQL);await c.db.query(PETITION_BASE_SCHEMA_SQL);assert.deepEqual(await rows(),before);
  for(const sql of ['UPDATE petition_base_selections SET revision=revision','DELETE FROM petition_base_selections','TRUNCATE petition_base_selections','TRUNCATE petition_base_validations CASCADE'])await assert.rejects(c.db.query(sql),/immutable/);
  assert.deepEqual(await rows(),before);await c.noSend();
 }finally{await c.close();}
});
test("metadata remains readable with verification off, without creating a new decision",async()=>{
 const c=await fixture('t_base_selection_read');try{
  assert.ok((await selectPetitionBase(await intent(c),c.actor)).ok);delete process.env.GOVBR_BASE_VALIDATION_ENABLED;
  const current=await currentPetitionBaseSelection(c.actor);assert.ok(current.ok&&current.selection);assert.equal(current.currentBindingMatches,false);
  assert.equal((await currentPetitionBaseSelection(c.reader)as any).error,'forbidden');assert.equal((await c.db.query('SELECT 1 FROM petition_base_selections')).rowCount,1);await c.noSend();
 }finally{await c.close();}
});

test("a changed CPF hash cannot be reported as a matching profile even with the same revision",async()=>{
 const c=await fixture('t_base_selection_cpf');try{
  assert.ok((await selectPetitionBase(await intent(c),c.actor)).ok);
  await c.db.query("UPDATE settings SET value=$1 WHERE key='president_profile_v1'",[JSON.stringify({...c.profile,cpfHash:hmac('president-cpf:v1:11144477735')})]);
  const current=await currentPetitionBaseSelection(c.actor);assert.ok(current.ok&&current.selection);assert.equal(current.currentBindingMatches,false);
 }finally{await c.close();}
});
test("disabling the feature while authorization is waiting prevents selection",async()=>{
 const c=await fixture('t_base_selection_disable');try{
  const input=await intent(c);let signalLocked!:()=>void,release!:()=>void;
  const locked=new Promise<void>(r=>signalLocked=r),gate=new Promise<void>(r=>release=r);
  const blocker=c.db.tx(async client=>{await client.query('SELECT pg_advisory_xact_lock(7003)');signalLocked();await gate;});await locked;
  const pending=selectPetitionBase(input,c.actor);process.env.GOVBR_BASE_ENABLED='0';release();await blocker;
  assert.equal((await pending as any).error,'disabled');assert.equal((await c.db.query('SELECT 1 FROM petition_base_selections')).rowCount,0);
 }finally{await c.close();}
});
test("selection foreign keys and sequence constraints reject cross-file receipts and a NULL predecessor",async()=>{
 const c=await fixture('t_base_selection_constraints');try{
  assert.ok((await selectPetitionBase(await intent(c),c.actor)).ok);const row=(await c.db.query('SELECT * FROM petition_base_selections')).rows[0];
  for(const entry of [{sha:'c'.repeat(64),previous:1,code:'23503'},{sha:row.artifact_sha256,previous:null,code:'23514'}])await assert.rejects(c.db.query(`INSERT INTO petition_base_selections(id,revision,previous_revision,validation_id,artifact_id,artifact_sha256,petition_text_version,responsible_id,profile_revision,validator_configuration_sha256,request_id,request_fingerprint,actor_id)VALUES($1,2,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[randomUUID(),entry.previous,row.validation_id,row.artifact_id,entry.sha,row.petition_text_version,row.responsible_id,row.profile_revision,row.validator_configuration_sha256,randomUUID(),'f'.repeat(64),1]),(error:unknown)=>(error as{code?:string}).code===entry.code);
  assert.equal((await c.db.query('SELECT 1 FROM petition_base_selections')).rowCount,1);
 }finally{await c.close();}
});
