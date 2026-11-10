import { createHash } from "node:crypto";
import { esc } from "@/lib/csv";
import { brasilia } from "@/lib/time";
import type { MailDeliveryRow } from "./mail-delivery-admin-contract";

export const MAIL_DELIVERY_CSV_HEADERS = ["email", "nome", "categoria", "instituicao", "cargo", "campus", "universidade", "cidade_uf", "pais", "cadastro", "cadastrado_em", "confirmado_em", "whatsapp", "situacao_do_email", "envios", "ultimo_envio", "ultimo_tipo", "provedores", "entregue_em", "aberto_em", "clicou_em", "devolucao", "motivo_da_devolucao", "devolucao_em"] as const;

/** Twenty-four existing columns. Registration IDs may share an email; distinct recordKey defines coverage. */
export function buildMailDeliveryCsv(rows: readonly MailDeliveryRow[], expectedTotal: number) {
  if (!Number.isSafeInteger(expectedTotal) || expectedTotal < 0 || rows.length !== expectedTotal) throw new Error("incomplete_delivery_export");
  const parts = [Buffer.from("\uFEFF" + MAIL_DELIVERY_CSV_HEADERS.join(","), "utf8")], keys = new Set<string>();
  let bytes = parts[0].length;
  for (const row of rows) {
    const key = row.rowKind === "registration" && Number.isInteger(row.cadastroId) && row.cadastroId! > 0 && row.cadastroId! <= 2147483647 ? `registration:${row.cadastroId}` : row.rowKind === "unregistered_address" && row.cadastroId === null ? `unregistered:${row.email}` : null;
    if (key === null || row.recordKey !== key || keys.has(key)) throw new Error("invalid_delivery_export_key"); keys.add(key);
    if (row.evidence.contactState === "unavailable") throw new Error("delivery_export_contact_unavailable");
    const t = (v: string) => v ? brasilia(v) : "";
    const cells = [row.email, row.nome, row.categoria, row.instituicao, row.cargo, row.campus, row.universidade, row.cidadeUf, row.pais, row.cadastro, t(row.cadastradoEm), t(row.confirmadoEm), row.whatsapp,
      row.situacao, row.envios, t(row.ultimoEnvio), row.ultimoTipo, row.provedores, t(row.entregueEm), t(row.abertoEm), t(row.clicouEm), row.devolucao, row.devolucaoMotivo, t(row.devolucaoEm)];
    if (cells.length !== MAIL_DELIVERY_CSV_HEADERS.length) throw new Error("invalid_delivery_export_columns");
    const part = Buffer.from("\n" + cells.map(esc).join(","), "utf8"); bytes += part.length;
    if (bytes > 128 * 1024 * 1024) throw new Error("delivery_csv_budget"); parts.push(part);
  }
  const body = Buffer.concat(parts, bytes);
  if (keys.size !== expectedTotal || body.length !== bytes) throw new Error("incomplete_delivery_export");
  return { body, bytes, rows: expectedTotal, sha256: createHash("sha256").update(body).digest("hex") };
}
