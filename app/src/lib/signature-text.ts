import { brasilia } from "./time";

/** Data e hora de Brasília separadas: "03/11/2026" e "14:32:10". */
export function brasiliaParts(iso: string | Date | null | undefined): { date: string; time: string } {
  const s = brasilia(iso);
  const [date = "", time = ""] = s.split(" ");
  return { date, time };
}

/**
 * Frase de assinatura eletrônica de cada apoiador (no PDF e na página de verificação). Só afirma "verificação do CPF" quando o nome informado
 * conferiu com o cadastro do CPF; nos demais casos diz apenas que o e-mail foi confirmado (nunca alega o que não foi verificado).
 */
export function statementLine(row: { category: string; cpf_name_check: string | null; confirmed_at: string | Date | null }): string {
  const { date, time } = brasiliaParts(row.confirmed_at);
  const base = `Assinado eletronicamente no dia ${date} às ${time} do horário de Brasília`;
  if (row.cpf_name_check === "match") return `${base}, com verificação de autenticidade do número de CPF.`;
  if (row.category === "estrangeiro") return `${base}, com confirmação do e-mail institucional.`;
  return `${base}, com confirmação do e-mail.`;
}
