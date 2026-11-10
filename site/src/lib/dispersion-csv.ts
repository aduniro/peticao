import { createHash } from "node:crypto";
import { esc } from "./csv";
import { brasilia } from "./time";
import type { DispersionAllRow } from "./dispersion-admin-contract";

export const DISPERSION_CSV_HEADERS = ["id", "nome", "email", "categoria", "instituicao_declarada", "dominio_do_email", "instituicao_pelo_email", "selo_email", "verificacao_identidade", "situacao", "assinou_em_brasilia", "confirmou_em_brasilia", "origem", "codigo_de_origem", "quem_indicou", "geracao", "convidou", "convidou_e_confirmaram", "confirmou_no_mesmo_aparelho"] as const;
const CSV_BUDGET = 128 * 1024 * 1024;
/** Complete materialization before HTTP200. Unknown generation remains blank. */
export function buildDispersionCsv(rows: readonly DispersionAllRow[], expectedTotal: number) {
  if (!Number.isSafeInteger(expectedTotal) || expectedTotal < 0 || rows.length !== expectedTotal) throw new Error("incomplete_dispersion_csv");
  const parts: Buffer[] = [Buffer.from("\uFEFF" + DISPERSION_CSV_HEADERS.join(",") + "\n", "utf8")];
  const ids = new Set<number>(); let bytes = parts[0].length;
  for (const r of rows) {
    if (ids.has(r.id)) throw new Error("duplicate_dispersion_csv_id"); ids.add(r.id);
    const line = [r.id, r.name, r.email, r.category, r.institution, r.emailDomain, r.emailInstitution, r.emailDomainKind, r.identityMethod,
      r.status === "confirmed" ? "confirmada" : "aguardando confirmação", brasilia(r.consentAt), brasilia(r.confirmedAt),
      r.origin === "pessoal" ? "indicacao_pessoal" : r.origin, r.refCode,
      r.origin === "pessoal" ? r.parentName : r.orgLabel, r.generation, r.invited, r.invitedConfirmed,
      r.confirmSameVisitor === null ? "" : r.confirmSameVisitor ? "sim" : "nao"].map(esc).join(",");
    const part = Buffer.from(line + "\n", "utf8"); bytes += part.length;
    if (bytes > CSV_BUDGET) throw new Error("dispersion_csv_budget"); parts.push(part);
  }
  const body = Buffer.concat(parts, bytes);
  if (body.length !== bytes || ids.size !== expectedTotal) throw new Error("incomplete_dispersion_csv");
  return { body, bytes, rows: expectedTotal, sha256: createHash("sha256").update(body).digest("hex") };
}
