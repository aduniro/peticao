import type { PoolClient } from "pg";
import { appendDocumentVersion } from "./batch-document-history";
import type { ApprovalRow } from "./batches";
import { ownArtifactConsistent, ownHash, type OwnArtifactRecord } from "./president-own-document-contract";
import { presidentDocumentRevision } from "./president-portal-contract";
import { frozenOwnA1InputMatches, selectOwnAwareA1Input } from "./president-own-a1-contract";

type Current = { batch: ApprovalRow; original: { id: string; bytes: Buffer; sha256: string }; version: string };
type History = { id: string; batch_id: number; bytes: Buffer; sha256: string; list_hash: string; source: string; variant: string; signature_kind: string | null };
const selectorNonce = "00000000-0000-4000-8000-000000000001";

/** Metadata only; no inference from latest signed. Missing own provenance fails closed. */
export async function a1OwnArtifactIdTx(c: PoolClient, versionId: string): Promise<string | null> {
  const history = (await c.query<{ source: string }>("SELECT source FROM batch_document_versions WHERE id=$1", [versionId])).rows[0];
  if (history?.source !== "president-own") return null;
  const bridge = (await c.query<{ own_artifact_id: string }>("SELECT own_artifact_id FROM president_own_a1_inputs WHERE input_version_id=$1", [versionId])).rows[0];
  if (!bridge) throw new Error("missing_president_own_a1_provenance");
  return bridge.own_artifact_id;
}
async function artifact(c: PoolClient, id: string) {
  const row = (await c.query<OwnArtifactRecord>("SELECT * FROM president_own_document_artifacts WHERE id=$1 FOR SHARE", [id])).rows[0];
  return row && ownArtifactConsistent(row) ? row : null;
}
/** Caller holds advisory7003, actor/session/policy admission and the batch lock. */
async function currentOwn(c: PoolClient, doc: Current, own: OwnArtifactRecord) {
  const snapshot = JSON.parse(own.evidence_canonical);
  const challenge = (await c.query("SELECT * FROM president_challenges WHERE id=$1 AND batch_id=$2 AND receipt_id=$3 FOR SHARE", [own.challenge_id, own.batch_id, own.receipt_id])).rows[0];
  if (!challenge || challenge.state !== "consumed" || challenge.document_version !== own.document_version || challenge.responsible_id !== snapshot.responsibleId || challenge.responsible_fingerprint !== snapshot.accountFingerprint || !(challenge.confirmed_at instanceof Date) || !(challenge.created_at instanceof Date) || !(challenge.expires_at instanceof Date) || challenge.confirmed_at < challenge.created_at || challenge.confirmed_at >= challenge.expires_at || challenge.confirmed_at.getTime() > Date.now() + 30_000 || challenge.confirmed_at.toISOString() !== snapshot.confirmedAt) return null;
  if (!(await c.query("SELECT 1 FROM admin_users WHERE id=$1 AND ativo AND nivel='total' FOR SHARE", [challenge.issued_by])).rowCount) return null;
  const setting = (await c.query("SELECT value FROM settings WHERE key='president_profile_v1' FOR SHARE")).rows[0];
  let p; try { p = JSON.parse(setting?.value); } catch { return null; }
  if (!p || p.version !== 1 || p.enabled !== true || typeof p.cpfHash !== "string" || !/^[a-f0-9]{64}$/.test(p.cpfHash) || p.responsibleId !== challenge.responsible_id || p.revision !== challenge.profile_revision) return null;
  const user = (await c.query("SELECT id,nome,email FROM admin_users WHERE id=$1 AND ativo FOR SHARE", [p.responsibleId])).rows[0];
  if (!user || user.nome !== snapshot.signerName || ownHash(JSON.stringify([p.revision, p.responsibleId, p.cpfHash, user.nome, user.email])) !== challenge.responsible_fingerprint) return null;
  const b = doc.batch;
  const presidentVersion = presidentDocumentRevision({ batchId: b.id, seq: b.seq, kind: b.kind, listHash: b.list_hash, originalPdf: b.pdf!, signedPdf: b.signed_pdf, signatureKind: b.signature_kind });
  const selected = selectOwnAwareA1Input({ batchId: b.id, requestId: selectorNonce, expectedDocumentVersion: doc.version, expectedPolicyRevision: 1, expectedOwnArtifactId: own.id }, { batchId: b.id, a1DocumentVersion: doc.version, presidentDocumentVersion: presidentVersion, listHash: b.list_hash, originalVersionId: doc.original.id, originalSha256: doc.original.sha256, originalBytes: doc.original.bytes, hasSignedPdf: !!b.signed_pdf, signatureKind: b.signature_kind }, own);
  return selected.ok ? selected.input : null;
}

/** Availability only: consumed receipt/profile/source CAS, without freezing history or creating a job. */
export async function ownA1InputAvailableTx(c: PoolClient, doc: Current, ownArtifactId: string) {
  const own = await artifact(c, ownArtifactId);
  return !!own && !!await currentOwn(c, doc, own);
}

/** Append exact existing bytes once in the caller's admission transaction; never updates batches. */
export async function freezeOwnA1InputTx(c: PoolClient, doc: Current, ownArtifactId: string, actorId: number) {
  const own = await artifact(c, ownArtifactId); if (!own) return null;
  const selected = await currentOwn(c, doc, own); if (!selected) return null;
  const bridge = (await c.query<{ input_version_id: string; original_version_id: string }>("SELECT input_version_id,original_version_id FROM president_own_a1_inputs WHERE own_artifact_id=$1 FOR SHARE", [own.id])).rows[0];
  if (bridge) {
    const h = (await c.query<History>("SELECT * FROM batch_document_versions WHERE id=$1 FOR SHARE", [bridge.input_version_id])).rows[0];
    return h && frozenOwnA1InputMatches(selected, { ...h, ownArtifactId: own.id, originalVersionId: bridge.original_version_id }) ? { id: h.id, bytes: Buffer.from(h.bytes), sha256: h.sha256 } : null;
  }
  const snapshot = JSON.parse(own.evidence_canonical);
  const version = await appendDocumentVersion(c, { batchId: doc.batch.id, variant: "signed", bytes: selected.bytes, sha256: selected.sha256, listHash: selected.listHash, signatureKind: "own-confirmation", note: null, source: "president-own", authorId: snapshot.responsibleId, recordedBy: actorId });
  await c.query("INSERT INTO president_own_a1_inputs(own_artifact_id,input_version_id,original_version_id,created_by) VALUES($1,$2,$3,$4)", [own.id, version.id, doc.original.id, actorId]);
  return { id: version.id, bytes: Buffer.from(selected.bytes), sha256: selected.sha256 };
}
/** Nonterminal claim/finish: requires current receipt/profile/base in addition to frozen provenance. */
export async function readOwnA1InputTx(c: PoolClient, doc: Current, inputVersionId: string) {
  const ownId = await a1OwnArtifactIdTx(c, inputVersionId); if (!ownId) return null;
  const own = await artifact(c, ownId); if (!own) return null;
  const selected = await currentOwn(c, doc, own); if (!selected) return null;
  const bridge = (await c.query<{ original_version_id: string }>("SELECT original_version_id FROM president_own_a1_inputs WHERE input_version_id=$1 AND own_artifact_id=$2 FOR SHARE", [inputVersionId, ownId])).rows[0];
  const h = (await c.query<History>("SELECT * FROM batch_document_versions WHERE id=$1 FOR SHARE", [inputVersionId])).rows[0];
  return bridge && h && frozenOwnA1InputMatches(selected, { ...h, ownArtifactId: own.id, originalVersionId: bridge.original_version_id }) ? { id: h.id, bytes: Buffer.from(h.bytes), sha256: h.sha256 } : null;
}
/** Committed success recovery: immutable provenance survives the A1-induced batch version change. */
export async function historicalOwnA1InputTx(c: PoolClient, inputVersionId: string) {
  const ownId = await a1OwnArtifactIdTx(c, inputVersionId); if (!ownId) return null;
  const own = await artifact(c, ownId); if (!own) return null;
  const bridge = (await c.query<{ original_version_id: string }>("SELECT original_version_id FROM president_own_a1_inputs WHERE input_version_id=$1 FOR SHARE", [inputVersionId])).rows[0];
  const h = (await c.query<History>("SELECT * FROM batch_document_versions WHERE id=$1 FOR SHARE", [inputVersionId])).rows[0];
  const original = bridge && (await c.query<History>("SELECT * FROM batch_document_versions WHERE id=$1 FOR SHARE", [bridge.original_version_id])).rows[0];
  if (!h || !original || original.batch_id !== own.batch_id || original.variant !== "original" || original.source !== "prepared" || original.sha256 !== own.source_sha256 || !Buffer.isBuffer(original.bytes) || ownHash(original.bytes) !== original.sha256) return null;
  const snapshot = JSON.parse(own.evidence_canonical);
  const selected = { batchId: own.batch_id, kind: "president-own" as const, bytes: own.bytes, sha256: own.sha256, byteLength: own.bytes.length, originalVersionId: original.id, ownArtifactId: own.id, listHash: snapshot.listHash, a1DocumentVersion: "0".repeat(64), requiresTransactionalAdmission: true as const, signingAuthorized: false as const };
  return original.list_hash === snapshot.listHash && frozenOwnA1InputMatches(selected, { ...h, ownArtifactId: own.id, originalVersionId: original.id }) ? { id: h.id, bytes: Buffer.from(h.bytes), sha256: h.sha256 } : null;
}
