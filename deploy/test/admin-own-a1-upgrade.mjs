import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const hash = value => createHash("sha256").update(value).digest("hex");

/** Real PG rehearsal extension, invoked inside the existing isolated migration schema.
 * Storage/rollback proof only: no real identity, certificate, credentials, provider or send.
 * newSql MUST include core + A1 + own-document + own-A1 bridge SQL, in that order. */
export async function rehearsePresidentOwnA1Upgrade({ client: c, newSql, oldSql, actorId, siteDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../site") }) {
  const url = new URL(process.env.DATABASE_URL ?? "postgres://invalid");
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.port === process.env.DEV_DB_PORT && url.port !== "5432" && url.pathname === "/peticao", "Isolated development PostgreSQL only");
  assert.ok(Number.isInteger(actorId) && actorId > 0 && typeof newSql === "string" && typeof oldSql === "string");
  assert.match(newSql, /president_own_a1_inputs/);
  assert.match(newSql, /president_own_document_artifacts/);
  const schema = (await c.query("SELECT current_schema() name")).rows[0].name;
  assert.match(schema, /^admin_upgrade_rehearsal_[a-z0-9_]+$/i, "Use the migration rehearsal schema, never public");
  const noSendSnapshot = async () => (await c.query("SELECT (SELECT count(*)::int FROM mail_messages) messages,(SELECT count(*)::int FROM mail_outbox) queued,(SELECT count(*)::int FROM batch_sends) batch_sends")).rows[0];
  const noSendBefore = await noSendSnapshot();
  const actor = (await c.query("SELECT id,nome FROM admin_users WHERE id=$1 AND nivel='total'", [actorId])).rows[0];assert.ok(actor);
  const require = createRequire(resolve(siteDir, "package.json"));
  const { PDFDocument, StandardFonts } = require("pdf-lib");
  const originalDoc = await PDFDocument.create();originalDoc.setCreationDate(new Date("2026-11-09T00:59:00Z"));originalDoc.setModificationDate(new Date("2026-11-09T00:59:00Z"));
  const font = await originalDoc.embedFont(StandardFonts.Helvetica);originalDoc.addPage([300, 400]).drawText("QA MIGRATION ORIGINAL - FICTITIOUS", { x: 12, y: 370, size: 10, font });
  const originalBytes = Buffer.from(await originalDoc.save());
  const ownDoc = await PDFDocument.load(originalBytes, { updateMetadata: false });ownDoc.addPage([300, 400]).drawText("QA OWN RECEIPT - NO REAL CERTIFICATE", { x: 12, y: 370, size: 10 });
  const ownBytes = Buffer.from(await ownDoc.save());
  const ids = Object.fromEntries(["challenge", "receipt", "request", "intent", "artifact", "original", "input", "job", "jobRequest", "authorization", "credential"].map(key => [key, randomUUID()]));
  const listHash = hash("QA-MIGRATION-EMPTY-FICTITIOUS-LIST"), originalHash = hash(originalBytes), ownHash = hash(ownBytes);
  const seq = (await c.query("SELECT COALESCE(MAX(seq),0)+1 n FROM batches")).rows[0].n;
  const batch = (await c.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,n_estrangeiro,list_hash,pdf,pdf_sha256,signature_kind,created_at)VALUES($1,'partial','prepared',0,0,0,$2,$3,$4,'none','2026-11-09T01:00:00.123456Z')RETURNING id", [seq, listHash, originalBytes, originalHash])).rows[0].id;
  // Same revision algorithm as presidentDocumentRevision; no access/signature is granted by it.
  const documentVersion = hash(JSON.stringify(["president-document:v1", batch, seq, "partial", listHash, originalHash, null, "none"]));
  const fingerprint = hash("QA-MIGRATION-NOT-A-REAL-ACCOUNT-FINGERPRINT");
  const snapshot = { version: 1, state: "consumed", method: "own-confirmation", receiptId: ids.receipt, challengeId: ids.challenge, batchId: batch, responsibleId: actorId, documentVersion, sourceSha256: originalHash, listHash, accountFingerprint: fingerprint, signerName: actor.nome, confirmedAt: "2026-11-09T01:01:00.654Z" };
  const canonical = JSON.stringify(snapshot), evidenceDigest = hash("president-own-confirmation:v1:" + canonical);
  await c.query(`INSERT INTO president_challenges(id,batch_id,responsible_id,issued_by,profile_revision,responsible_fingerprint,document_version,token_hash,password_hash,state,attempts,created_at,expires_at,receipt_id,confirmed_at)
    VALUES($1,$2,$3,$3,1,$4,$5,$6,$7,'consumed',1,'2026-11-09T01:00:00.123456Z','2026-11-09T01:10:00.123456Z',$8,'2026-11-09T01:01:00.654321Z')`, [ids.challenge, batch, actorId, fingerprint, documentVersion, hash("QA-MIGRATION-NO-TOKEN"), hash("QA-MIGRATION-NO-PASSWORD"), ids.receipt]);
  await c.query(`INSERT INTO president_own_document_intents(id,requested_by,request_id,request_digest,batch_id,receipt_id,document_version,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,'2026-11-09T01:01:01.123456Z')`, [ids.intent, actorId, ids.request, hash(JSON.stringify(["president-own-document-intent:v1", batch, ids.receipt, documentVersion])), batch, ids.receipt, documentVersion]);
  await c.query(`INSERT INTO president_own_document_artifacts(id,batch_id,challenge_id,receipt_id,document_version,source_sha256,evidence_digest,evidence_canonical,bytes,sha256,created_by,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'2026-11-09T01:01:02.654321Z')`, [ids.artifact, batch, ids.challenge, ids.receipt, documentVersion, originalHash, evidenceDigest, canonical, ownBytes, ownHash, actorId]);
  await c.query(`INSERT INTO president_own_document_results(intent_id,state,artifact_id,created_at)VALUES($1,'completed',$2,'2026-11-09T01:01:03.123456Z')`, [ids.intent, ids.artifact]);
  await c.query(`INSERT INTO batch_document_versions(id,batch_id,ordinal,variant,bytes,sha256,list_hash,signature_kind,note,source,author_id,recorded_by,captured_at)
    VALUES($1,$2,1,'original',$3,$4,$5,'none','QA-MIGRATION-ORIGINAL','prepared',$6,$6,'2026-11-09T01:00:00.123456Z'),
          ($7,$2,2,'signed',$8,$9,$5,'own-confirmation','QA-MIGRATION-OWN-CONFIRMATION','president-own',$6,$6,'2026-11-09T01:01:04.654321Z')`, [ids.original, batch, originalBytes, originalHash, listHash, actorId, ids.input, ownBytes, ownHash]);
  await c.query(`INSERT INTO president_own_a1_inputs(own_artifact_id,input_version_id,original_version_id,created_by,created_at)VALUES($1,$2,$3,$4,'2026-11-09T01:01:05.123456Z')`, [ids.artifact, ids.input, ids.original, actorId]);
  // A failed, synthetic job preserves the actual FK to the own input without being dispatchable.
  await c.query(`INSERT INTO batch_a1_jobs(id,batch_id,request_id,request_fingerprint,actor_id,actor_email,session_id,authorization_id,authorized_at,authorization_expires_at,input_artifact_version_id,input_sha256,input_byte_length,document_version,list_hash,batch_revision,credential_version_id,profile_version,trust_store_version,expected_cnpj,certificate_fingerprint_sha256,policy_revision,policy_fingerprint,state,revision,attempts,error_code,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,'qa-own-migration@example.test',1,$6,'2026-11-09T01:01:06.123456Z','2026-11-09T01:09:06.123456Z',$7,$8,$9,$10,$11,'QA-MIGRATION-BATCH-REVISION',$12,'QA-MIGRATION-NO-CREDENTIAL',$13,'15883671000115',$14,1,$15,'failed',2,1,'worker_unavailable','2026-11-09T01:01:06.123456Z','2026-11-09T01:01:07.654321Z')`, [ids.job, batch, ids.jobRequest, hash("QA-MIGRATION-JOB-INTENT"), actorId, ids.authorization, ids.input, ownHash, ownBytes.length, hash("QA-MIGRATION-COMBINED-VERSION"), listHash, ids.credential, hash("QA-MIGRATION-TRUST-STORE-NOT-REAL"), hash("QA-MIGRATION-CERTIFICATE-NOT-REAL"), hash("QA-MIGRATION-POLICY-NOT-REAL")]);
  const snapshotRows = async () => (await c.query(`
    SELECT 'batch' kind,row_to_json(t)::text raw FROM batches t WHERE id=$1
    UNION ALL SELECT 'challenge',row_to_json(t)::text FROM president_challenges t WHERE id=$2
    UNION ALL SELECT 'intent',row_to_json(t)::text FROM president_own_document_intents t WHERE id=$3
    UNION ALL SELECT 'artifact',row_to_json(t)::text FROM president_own_document_artifacts t WHERE id=$4
    UNION ALL SELECT 'result',row_to_json(t)::text FROM president_own_document_results t WHERE intent_id=$3
    UNION ALL SELECT 'version',row_to_json(t)::text FROM batch_document_versions t WHERE id IN ($5,$6)
    UNION ALL SELECT 'bridge',row_to_json(t)::text FROM president_own_a1_inputs t WHERE own_artifact_id=$4
    UNION ALL SELECT 'a1-job',row_to_json(t)::text FROM batch_a1_jobs t WHERE id=$7 ORDER BY kind,raw`, [batch, ids.challenge, ids.intent, ids.artifact, ids.original, ids.input, ids.job])).rows;
  const before = await snapshotRows();assert.equal(before.length, 9);
  assert.ok(before.some(row => row.raw.includes(".123456")) && before.some(row => row.raw.includes(".654321")), "Fixture must retain PostgreSQL microseconds, not JS Date projections");
  for (const sql of [newSql, newSql, oldSql, newSql, oldSql]) {
    await c.query(sql);assert.deepEqual(await snapshotRows(), before, "Own artifact/history/bridge/job bytes and identities must survive each new/old bootstrap replay");
  }
  const guard = (await c.query("SELECT convalidated,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='batch_document_versions'::regclass AND conname='batch_document_versions_source_check_v2'")).rows;
  assert.equal(guard.length, 1);assert.equal(guard[0].convalidated, true);assert.match(guard[0].definition, /president-own/);
  await assert.rejects(c.query("INSERT INTO batch_document_versions(id,batch_id,ordinal,variant,bytes,sha256,list_hash,signature_kind,source)VALUES($1,$2,3,'signed',$3,$4,$5,'own-confirmation','QA-FORBIDDEN-SOURCE')", [randomUUID(), batch, ownBytes, ownHash, listHash]), /source_check_v2|check constraint/);
  for (const statement of ["UPDATE president_own_a1_inputs SET created_by=created_by WHERE own_artifact_id=$1", "DELETE FROM president_own_a1_inputs WHERE own_artifact_id=$1"]) await assert.rejects(c.query(statement, [ids.artifact]), /immutable/);
  await assert.rejects(c.query("TRUNCATE president_own_a1_inputs"), /immutable/);
  await assert.rejects(c.query("INSERT INTO president_own_a1_inputs(own_artifact_id,input_version_id,original_version_id,created_by)VALUES($1,$2,$2,$3)", [ids.artifact, ids.original, actorId]), /provenance mismatch/);
  assert.deepEqual(await snapshotRows(), before, "Negative mutations must leave all stored evidence unchanged");
  const buffers = (await c.query("SELECT a.bytes own_bytes,a.sha256 own_sha,o.bytes original_bytes,o.sha256 original_sha,v.bytes input_bytes,j.input_artifact_version_id job_input FROM president_own_document_artifacts a JOIN president_own_a1_inputs b ON b.own_artifact_id=a.id JOIN batch_document_versions o ON o.id=b.original_version_id JOIN batch_document_versions v ON v.id=b.input_version_id JOIN batch_a1_jobs j ON j.input_artifact_version_id=v.id WHERE a.id=$1", [ids.artifact])).rows[0];
  assert.ok(buffers.own_bytes.equals(ownBytes) && buffers.original_bytes.equals(originalBytes) && buffers.input_bytes.equals(ownBytes));assert.equal(hash(buffers.own_bytes), ownHash);assert.equal(hash(buffers.original_bytes), originalHash);assert.equal(buffers.job_input, ids.input);
  assert.deepEqual(await noSendSnapshot(), noSendBefore, "Migration rehearsal must not enqueue or send messages");
  return { batchId: batch, ownArtifactId: ids.artifact, inputVersionId: ids.input, originalVersionId: ids.original, jobId: ids.job, snapshotRows: before.length, bootstrapReplays: 5, ownSourceV2Validated: true, immutableMutationsRejected: 3, mismatchedBridgeRejected: true, microsecondsPreserved: true, bytesPreserved: true, messageCountsPreserved: true, scope: "PostgreSQL migration/storage compatibility only; synthetic receipt/job, no identity or certificate homologation, no signing/sending" };
}
