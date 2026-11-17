import { createHash } from "node:crypto";
import { esc } from "./csv";
import { brasilia } from "./time";
import type { PendingEmailRow, PendingEmailState } from "./pending-email-admin-contract";
export const PENDING_EMAIL_CSV_HEADERS = ["id", "nome", "email", "categoria", "instituicao", "solicitada_em_brasilia", "dominio", "ultimo_sinal_registrado", "sinal_registrado_em_brasilia", "provedor_do_sinal", "fonte_do_sinal", "escopo_da_evidencia", "vinculo_da_evidencia", "aceite_registrado_em_brasilia", "entrega_registrada_em_brasilia", "abertura_registrada_em_brasilia", "clique_registrado_em_brasilia", "tipo_adverso_registrado", "evento_adverso_em_brasilia", "provedor_adverso", "detalhe_adverso", "agregado_legado_retem_primeiro_horario", "suprimido", "motivo_supressao", "na_fila", "fontes_da_fila", "possui_registro_de_aceite", "possui_evento_adverso", "ultima_mensagem_registrada_status", "ultima_mensagem_registrada_criada_em_brasilia", "sugestao_local", "motivo_sugestao", "fonte_sugestao", "observacao_sugestao"] as const;
const STATE: Record<PendingEmailState, string> = { clicked: "clique registrado", opened: "abertura registrada", delivered: "entrega registrada", adverse: "evento adverso registrado", accepted: "aceite registrado pelo provedor", unrecorded: "sem registro" };
const yes = (value: boolean) => value ? "sim" : "nao";
/** One pending registration per row. Address history is not proof about its current confirmation message. */
export function buildPendingEmailCsv(rows: readonly PendingEmailRow[], expectedTotal: number) {
  if (!Number.isSafeInteger(expectedTotal) || expectedTotal < 0 || rows.length !== expectedTotal) throw new Error("incomplete_pending_export");
  const parts = [Buffer.from("\uFEFF" + PENDING_EMAIL_CSV_HEADERS.map(esc).join(","), "utf8")], ids = new Set<number>();
  let bytes = parts[0].length;
  for (const r of rows) {
    if (!Number.isInteger(r.id) || r.id < 1 || r.id > 2147483647 || ids.has(r.id)) throw new Error("invalid_pending_export_id"); ids.add(r.id);
    const e = r.evidence, signal = e.lastSignal, adverse = e.lastAdverse, message = e.latestConfirmationMessage;
    const values = [r.id, r.name, r.email, r.category, r.instituicao, brasilia(r.criada), r.dominio, STATE[r.state], brasilia(signal?.at), signal?.provider, signal?.source,
      e.scope, e.registrationLink, brasilia(e.lastAcceptedAt), brasilia(e.deliveredAt), brasilia(e.openedAt), brasilia(e.clickedAt), adverse?.type, brasilia(adverse?.at), adverse?.provider, adverse?.reason,
      yes(e.legacyEngagementFirstOnly), yes(r.suppressed), r.suppressionReason, yes(r.queued), r.queueSources.join(";"), yes(r.hasAcceptance), yes(r.hasAdverse), message?.status, brasilia(message?.createdAt),
      r.sugestao, r.motivoSugestao, r.suggestionSource, r.suggestionSource === "local_catalog" ? "heurística local; MX não verificado" : ""];
    if (values.length !== PENDING_EMAIL_CSV_HEADERS.length) throw new Error("invalid_pending_export_columns");
    const part = Buffer.from("\r\n" + values.map(esc).join(","), "utf8"); bytes += part.length;
    if (bytes > 128 * 1024 * 1024) throw new Error("pending_export_budget"); parts.push(part);
  }
  const body = Buffer.concat(parts, bytes);
  if (ids.size !== expectedTotal || body.length !== bytes) throw new Error("incomplete_pending_export");
  return { body, bytes, rows: expectedTotal, sha256: createHash("sha256").update(body).digest("hex") };
}
