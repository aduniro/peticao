import type { ApproveResult } from "./batches";
export const BATCH_REVIEW_MESSAGE = "Resultado do envio a conferir. Verifique o histórico antes de tentar outra ação.";

/** AV17 explicitly approved on 08/11; counts and the existing success wording remain. */
export function batchResultSummary(result: ApproveResult): string {
  if (!result.ok) return result.reason;
  return `Enviado a ${result.sent} destinatário(s)` + (result.failed
    ? `; ${result.failed} falha(s). ${BATCH_REVIEW_MESSAGE}`
    : ".");
}
