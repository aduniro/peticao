import { checkMx } from "./email-check";
import { emailDomain, FREEMAIL, institutionalKind, type DomainKind } from "./institutional";
import { KNOWN_DOMAINS, suggestEmail } from "./email-typos";
import { SAFE_EMAIL_RE } from "./email-syntax";
import { detalheDeSugestao, diagnosticar, type Diagnostico } from "./email-diagnostico";
import { dominiosConhecidos } from "./email-sugestao";

/** Tipos de domínio que servidor não pode usar (discente, .edu.br genérico, universidade estrangeira). */
export const SERVER_REJECT = new Set<DomainKind>(["discente", "ensino-edu-br", "universidade-estrangeira"]);

export type EmailVerdict =
  | { ok: true; soft?: Diagnostico }
  | { ok: false; code: "email_invalid" | "email_typo" | "email_institutional_invalid" | "server_email_not_institutional" | "email_provider_invalid" | "apoiador_institutional_email"; suggest?: string; detail?: Diagnostico };

/** Provedores públicos conhecidos (os sugeridos): para decidir se um domínio "parece" erro de digitação de um provedor. */
const PROVIDERS = new Set<string>([...FREEMAIL, ...KNOWN_DOMAINS.filter((d) => /^(gmail|hotmail|outlook|yahoo|icloud|live|bol|uol|terra|proton|protonmail|msn|ig|globo)\./.test(d))]);

const comDetalhe = (e: string, s: string | null | undefined): { suggest?: string; detail?: Diagnostico } => {
  if (!s) return {};
  const detail = detalheDeSugestao(e, s);
  return { suggest: s, ...(detail ? { detail } : {}) };
};

/**
 * Valida o e-mail do campo, SEM efeitos colaterais (não grava nada), para o formulário avisar na hora e o servidor recusar com o mesmo código.
 * Política central (ver lib/email-diagnostico.ts): toda recusa vem com O QUE está errado (`detail`), a correção (`suggest`) e um exemplo de como digitar.
 *  - Qualquer categoria: erro de estrutura (sem @, dois @, vírgula…) e provedor aberto digitado errado ("gmial.com", "gmail.con") são recusados como `email_typo`;
 *    mesmo provedor com final diferente ("gmail.com.br") só é recusado se o domínio não receber e-mail.
 *  - Servidor: precisa de domínio institucional válido (e que receba e-mail). Domínio com cara de erro ("ufpa.edu.gov") ou sem servidor de e-mail → "e-mail institucional inválido".
 *  - Apoiador: domínio institucional → "use o formulário de Servidor"; domínio de provedor público digitado errado ou sem servidor de e-mail → "e-mail inválido".
 * As sugestões usam os domínios conhecidos do banco (aprovados na curadoria, inclusive os inseridos à mão). Falha de DNS nunca bloqueia (só "none" conta).
 */
export async function validateEmailField(email: string, category: "servidor" | "apoiador", known?: readonly string[]): Promise<EmailVerdict> {
  const e = email.trim().toLowerCase();
  const kn = known ?? (await dominiosConhecidos().catch(() => [...KNOWN_DOMAINS]));
  const diag = diagnosticar(e, kn);
  if (!SAFE_EMAIL_RE.test(e)) return { ok: false, code: diag ? "email_typo" : "email_invalid", ...(diag ? { suggest: diag.sugestao ?? undefined, detail: diag } : {}) };
  const d = emailDomain(e) ?? "";
  const kind = await institutionalKind(e);
  const noMx = (await checkMx(e)) === "none";
  if (diag && (diag.bloqueia || (diag.problema === "final" && noMx))) return { ok: false, code: "email_typo", suggest: diag.sugestao ?? undefined, detail: diag };
  if (category === "servidor") {
    if (kind && SERVER_REJECT.has(kind)) return { ok: false, code: "server_email_not_institutional" }; // aluno, .edu.br genérico ou universidade estrangeira: não vale como servidor
    if (noMx) return { ok: false, code: "email_institutional_invalid", ...comDetalhe(e, suggestEmail(e, { known: kn, semServidor: true })) };
    if (!kind || SERVER_REJECT.has(kind)) {
      if (FREEMAIL.has(d) || [...FREEMAIL].some((f) => d.endsWith("." + f))) return { ok: false, code: "server_email_not_institutional" }; // gmail etc.
      const s = suggestEmail(e, { known: kn });
      if (s && !PROVIDERS.has(emailDomain(s) ?? "")) return { ok: false, code: "email_institutional_invalid", ...comDetalhe(e, s) }; // erro de digitação de domínio institucional
      return { ok: false, code: "server_email_not_institutional" };
    }
    return { ok: true };
  }
  // apoiador
  if (kind && !SERVER_REJECT.has(kind) && !noMx) return { ok: false, code: "apoiador_institutional_email" };
  if (noMx) return { ok: false, code: "email_provider_invalid", ...comDetalhe(e, suggestEmail(e, { known: kn, semServidor: true })) };
  const s = suggestEmail(e, { known: kn });
  if (s && PROVIDERS.has(emailDomain(s) ?? "")) return { ok: false, code: "email_provider_invalid", ...comDetalhe(e, s) }; // "gmial.com" → gmail.com
  const soft = diag ?? (s ? detalheDeSugestao(e, s) : null); // só sugere: o domínio recebe e-mail, pode estar certo
  return soft ? { ok: true, soft } : { ok: true };
}
