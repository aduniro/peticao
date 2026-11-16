import type { Batch } from "./batches";
import { batchId } from "./batch-http-input";

/** Selection is presentation only; every mutation keeps its existing server authorization. */
export function selectedBatch(batches: readonly Batch[], value: unknown): Batch | null {
  if (typeof value !== "string") return null;
  const id = batchId(value);
  return id === null ? null : batches.find(batch => batch.id === id) ?? null;
}

export function batchStatusLabel(status: string): string {
  switch (status) {
    case "prepared": return "Preparado";
    case "failed": return "Falha";
    case "sent": return "Enviado";
    case "cancelled": return "Cancelado";
    default: return "Estado não reconhecido";
  }
}

export function batchSignatureLabel(kind: string | null): string {
  return kind === "icp-brasil" ? "ICP-Brasil" : kind === "externa-nao-validada" ? "Assinado, NÃO validado" : "NÃO ASSINADO (teste)";
}

export const batchDetailsHref = (id: number) => `/admin/lotes?lote=${id}#lote-acoes`;

export const batchCountLabel = (value: number | null | undefined): string => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("pt-BR") : "—";

export const hasSignedBatchPdf = (batch: Pick<Batch, "signature_kind">) => !!batch.signature_kind && batch.signature_kind !== "none";
