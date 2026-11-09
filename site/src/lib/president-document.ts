import { audit, tx } from "./db";
import { createHash } from "node:crypto";
import { authorizeBatchActor, type BatchActor } from "./batches";

export type PresidentDocument = {
  id: number; seq: number; kind: "partial" | "final"; status: string;
  n_servidor: number; n_apoiador: number; n_estrangeiro: number;
  list_hash: string; pdf_sha256: string | null; signed_pdf_sha256: string | null;
  signature_kind: string | null; signed_note: string | null; has_pdf: boolean; has_signed_pdf: boolean;
  approved_by: string | null; approved_at: string | null; sent_at: string | null; created_at: string;
  has_preparation: boolean;
};

const COLUMNS = `id,seq,kind,status,n_servidor,n_apoiador,n_estrangeiro,
  list_hash,pdf_sha256,signed_pdf_sha256,signature_kind,signed_note,
  pdf IS NOT NULL has_pdf,signed_pdf IS NOT NULL has_signed_pdf,
  approved_by,approved_at,sent_at,created_at,
  EXISTS(SELECT 1 FROM batch_preparations p WHERE p.batch_id=batches.id) has_preparation`;
/** Only stored document metadata, never a reconstruction from current signers or local CPF decisions. */
export async function presidentDocuments(actor: BatchActor, selection: { id?: number; before?: number } = {}) {
  if ([selection.id, selection.before].some(v => v !== undefined && (!Number.isInteger(v) || v <= 0 || v > 2147483647))) return { ok: false as const, error: "parameters" };
  return tx(async client => {
    await client.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='3000ms'");
    if (!(await authorizeBatchActor(client, actor))) return { ok: false as const, error: "forbidden" };
    const rows = (await client.query<PresidentDocument>(`SELECT ${COLUMNS} FROM batches WHERE ($1::int IS NULL OR seq<$1) ORDER BY seq DESC LIMIT 51`, [selection.before ?? null])).rows;
    const documents = rows.slice(0, 50);
    const final = (await client.query<PresidentDocument>(`SELECT ${COLUMNS} FROM batches WHERE kind='final' AND status<>'cancelled' ORDER BY seq DESC LIMIT 1`)).rows[0];
    const selected = selection.id === undefined ? final ?? documents[0] : (await client.query<PresidentDocument>(`SELECT ${COLUMNS} FROM batches WHERE id=$1`, [selection.id])).rows[0];
    return { ok: true as const, documents, selected: selected ?? null, finalId: final?.id ?? null, nextBefore: rows.length > 50 ? documents.at(-1)!.seq : null };
  });
}

export function documentActions(document: PresidentDocument) {
  const available = document.has_pdf && ["prepared", "failed"].includes(document.status);
  return { upload: available && !document.approved_at, cancel: available && !document.approved_at, approval: available && document.signature_kind === "icp-brasil" && (!document.approved_at || document.status === "failed") };
}

/** Exact stored bytes and a named read audit; does not regenerate or resign a document. */
export async function presidentDocumentBytes(id: number, signed: boolean, preview: boolean, actor: BatchActor) {
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) return { ok: false as const, error: "parameters" };
  return tx(async client => {
    await client.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='3000ms'");
    if (!(await authorizeBatchActor(client, actor))) return { ok: false as const, error: "forbidden" };
    const row = (await client.query<{ pdf: Buffer | null; seq: number }>(`SELECT ${signed ? "signed_pdf" : "pdf"} AS pdf,seq FROM batches WHERE id=$1 FOR SHARE`, [id])).rows[0];
    if (!row?.pdf) return { ok: false as const, error: "not_found" };
    await audit("batch_pdf_downloaded", null, { batchId: id, userId: actor.userId, por: actor.email.trim().toLowerCase(), signed, preview, sha256: createHash("sha256").update(row.pdf).digest("hex") }, client);
    return { ok: true as const, pdf: row.pdf, seq: row.seq };
  });
}
