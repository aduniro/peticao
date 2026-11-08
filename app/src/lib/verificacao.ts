import { checkWithReacher, type ReacherVerdict } from "./reacher";
import { ordemRodizio, parsePesos, registrar } from "./mail/rodizio";
import { logCheck } from "./email-check-log";
import { readCredentialText } from "./mail/smtp-credential";

/**
 * POLÍTICA CENTRAL — checagem de existência do e-mail (bounce antecipado) em RODÍZIO entre os serviços habilitados:
 * VERIFY_ROTATION="reacher:3,mailersend:1" (pesos). Sem a variável, só o Reacher (comportamento antigo). Um serviço indisponível
 * passa a vez ao próximo (e o disjuntor o tira do rodízio por alguns minutos). Só recusa com PROVA (caixa inexistente, sintaxe, descartável).
 */
type Veredito = ReacherVerdict;
const token = () => process.env.MAILERSEND_API_TOKEN ?? readCredentialText("mailersend-api");

/** MailerSend Email Verification (consome créditos de verificação da conta). */
export async function verificarMailersend(email: string, o: { fetchImpl?: typeof fetch; token?: string | null } = {}): Promise<Veredito> {
  const t = o.token ?? token();
  if (!t) return { ok: true, skipped: "desligado" };
  try {
    const r = await (o.fetchImpl ?? fetch)("https://api.mailersend.com/v1/email-verification/verify", { method: "POST", signal: AbortSignal.timeout(5000), headers: { Authorization: `Bearer ${t}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ email }) });
    if (!r.ok) return { ok: true, skipped: "indisponivel" };
    const s = String((await r.json() as any)?.status ?? "").toLowerCase();
    if (s === "mailbox_not_found") return { ok: false, code: "email_not_found" };
    if (s === "syntax_error") return { ok: false, code: "email_invalid" };
    if (s === "disposable") return { ok: false, code: "email_disposable" };
    if (s === "mailbox_full") return { ok: false, code: "email_full" };
    return s ? { ok: true } : { ok: true, skipped: "sem_prova" };
  } catch { return { ok: true, skipped: "indisponivel" }; }
}

export async function verificarEmail(email: string, o: { timeoutMs?: number; fetchImpl?: typeof fetch; mailersendToken?: string | null } = {}): Promise<Veredito & { servico: string }> {
  const pesos = parsePesos(process.env.VERIFY_ROTATION);
  const reacher = () => checkWithReacher(email, { timeoutMs: o.timeoutMs });
  if (!pesos) return { ...(await reacher()), servico: "reacher" };
  const servicos: Record<string, () => Promise<Veredito>> = { reacher, mailersend: () => verificarMailersend(email, { fetchImpl: o.fetchImpl, token: o.mailersendToken }) };
  const ordem = ordemRodizio("verificacao", Object.keys(servicos).filter((s) => pesos[s]), pesos);
  let ultimo: Veredito = { ok: true, skipped: "indisponivel" }, usado = ordem[0] ?? "reacher";
  for (const s of ordem) {
    const t0 = Date.now(); const v = await servicos[s]();
    const indisponivel = v.ok && (v.skipped === "indisponivel" || v.skipped === "desligado");
    registrar("verificacao", s, !indisponivel);
    if (s === "mailersend") logCheck("mailersend", email, v.ok ? (v.skipped ?? "aceito") : v.code, Date.now() - t0);
    ultimo = v; usado = s;
    if (!indisponivel) break; // resposta conclusiva (com ou sem prova): não consulta os outros
  }
  return { ...ultimo, servico: usado };
}
