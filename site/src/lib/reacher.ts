/**
 * Verificação de existência do e-mail pelo Reacher (https://github.com/reacherhq/check-if-email-exists, MIT), rodando na própria VPS
 * (REACHER_URL, ex.: http://127.0.0.1:8080). Não envia e-mail e não gasta créditos.
 *
 * Política: só recusa quando há PROVA no retorno do SMTP. "unknown", "risky", catch-all, erro de rede, timeout ou serviço fora do ar
 * deixam passar (falha aberta). A checagem de caixa existente/cheia depende da porta 25 de saída; sem ela o Reacher só devolve
 * sintaxe, MX e descartável, e nunca bloqueia ninguém por engano.
 */
import { logCheck } from "./email-check-log";
export type ReacherVerdict =
  | { ok: true; skipped?: "desligado" | "indisponivel" | "sem_prova" }
  | { ok: false; code: "email_invalid" | "email_undeliverable" | "email_disposable" | "email_not_found" | "email_full" };

type Out = {
  is_reachable?: "safe" | "risky" | "invalid" | "unknown";
  misc?: { is_disposable?: boolean };
  mx?: { accepts_mail?: boolean };
  smtp?: { can_connect_smtp?: boolean; has_full_inbox?: boolean; is_catch_all?: boolean; is_deliverable?: boolean; is_disabled?: boolean } | null;
  syntax?: { is_valid_syntax?: boolean };
};

/** Interpreta a resposta do Reacher. Exportada para teste. */
export function judge(o: Out): ReacherVerdict {
  if (o.syntax?.is_valid_syntax === false) return { ok: false, code: "email_invalid" };
  if (o.misc?.is_disposable) return { ok: false, code: "email_disposable" };
  if (o.mx?.accepts_mail === false) return { ok: false, code: "email_undeliverable" };
  const smtp = o.smtp;
  const conversou = smtp?.can_connect_smtp === true; // só vale como prova se o servidor de destino realmente respondeu
  if (conversou && smtp?.has_full_inbox === true) return { ok: false, code: "email_full" };
  if (conversou && !smtp?.is_catch_all && (o.is_reachable === "invalid" || smtp?.is_disabled === true || smtp?.is_deliverable === false)) return { ok: false, code: "email_not_found" };
  return { ok: true, skipped: conversou ? undefined : "sem_prova" };
}

const cache = new Map<string, { at: number; v: ReacherVerdict }>();
const TTL = 10 * 60_000;
export const _clearReacherCache = () => cache.clear();

async function checkWithReacherRaw(email: string, o: { url?: string; secret?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<ReacherVerdict> {
  const url = o.url ?? process.env.REACHER_URL;
  if (!url) return { ok: true, skipped: "desligado" };
  const key = email.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  try {
    const res = await (o.fetchImpl ?? fetch)(`${url.replace(/\/$/, "")}/v0/check_email`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(o.secret ?? process.env.REACHER_SECRET ? { "x-reacher-secret": (o.secret ?? process.env.REACHER_SECRET)! } : {}) },
      body: JSON.stringify({ to_email: email }),
      signal: AbortSignal.timeout(o.timeoutMs ?? 9000),
    });
    if (!res.ok) return { ok: true, skipped: "indisponivel" };
    const v = judge((await res.json()) as Out);
    if (cache.size > 2000) cache.clear();
    cache.set(key, { at: Date.now(), v });
    return v;
  } catch {
    return { ok: true, skipped: "indisponivel" }; // fora do ar ou lento: nunca impede a assinatura
  }
}


/** Consulta o Reacher e registra o veredito (aceito, sem prova, indisponível/lento, caixa inexistente…) com o tempo gasto. */
export async function checkWithReacher(email: string, o: { url?: string; secret?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<ReacherVerdict> {
  const t0 = Date.now();
  const v = await checkWithReacherRaw(email, o);
  if ((o.url ?? process.env.REACHER_URL) && !(v.ok && v.skipped === "desligado")) logCheck("reacher", email, v.ok ? (v.skipped ?? "aceito") : v.code, Date.now() - t0);
  return v;
}
