import { query } from "./db";
import { CODE_RE, parseCode } from "./verify-code";

export type VerifiedSignature = {
  seq: number; name: string; category: "servidor" | "apoiador" | "estrangeiro"; institution: string | null; role: string | null;
  lotado: string | null; city: string | null; uf: string | null; country: string | null; university: string | null;
  confirmed_at: string; cpf_name_check: string | null; region_validated: boolean | null; code: string;
};

/** Dados públicos de uma assinatura confirmada, pelo código de verificação. Nunca devolve CPF, e-mail, nascimento ou nome da mãe. */
export async function lookupSignature(raw: string): Promise<VerifiedSignature | null> {
  const code = parseCode(raw);
  if (!code || !CODE_RE.test(code)) return null;
  const r = await query<any>(
    `SELECT seq, name, category, institution, role, campus, city, uf, country, university, confirmed_at, cpf_name_check, region_validated, verify_code
     FROM signatures WHERE verify_code = $1 AND status = 'confirmed'`, [code]);
  const x = r.rows[0];
  if (!x) return null;
  return {
    seq: x.seq, name: x.name, category: x.category, institution: x.institution, role: x.region_validated ? x.role : null,
    lotado: x.region_validated ? x.campus : null, city: x.city, uf: x.uf, country: x.country, university: x.university,
    confirmed_at: x.confirmed_at, cpf_name_check: x.cpf_name_check, region_validated: x.region_validated, code: x.verify_code,
  };
}
