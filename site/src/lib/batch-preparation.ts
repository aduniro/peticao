import { createHash } from "node:crypto";
import { PETICAO, TEXT_VERSION } from "@/content/peticao";
import type { ListRow, PdfMeta as LegacyPdfMeta } from "./pdf";
import { documentReferenceUrl } from "./document-reference-contract";
export type PdfMeta = LegacyPdfMeta & { documentReference?: { id: string; url: string }; signaturePreparation?: "a1" };
import type { BatchActor } from "./batches";

export type CreationSource = { kind: "scheduler" } | { kind: "admin"; actor: BatchActor };
export type PreparationSnapshot = {
  version: 1 | 2;
  renderer: string;
  rows: ListRow[];
  meta: PdfMeta;
  source: CreationSource;
  signerMode: string;
};
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
// Bump the renderer version when changing the PDF layout/assets contract. Old
// pending snapshots then fail closed rather than silently using a new renderer.
const renderer = digest(JSON.stringify(["batch-pdf-v1", TEXT_VERSION, PETICAO]));
const referenceRenderer = digest(JSON.stringify(["batch-pdf-v2-reference-a1", TEXT_VERSION, PETICAO]));
function validReference(value: unknown): boolean {
  if (!value || typeof value !== "object" || Object.keys(value).sort().join(",") !== "id,url") return false;
  const r = value as { id: string; url: string };
  try { return documentReferenceUrl(new URL(r.url).origin, r.id) === r.url; } catch { return false; }
}
export function freezePreparation(rows: ListRow[], meta: PdfMeta, source: CreationSource) {
  const withReference = meta.documentReference !== undefined;
  const a1 = meta.signaturePreparation === "a1";
  if (meta.signaturePreparation !== undefined && !a1 || a1 && meta.signedNote !== "") throw new Error("invalid_snapshot_signing_preparation");
  const modern = withReference || a1;
  if (withReference && !validReference(meta.documentReference)) throw new Error("invalid_snapshot_document_reference");
  const snapshot = JSON.stringify({ version: modern ? 2 : 1, renderer: modern ? referenceRenderer : renderer, rows, meta, source, signerMode: process.env.SIGNER ?? "none" } satisfies PreparationSnapshot);
  return { snapshot, sha256: digest(snapshot) };
}

/** Only a matching frozen list/template can resume; never reconstruct from current signers. */
export function thawPreparation(snapshot: string, sha256: string, batch: { seq: number; kind: string; list_hash: string; n_servidor: number; n_apoiador: number; n_estrangeiro: number }): PreparationSnapshot | null {
  if (digest(snapshot) !== sha256) return null;
  try {
    const value = JSON.parse(snapshot) as PreparationSnapshot;
    if (![1, 2].includes(value.version) || value.renderer !== (value.version === 2 ? referenceRenderer : renderer) || !Array.isArray(value.rows) || !value.rows.length || value.signerMode !== (process.env.SIGNER ?? "none")) return null;
    const m = value.meta;
    if (!m) return null;
    const a1 = m.signaturePreparation === "a1";
    if (m.signaturePreparation !== undefined && !a1 || a1 && m.signedNote !== "") return null;
    if (value.version === 1 ? m.documentReference !== undefined || a1 : !a1 && m.documentReference === undefined) return null;
    if (m.documentReference !== undefined && !validReference(m.documentReference)) return null;
    if (!m || m.seq !== batch.seq || m.kind !== batch.kind || m.listHash !== batch.list_hash || digest(JSON.stringify(value.rows)) !== batch.list_hash ||
      m.nServidor !== batch.n_servidor || m.nApoiador !== batch.n_apoiador || (m.nEstrangeiro ?? 0) !== batch.n_estrangeiro || !Number.isFinite(Date.parse(m.generatedAt))) return null;
    if (value.rows.filter(r => r.category === "servidor").length !== batch.n_servidor || value.rows.filter(r => r.category === "apoiador").length !== batch.n_apoiador || value.rows.filter(r => r.category === "estrangeiro").length !== batch.n_estrangeiro || value.rows.length !== batch.n_servidor + batch.n_apoiador + batch.n_estrangeiro) return null;
    if (!value.source || !["admin", "scheduler"].includes(value.source.kind)) return null;
    if (value.source.kind === "admin" && (!Number.isInteger(value.source.actor?.userId) || value.source.actor.userId <= 0 || typeof value.source.actor.email !== "string")) return null;
    return value;
  } catch { return null; }
}
