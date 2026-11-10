import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { audit, tx } from "./db";
import { authorizeBatchActor } from "./batches";
import type { SessaoAdmin } from "./admin-users";
import { capturePresidentOwnConfirmation } from "./president-portal-store";
import { presidentDocumentRevision } from "./president-portal-contract";
import { freezeOwnConfirmation } from "./president-native-contract";
import { renderPresidentConfirmation } from "./president-native-pdf";
import { generateOwnDocument, ownArtifactConsistent, ownHash, ownRequestDigest, ownUuid, type CapturedOwn, type OwnDocumentMetadata, type OwnDocumentRequest, type OwnFailure } from "./president-own-document-contract";

const fail = (error: OwnFailure["error"]): OwnFailure => ({ ok: false, error });
async function admission(c: PoolClient, actor: SessaoAdmin | null) {
  await c.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='5000ms'");
  await c.query("SELECT pg_advisory_xact_lock(7003)");
  return !!actor?.sessaoId && await authorizeBatchActor(c, actor) && !!(await c.query("SELECT 1 FROM admin_sessions WHERE id=$1 AND user_id=$2 AND expira_em>now() AND stepup_ate>now() FOR SHARE", [actor.sessaoId, actor.userId])).rowCount;
}
async function metadata(c: PoolClient, intentId: string): Promise<OwnDocumentMetadata> {
  const r = (await c.query("SELECT i.request_id,i.batch_id,i.receipt_id,i.document_version,i.created_at,r.state,r.failure_kind,a.id AS artifact_id,a.sha256,a.source_sha256 FROM president_own_document_intents i LEFT JOIN president_own_document_results r ON r.intent_id=i.id LEFT JOIN president_own_document_artifacts a ON a.id=r.artifact_id WHERE i.id=$1", [intentId])).rows[0];
  if (!r) throw new Error("own_intent_missing");
  return { source: "president-own", dispatchAllowed: false, icpBrasil: false, govBr: false, requestId: r.request_id, state: r.state ?? "pending", artifactId: r.artifact_id ?? null, batchId: r.batch_id, receiptId: r.receipt_id, documentVersion: r.document_version, sha256: r.sha256 ?? null, sourceSha256: r.source_sha256 ?? null, error: r.failure_kind ?? null, createdAt: r.created_at.toISOString() };
}

/** Dedicated final CAS helper. Uses existing private-store semantics, no private helper exports. */
async function revalidateOwnDocumentTx(c: PoolClient, capture: CapturedOwn) {
  const s = capture.snapshot;
  const challenge = (await c.query("SELECT * FROM president_challenges WHERE id=$1 AND batch_id=$2 AND receipt_id=$3 FOR SHARE", [s.challengeId, s.batchId, s.receiptId])).rows[0];
  if (!challenge || challenge.state !== "consumed" || !(challenge.confirmed_at instanceof Date) || !(challenge.created_at instanceof Date) || !(challenge.expires_at instanceof Date) || challenge.confirmed_at < challenge.created_at || challenge.confirmed_at >= challenge.expires_at || challenge.confirmed_at.getTime() > Date.now() + 30_000 || challenge.document_version !== s.documentVersion) return false;
  if (!(await c.query("SELECT 1 FROM admin_users WHERE id=$1 AND ativo AND nivel='total' FOR SHARE", [challenge.issued_by])).rowCount) return false;
  const setting = (await c.query("SELECT value FROM settings WHERE key='president_profile_v1' FOR SHARE")).rows[0];
  let profile;
  try { profile = JSON.parse(setting?.value); } catch { return false; }
  if (!profile || profile.version !== 1 || profile.enabled !== true || typeof profile.cpfHash !== "string" || !/^[a-f0-9]{64}$/.test(profile.cpfHash) || profile.responsibleId !== challenge.responsible_id || profile.revision !== challenge.profile_revision) return false;
  const user = (await c.query("SELECT id,nome,email FROM admin_users WHERE id=$1 AND ativo FOR SHARE", [profile.responsibleId])).rows[0];
  if (!user || ownHash(JSON.stringify([profile.revision, profile.responsibleId, profile.cpfHash, user.nome, user.email])) !== challenge.responsible_fingerprint) return false;
  const b = (await c.query("SELECT id,seq,kind,list_hash,pdf,pdf_sha256,signed_pdf,signature_kind FROM batches WHERE id=$1 AND status IN ('prepared','failed') AND approved_at IS NULL FOR SHARE", [s.batchId])).rows[0];
  if (!b || !Buffer.isBuffer(b.pdf) || b.signed_pdf || ![null, "", "none"].includes(b.signature_kind) || ownHash(b.pdf) !== b.pdf_sha256) return false;
  const revision = presidentDocumentRevision({ batchId: b.id, seq: b.seq, kind: b.kind, listHash: b.list_hash, originalPdf: b.pdf, signedPdf: null, signatureKind: b.signature_kind });
  if (revision !== s.documentVersion) return false;
  const current = freezeOwnConfirmation({ version: 1, state: "consumed", method: "own-confirmation", receiptId: challenge.receipt_id, challengeId: challenge.id, batchId: b.id, responsibleId: challenge.responsible_id, documentVersion: revision, sourceSha256: ownHash(b.pdf), listHash: b.list_hash, accountFingerprint: challenge.responsible_fingerprint, signerName: user.nome, confirmedAt: challenge.confirmed_at.toISOString() }, b.pdf);
  return current.ok && current.canonical === capture.canonical && current.evidenceDigest === capture.evidenceDigest && ownHash(capture.bytes) === current.snapshot.sourceSha256;
}

/** Separate immutable artifact; no mutation of source batch or signed bytes. */
export async function createPresidentOwnDocument(input: unknown, actor: SessaoAdmin | null) {
  try {
    return await generateOwnDocument(input, {
      reserve: async r => tx(async c => {
        if (!await admission(c, actor)) return fail("forbidden");
        const prior = (await c.query("SELECT id,request_digest FROM president_own_document_intents WHERE requested_by=$1 AND request_id=$2 FOR SHARE", [actor!.userId, r.requestId])).rows[0];
        if (prior) return prior.request_digest === ownRequestDigest(r) ? { ok: true as const, existing: true as const, document: await metadata(c, prior.id) } : fail("conflict");
        const intentId = randomUUID();
        await c.query("INSERT INTO president_own_document_intents(id,requested_by,request_id,request_digest,batch_id,receipt_id,document_version) VALUES($1,$2,$3,$4,$5,$6,$7)", [intentId, actor!.userId, r.requestId, ownRequestDigest(r), r.batchId, r.receiptId, r.expectedDocumentVersion]);
        await audit("president_own_document_reserved", null, { intentId, requestId: r.requestId, batchId: r.batchId, userId: actor!.userId }, c);
        return { ok: true as const, existing: false as const, intentId };
      }),
      capture: async r => {
        const captured = await capturePresidentOwnConfirmation({ batchId: r.batchId, receiptId: r.receiptId, expectedDocumentVersion: r.expectedDocumentVersion }, actor);
        return captured.ok ? captured : null;
      },
      render: capture => renderPresidentConfirmation(capture.bytes, capture.snapshot),
      fail: async (intentId, reason) => { await tx(async c => {
        if (!await admission(c, actor)) return;
        const intent = (await c.query("SELECT id FROM president_own_document_intents WHERE id=$1 AND requested_by=$2 FOR SHARE", [intentId, actor!.userId])).rows[0];
        if (!intent) return;
        await c.query("INSERT INTO president_own_document_results(intent_id,state,failure_kind) VALUES($1,'failed',$2) ON CONFLICT(intent_id) DO NOTHING", [intentId, reason]);
        await audit("president_own_document_failed", null, { intentId, reason, userId: actor!.userId }, c);
      }); },
      complete: async (r, intentId, capture, bytes) => tx(async c => {
        if (!await admission(c, actor)) return fail("forbidden");
        const intent = (await c.query("SELECT * FROM president_own_document_intents WHERE id=$1 AND requested_by=$2 FOR SHARE", [intentId, actor!.userId])).rows[0];
        if (!intent || intent.request_digest !== ownRequestDigest(r) || capture.snapshot.batchId !== r.batchId || capture.snapshot.receiptId !== r.receiptId || capture.snapshot.documentVersion !== r.expectedDocumentVersion) return fail("conflict");
        if ((await c.query("SELECT 1 FROM president_own_document_results WHERE intent_id=$1", [intentId])).rowCount) return { ok: true as const, document: await metadata(c, intentId) };
        if (!await revalidateOwnDocumentTx(c, capture)) {
          await c.query("INSERT INTO president_own_document_results(intent_id,state,failure_kind) VALUES($1,'failed','context_changed')", [intentId]);
          await audit("president_own_document_context_changed", null, { intentId, batchId: r.batchId, userId: actor!.userId }, c);
          return fail("conflict");
        }
        const s = capture.snapshot;
        const prior = (await c.query("SELECT * FROM president_own_document_artifacts WHERE batch_id=$1 AND receipt_id=$2 AND document_version=$3 AND evidence_digest=$4 FOR SHARE", [s.batchId, s.receiptId, s.documentVersion, capture.evidenceDigest])).rows[0];
        const artifactId = prior?.id ?? randomUUID();
        // A second explicit intent may recover the same immutable receipt artifact.
        if (prior && (!ownArtifactConsistent(prior) || prior.evidence_canonical !== capture.canonical)) throw new Error("own_artifact_corrupt");
        if (!prior) await c.query("INSERT INTO president_own_document_artifacts(id,batch_id,challenge_id,receipt_id,document_version,source_sha256,evidence_digest,evidence_canonical,bytes,sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [artifactId, s.batchId, s.challengeId, s.receiptId, s.documentVersion, s.sourceSha256, capture.evidenceDigest, capture.canonical, bytes, ownHash(bytes), actor!.userId]);
        await c.query("INSERT INTO president_own_document_results(intent_id,state,artifact_id) VALUES($1,'completed',$2)", [intentId, artifactId]);
        await audit("president_own_document_created", null, { intentId, artifactId, batchId: s.batchId, source: "president-own", evidenceDigest: capture.evidenceDigest, userId: actor!.userId }, c);
        return { ok: true as const, document: await metadata(c, intentId) };
      }),
    });
  } catch { return fail("unavailable"); }
}

export async function readPresidentOwnDocumentRequest(requestId: string, actor: SessaoAdmin | null) {
  if (!ownUuid(requestId)) return fail("parameters");
  try { return await tx(async c => {
    if (!await admission(c, actor)) return fail("forbidden");
    const intent = (await c.query("SELECT id FROM president_own_document_intents WHERE requested_by=$1 AND request_id=$2 FOR SHARE", [actor!.userId, requestId])).rows[0];
    if (!intent) return fail("not_found");
    await audit("president_own_document_request_read", null, { requestId, userId: actor!.userId }, c);
    return { ok: true as const, document: await metadata(c, intent.id) };
  }); } catch { return fail("unavailable"); }
}

/** Historical download remains readable after source/profile changes, under current Total+stepup. */
export async function readPresidentOwnDocumentPdf(id: string, actor: SessaoAdmin | null) {
  if (!ownUuid(id)) return fail("parameters");
  try { return await tx(async c => {
    if (!await admission(c, actor)) return fail("forbidden");
    const row = (await c.query("SELECT * FROM president_own_document_artifacts WHERE id=$1 AND source='president-own' FOR SHARE", [id])).rows[0];
    if (!row) return fail("not_found");
    if (!ownArtifactConsistent(row)) return fail("unavailable");
    await audit("president_own_document_downloaded", null, { artifactId: id, batchId: row.batch_id, sha256: row.sha256, userId: actor!.userId }, c);
    return { ok: true as const, bytes: Buffer.from(row.bytes), sha256: row.sha256 as string, sourceSha256: row.source_sha256 as string, artifactId: id };
  }); } catch { return fail("unavailable"); }
}
