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
test("validation capture and persistence remain disabled by default without touching a database", async () => {
  const old = process.env.GOVBR_BASE_ENABLED; delete process.env.GOVBR_BASE_ENABLED;
  try { assert.deepEqual(await capturePetitionBaseValidationInput(randomUUID(), null), { ok: false, error: "disabled" }); assert.deepEqual(await persistPetitionBaseValidation({} as any, null), { ok: false, error: "disabled" }); } finally { if (old !== undefined) process.env.GOVBR_BASE_ENABLED = old; }
});
test("exact internal capability is persisted once with immutable authorship and no raw CPF or send", async () => {
  const c = await fixture("t_base_proof_replay"); try {
    const input = await c.proof(); const results = await Promise.all([persistPetitionBaseValidation(input, c.actor), persistPetitionBaseValidation(input, c.actor), persistPetitionBaseValidation(input, c.actor)]);
    assert.ok(results.every(r => r.ok)); assert.equal(results.filter(r => r.ok && !r.replayed).length, 1);
    const first = results[0]; assert.ok(first.ok); for (const r of results) { assert.ok(r.ok); assert.equal(r.validationId, first.validationId); assert.equal(r.createdAt, first.createdAt); assert.equal(r.createdBy, 1); assert.equal(r.usableInPackage, false); }
    assert.equal((await c.db.query("SELECT 1 FROM petition_base_validations")).rowCount, 1); assert.equal((await c.db.query("SELECT 1 FROM audit_log WHERE event='petition_base_validated'")).rowCount, 1);
    const reports = JSON.stringify((await c.db.query("SELECT report FROM petition_base_validations")).rows); assert.ok(!reports.includes(cpf)); assert.ok(!reports.includes('"signerCpf":')); assert.ok((await c.db.verifyAuditChain()).ok); await c.noSend();
  } finally { await c.close(); }
});
test("session, live role and extra confirmation are rechecked after the external check", async () => {
  const c = await fixture("t_base_proof_auth"); try {
    const input = await c.proof();
    for (const actor of [null, c.reader, { ...c.actor, sessaoId: null }]) assert.equal((await persistPetitionBaseValidation(input, actor) as any).error, "forbidden");
    await c.db.query("UPDATE admin_sessions SET stepup_ate=NULL WHERE user_id=1"); assert.equal((await persistPetitionBaseValidation(input, c.actor) as any).error, "forbidden");
    await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes'"); await c.db.query("UPDATE admin_users SET nivel='leitura' WHERE id=1"); assert.equal((await persistPetitionBaseValidation(input, c.actor) as any).error, "forbidden");
    assert.equal((await c.db.query("SELECT 1 FROM petition_base_validations")).rowCount, 0); await c.noSend();
  } finally { await c.close(); }
});
test("profile, text, artifact and verifier changes cannot persist an outdated capability", async () => {
  const c = await fixture("t_base_proof_bindings"); try {
    const input = await c.proof();
    assert.equal((await persistPetitionBaseValidation({ ...input, proof: JSON.parse(JSON.stringify(input.proof)) }, c.actor) as any).error, "invalid_proof");
    assert.equal((await persistPetitionBaseValidation({ ...input, binding: { ...input.binding, petitionTextVersion: "c".repeat(64) } }, c.actor) as any).error, "profile_conflict");
    const second = await stagePetitionBase({ requestId: randomUUID(), bytes }, c.actor); assert.ok(second.ok);
    assert.equal((await persistPetitionBaseValidation({ ...input, binding: { ...input.binding, artifactId: second.artifactId } }, c.actor) as any).error, "invalid_proof");
    process.env.GOVBR_BASE_VALIDATOR_TOKEN = "QA-ROTATED"; assert.equal((await persistPetitionBaseValidation(input, c.actor) as any).error, "invalid_proof"); process.env.GOVBR_BASE_VALIDATOR_TOKEN = "QA-BASE-ONLY";
    await c.db.query("UPDATE settings SET value=$1 WHERE key='president_profile_v1'", [JSON.stringify({ ...c.profile, revision: 2 })]); assert.equal((await persistPetitionBaseValidation(input, c.actor) as any).error, "profile_conflict");
    assert.equal((await c.db.query("SELECT 1 FROM petition_base_validations")).rowCount, 0);
  } finally { await c.close(); }
});
test("audit failure rolls back verifier evidence while preserving the uploaded artifact", async () => {
  const c = await fixture("t_base_proof_rollback"); try {
    const input = await c.proof(); await c.db.query("CREATE FUNCTION qa_base_proof_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='petition_base_validated' THEN RAISE EXCEPTION 'QA base proof audit'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_base_proof_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_base_proof_fault()");
    await assert.rejects(persistPetitionBaseValidation(input, c.actor), /QA base proof audit/); assert.equal((await c.db.query("SELECT 1 FROM petition_base_validations")).rowCount, 0); assert.equal((await c.db.query("SELECT 1 FROM petition_base_artifacts")).rowCount, 1); await c.noSend();
  } finally { await c.close(); }
});
test("DDL replay and immutable fences preserve validation bytes, hashes, authors and dates", async () => {
  const c = await fixture("t_base_proof_immutable"); try {
    const input = await c.proof(); assert.ok((await persistPetitionBaseValidation(input, c.actor)).ok);
    const rows = async () => (await c.db.query("SELECT row_to_json(v)::text value FROM petition_base_validations v ORDER BY id")).rows; const before = await rows();
    await c.db.query(PETITION_BASE_SCHEMA_SQL); await c.db.query(PETITION_BASE_SCHEMA_SQL); assert.deepEqual(await rows(), before);
    for (const sql of ["UPDATE petition_base_validations SET report=report", "DELETE FROM petition_base_validations", "TRUNCATE petition_base_validations", "TRUNCATE petition_base_artifacts CASCADE"]) await assert.rejects(c.db.query(sql), /immutable/);
    assert.deepEqual(await rows(), before);
  } finally { await c.close(); }
});

test("database constraints reject a foreign artifact hash and incomplete or misclassified verifier evidence", async () => {
  const c = await fixture("t_base_proof_constraints"); try {
    const input = await c.proof(); assert.ok((await persistPetitionBaseValidation(input, c.actor)).ok);
    const row = (await c.db.query("SELECT * FROM petition_base_validations")).rows[0];
    const missing = { ...row.report }; delete missing.protocol;
    const cases = [
      { sha: "c".repeat(64), report: { ...row.report, sha256: "c".repeat(64) }, code: "23503" },
      { sha: row.artifact_sha256, report: missing, code: "23514" },
      { sha: row.artifact_sha256, report: { ...row.report, valid: "true" }, code: "23514" },
      { sha: row.artifact_sha256, report: { ...row.report, method: "icp-brasil" }, code: "23514" },
      { sha: row.artifact_sha256, report: { ...row.report, signerCpf: cpf }, code: "23514" },
    ];
    for (const item of cases) await assert.rejects(c.db.query(`INSERT INTO petition_base_validations(id,artifact_id,artifact_sha256,petition_text_version,responsible_id,profile_revision,signer_cpf_hash,binding_sha256,report_sha256,report,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`, [randomUUID(), row.artifact_id, item.sha, row.petition_text_version, row.responsible_id, row.profile_revision, row.signer_cpf_hash, row.binding_sha256, "d".repeat(64), JSON.stringify(item.report), 1]), (error: unknown) => (error as { code?: string }).code === item.code);
    assert.equal((await c.db.query("SELECT 1 FROM petition_base_validations")).rowCount, 1);
  } finally { await c.close(); }
});
