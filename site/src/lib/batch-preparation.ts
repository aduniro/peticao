import { createHash } from "node:crypto";
import { PETICAO, TEXT_VERSION } from "@/content/peticao";
import type { ListRow, PdfMeta } from "./pdf";
import type { BatchActor } from "./batches";

export type CreationSource = { kind: "scheduler" } | { kind: "admin"; actor: BatchActor };
export type PreparationSnapshot = {
  version: 1;
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
export function freezePreparation(rows: ListRow[], meta: PdfMeta, source: CreationSource) {
  const snapshot = JSON.stringify({ version: 1, renderer, rows, meta, source, signerMode: process.env.SIGNER ?? "none" } satisfies PreparationSnapshot);
  return { snapshot, sha256: digest(snapshot) };
}

/** Only a matching frozen list/template can resume; never reconstruct from current signers. */
export function thawPreparation(snapshot: string, sha256: string, batch: { seq: number; kind: string; list_hash: string; n_servidor: number; n_apoiador: number; n_estrangeiro: number }): PreparationSnapshot | null {
  if (digest(snapshot) !== sha256) return null;
  try {
    const value = JSON.parse(snapshot) as PreparationSnapshot;
    if (value.version !== 1 || value.renderer !== renderer || !Array.isArray(value.rows) || !value.rows.length || value.signerMode !== (process.env.SIGNER ?? "none")) return null;
    const m = value.meta;
    if (!m || m.seq !== batch.seq || m.kind !== batch.kind || m.listHash !== batch.list_hash || digest(JSON.stringify(value.rows)) !== batch.list_hash ||
      m.nServidor !== batch.n_servidor || m.nApoiador !== batch.n_apoiador || (m.nEstrangeiro ?? 0) !== batch.n_estrangeiro || !Number.isFinite(Date.parse(m.generatedAt))) return null;
    if (value.rows.filter(r => r.category === "servidor").length !== batch.n_servidor || value.rows.filter(r => r.category === "apoiador").length !== batch.n_apoiador || value.rows.filter(r => r.category === "estrangeiro").length !== batch.n_estrangeiro || value.rows.length !== batch.n_servidor + batch.n_apoiador + batch.n_estrangeiro) return null;
    if (!value.source || !["admin", "scheduler"].includes(value.source.kind)) return null;
    if (value.source.kind === "admin" && (!Number.isInteger(value.source.actor?.userId) || value.source.actor.userId <= 0 || typeof value.source.actor.email !== "string")) return null;
    return value;
  } catch { return null; }
}
