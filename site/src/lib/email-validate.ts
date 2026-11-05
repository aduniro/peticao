import { checkMx } from "./email-check";
import { emailDomain, FREEMAIL, institutionalKind, type DomainKind } from "./institutional";
import { KNOWN_DOMAINS, suggestEmail } from "./email-typos";
import { SAFE_EMAIL_RE } from "./email-syntax";

/** Tipos de domínio que servidor não pode usar (discente, .edu.br genérico, universidade estrangeira). */
export const SERVER_REJECT = new Set<DomainKind>(["discente", "ensino-edu-br", "universidade-estrangeira"]);

export type EmailVerdict =
  | { ok: true }
  | { ok: false; code: "email_invalid" | "email_institutional_invalid" | "server_email_not_institutional" | "email_provider_invalid" | "apoiador_institutional_email"; suggest?: string };

/** Provedores públicos conhecidos (os sugeridos): para decidir se um domínio "parece" erro de digitação de um provedor. */
const PROVIDERS = new Set<string>([...FREEMAIL, ...KNOWN_DOMAINS.filter((d) => /^(gmail|hotmail|outlook|yahoo|icloud|live|bol|uol|terra|proton|protonmail|msn|ig|globo)\./.test(d))]);

/**
 * Valida o e-mail do campo, SEM efeitos colaterais (não grava nada), para o formulário avisar na hora e o servidor recusar com o mesmo código.
 *  - Servidor: precisa de domínio institucional válido (e que receba e-mail). Domínio com cara de erro ("ufpa.edu.gov") ou sem servidor de e-mail → "e-mail institucional inválido".
 *  - Apoiador: domínio institucional → "use o formulário de Servidor"; domínio de provedor público digitado errado ("gmial.com") ou sem servidor de e-mail → "e-mail inválido".
 * Falha de DNS nunca bloqueia (só "none" conta).
 */
export async function validateEmailField(email: string, category: "servidor" | "apoiador"): Promise<EmailVerdict> {
  const e = email.trim().toLowerCase();
  if (!SAFE_EMAIL_RE.test(e)) return { ok: false, code: "email_invalid" };
  const d = emailDomain(e) ?? "";
  const kind = await institutionalKind(e);
  const noMx = (await checkMx(e)) === "none";
  if (category === "servidor") {
    if (kind && SERVER_REJECT.has(kind)) return { ok: false, code: "server_email_not_institutional" }; // aluno, .edu.br genérico ou universidade estrangeira: não vale como servidor
    if (noMx) return { ok: false, code: "email_institutional_invalid", suggest: suggestEmail(e, { semServidor: true }) ?? undefined };
    if (!kind || SERVER_REJECT.has(kind)) {
      if (FREEMAIL.has(d) || [...FREEMAIL].some((f) => d.endsWith("." + f))) return { ok: false, code: "server_email_not_institutional" }; // gmail etc.
      const s = suggestEmail(e);
      if (s && !PROVIDERS.has(emailDomain(s) ?? "")) return { ok: false, code: "email_institutional_invalid", suggest: s }; // erro de digitação de domínio institucional
      return { ok: false, code: "server_email_not_institutional" };
    }
    return { ok: true };
  }
  // apoiador
  if (kind && !SERVER_REJECT.has(kind) && !noMx) return { ok: false, code: "apoiador_institutional_email" };
  if (noMx) return { ok: false, code: "email_provider_invalid", suggest: suggestEmail(e, { semServidor: true }) ?? undefined };
  const s = suggestEmail(e);
  if (s && PROVIDERS.has(emailDomain(s) ?? "")) return { ok: false, code: "email_provider_invalid", suggest: s }; // "gmial.com" → gmail.com
  return { ok: true };
}
