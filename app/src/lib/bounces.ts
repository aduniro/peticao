import { query } from "./db";
import { readCredentialText } from "./mail/smtp-credential";
import { suggestEmail } from "./email-typos";

export type Bounce = { email: string; event: "hardBounces" | "softBounces" | "blocked" | "invalid"; reason: string; at: string };
export type ReturnedRow = { id: number; name: string; institution: string; category: string; email: string; createdAt: string; why: string; event: string; suggest: string | null };

const g = globalThis as unknown as { __bounces?: { at: number; days: number; v: Bounce[] } };

/** Eventos de e-mail devolvido na Brevo (últimos `days` dias). Resultado guardado por 5 min; sem chave ou com erro, devolve só o que houver. */
export async function brevoBounces(days = 14): Promise<Bounce[]> {
  if (g.__bounces && g.__bounces.days === days && Date.now() - g.__bounces.at < 5 * 60_000) return g.__bounces.v;
  const key = process.env.BREVO_API_KEY ?? readCredentialText("brevo-api");
  const out: Bounce[] = [];
  if (key) {
    for (const event of ["hardBounces", "softBounces", "blocked", "invalid"] as const) {
      try {
        const r = await fetch(`https://api.brevo.com/v3/smtp/statistics/events?event=${event}&days=${days}&limit=500`, { headers: { "api-key": key, accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
        if (!r.ok) continue;
        const j = (await r.json()) as { events?: { email: string; reason?: string; date?: string }[] };
        for (const e of j.events ?? []) out.push({ email: e.email.toLowerCase(), event, reason: String(e.reason ?? ""), at: String(e.date ?? "") });
      } catch { /* mantém o que já veio */ }
    }
  }
  g.__bounces = { at: Date.now(), days, v: out };
  return out;
}

/** Motivo em português a partir da mensagem do servidor de destino. */
export function bounceWhy(reason: string): { text: string; semServidor: boolean } {
  if (/Unable to find MX|no MX|NXDOMAIN|domain.*not found/i.test(reason)) return { text: "O domínio não tem servidor de e-mail", semServidor: true };
  if (/5\.1\.1|does not exist|user unknown|no such user|mailbox.*(not found|unavailable)/i.test(reason)) return { text: "A caixa de e-mail não existe (provável erro de digitação antes do @)", semServidor: false };
  if (/full|quota/i.test(reason)) return { text: "Caixa cheia", semServidor: false };
  return { text: reason.slice(0, 90) || "Devolvido pelo servidor de destino", semServidor: false };
}

/** Cadastros AINDA pendentes cujo e-mail foi devolvido (Brevo) ou está na lista de supressão. */
export async function returnedPending(): Promise<ReturnedRow[]> {
  const bounces = await brevoBounces();
  const byEmail = new Map<string, Bounce>();
  for (const b of bounces) if (!byEmail.has(b.email) || b.event === "hardBounces") byEmail.set(b.email, b);
  const emails = [...byEmail.keys()];
  const r = await query<{ id: number; name: string; institution: string; category: string; email: string; created_at: string; supp: string | null }>(
    `SELECT s.id, s.name, COALESCE(s.institution, s.university, '') AS institution, s.category, s.email, s.created_at, e.reason AS supp
       FROM signatures s LEFT JOIN email_suppressions e ON lower(e.email) = lower(s.email)
      WHERE s.status = 'pending' AND (lower(s.email) = ANY($1::text[]) OR e.email IS NOT NULL)
      ORDER BY s.created_at DESC LIMIT 500`, [emails]);
  return r.rows.map((x) => {
    const b = byEmail.get(x.email.toLowerCase());
    const why = bounceWhy(b?.reason ?? (x.supp ? `lista de supressão: ${x.supp}` : ""));
    return { id: x.id, name: x.name, institution: x.institution, category: x.category, email: x.email, createdAt: x.created_at, why: why.text, event: b?.event ?? "supressão", suggest: suggestEmail(x.email, { semServidor: why.semServidor }) };
  });
}
