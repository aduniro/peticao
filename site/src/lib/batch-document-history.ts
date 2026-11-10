import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { audit, tx } from "./db";
import { authorizeBatchActor, type BatchActor } from "./batches";

export type DocumentVariant = "original" | "signed";
export type DocumentCaptureSource = "prepared" | "upload" | "legacy-observed" | "a1-worker" | "president-own";
export type DocumentVersionInput = {
  batchId: number; variant: DocumentVariant; bytes: Buffer; sha256: string;
  listHash: string; signatureKind: string | null; note: string | null;
  source: DocumentCaptureSource; authorId: number | null; recordedBy: number | null;
};
export type DocumentVersionMetadata = {
  id: string; batch_id: number; ordinal: number; variant: DocumentVariant;
  sha256: string; list_hash: string; signature_kind: string | null; note: string | null;
  source: DocumentCaptureSource; author_id: number | null; recorded_by: number | null;
  captured_at: Date; byte_length: number;
};
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const validId = (id: number) => Number.isInteger(id) && id > 0 && id <= 2147483647;
const validVersionId = (id: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
const columns = "id,batch_id,ordinal,variant,sha256,list_hash,signature_kind,note,source,author_id,recorded_by,captured_at,octet_length(bytes) byte_length";

/** Caller transaction includes the document mutation and audit. Never rewrites an earlier row. */
export async function appendDocumentVersion(client: PoolClient, input: DocumentVersionInput) {
  if (!validId(input.batchId) || !["original", "signed"].includes(input.variant) || !["prepared", "upload", "legacy-observed", "a1-worker", "president-own"].includes(input.source) || !input.bytes.length || !/^[a-f0-9]{64}$/.test(input.sha256) || digest(input.bytes) !== input.sha256 || !input.listHash || [input.authorId, input.recordedBy].some(id => id !== null && !validId(id)) || input.source === "legacy-observed" && input.authorId !== null) throw new Error("invalid_document_version");
  // Lock even when called independently; serial ordinals cannot race with another capture.
  if (!(await client.query("SELECT 1 FROM batches WHERE id=$1 FOR UPDATE", [input.batchId])).rowCount) throw new Error("missing_document_batch");
  const ordinal = Number((await client.query("SELECT COALESCE(MAX(ordinal),0)+1 n FROM batch_document_versions WHERE batch_id=$1", [input.batchId])).rows[0].n);
  const id = randomUUID();
  await client.query("INSERT INTO batch_document_versions(id,batch_id,ordinal,variant,bytes,sha256,list_hash,signature_kind,note,source,author_id,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [id,input.batchId,ordinal,input.variant,input.bytes,input.sha256,input.listHash,input.signatureKind,input.note,input.source,input.authorId,input.recordedBy]);
  await audit("batch_document_version_recorded", null, { versionId:id,batchId:input.batchId,ordinal,variant:input.variant,sha256:input.sha256,source:input.source,authorId:input.authorId,recordedBy:input.recordedBy }, client);
  return { id, ordinal };
}

/** Capture only bytes still present now. Unknown old authors/times are never reconstructed. */
export async function preserveObservedDocument(client: PoolClient, input: Omit<DocumentVersionInput, "source" | "authorId">) {
  if (!(await client.query("SELECT 1 FROM batches WHERE id=$1 FOR UPDATE", [input.batchId])).rowCount) throw new Error("missing_document_batch");
  const existing = (await client.query<{ bytes: Buffer }>("SELECT bytes FROM batch_document_versions WHERE batch_id=$1 AND variant=$2 AND sha256=$3", [input.batchId,input.variant,input.sha256])).rows;
  if (existing.some(row => row.bytes.equals(input.bytes))) return;
  return appendDocumentVersion(client, { ...input, source:"legacy-observed", authorId:null });
}

export async function listDocumentVersions(batchId: number, actor: BatchActor, before?: number) {
  if (!validId(batchId) || before !== undefined && !validId(before)) return { ok:false as const, error:"parameters" as const };
  return tx(async client => {
    await client.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='5000ms'");
    if (!await authorizeBatchActor(client,actor)) return { ok:false as const, error:"forbidden" as const };
    const rows = (await client.query<DocumentVersionMetadata>(`SELECT ${columns} FROM batch_document_versions WHERE batch_id=$1 AND ($2::int IS NULL OR ordinal<$2) ORDER BY ordinal DESC LIMIT 51`, [batchId,before ?? null])).rows;
    await audit("batch_document_versions_listed",null,{batchId,userId:actor.userId,por:actor.email,before:before ?? null,count:Math.min(rows.length,50)},client);
    return { ok:true as const, versions:rows.slice(0,50), nextBefore:rows.length>50 ? rows[49].ordinal : null };
  });
}

export async function readDocumentVersion(batchId: number, versionId: string, actor: BatchActor) {
  if (!validId(batchId) || !validVersionId(versionId)) return { ok:false as const, error:"parameters" as const };
  return tx(async client => {
    await client.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='5000ms'");
    if (!await authorizeBatchActor(client,actor)) return { ok:false as const, error:"forbidden" as const };
    const row = (await client.query<DocumentVersionMetadata & {bytes:Buffer}>(`SELECT ${columns},bytes FROM batch_document_versions WHERE batch_id=$1 AND id=$2`, [batchId,versionId])).rows[0];
    if (!row) return { ok:false as const, error:"not_found" as const };
    if (digest(row.bytes) !== row.sha256) throw new Error("document_history_hash_mismatch");
    await audit("batch_document_version_downloaded",null,{batchId,versionId,userId:actor.userId,por:actor.email,sha256:row.sha256},client);
    const {bytes,...metadata}=row;
    return {ok:true as const,bytes,metadata};
  });
}
