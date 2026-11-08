import { query } from "./db";
import { hmac } from "./security";
import { dedupEmail } from "./email-check";
import { lookupIp } from "./geo";
import { normalizeIp } from "./net";
import { suppress, isSuppressed } from "./mail/suppression";

/** E-mail que não existe: 3 tentativas com o mesmo e-mail o põem na lista negra. Não há bloqueio de IP. */
export const INVALID_EMAIL_LIMIT = 3;

export type RequestKind = "sign_pending" | "sign_confirmed" | "email_invalid" | "email_blocked" | "mail_queued" | "foreign_rejected";

/** Registra a requisição com a localização aproximada do IP, para o mapa do admin. Nunca derruba o fluxo; não guarda o e-mail em texto. */
export async function logRequest(kind: RequestKind, ip: string, o: { signatureId?: number | null; email?: string; detail?: string } = {}): Promise<void> {
  try {
    const nip = normalizeIp(ip);
    const geo = nip === "local" ? null : await lookupIp(nip);
    await query(
      `INSERT INTO request_log(kind,ip,lat,lon,city,region,country,signature_id,email_hash,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [kind, nip === "local" ? null : nip, geo?.lat ?? null, geo?.lon ?? null, geo?.city ?? null, geo?.region ?? null, geo?.country ?? null, o.signatureId ?? null, o.email ? hmac(dedupEmail(o.email)) : null, o.detail?.slice(0, 200) ?? null]);
  } catch (e) { console.error("logRequest falhou", e); }
}

export const isEmailBlacklisted = (email: string) => isSuppressed(email);

export type InvalidResult = { emailAttempts: number; ipAttempts: number; emailBlacklisted: boolean };

/** Conta uma tentativa com e-mail inexistente. Só o E-MAIL é bloqueado (3 tentativas); o IP nunca é bloqueado por erro (redes compartilhadas, como universidades). */
export async function recordInvalidEmail(email: string, ip: string): Promise<InvalidResult> {
  const eh = hmac(dedupEmail(email));
  const nip = normalizeIp(ip);
  await query("INSERT INTO invalid_attempts(email_hash, ip) VALUES($1,$2)", [eh, nip]);
  const emailAttempts = (await query<{ n: number }>("SELECT COUNT(*)::int n FROM invalid_attempts WHERE email_hash=$1 AND ts > now() - interval '30 days'", [eh])).rows[0].n;
  let emailBlacklisted = false;
  if (emailAttempts >= INVALID_EMAIL_LIMIT) { await suppress(email, "invalid", `${emailAttempts} tentativas com e-mail inexistente`); emailBlacklisted = true; }
  const ipAttempts = nip === "local" ? 0 : (await query<{ n: number }>("SELECT COUNT(*)::int n FROM invalid_attempts WHERE ip=$1 AND ts > now() - interval '24 hours'", [nip])).rows[0].n;
  await logRequest("email_invalid", ip, { email, detail: `tentativa ${emailAttempts} deste e-mail` });
  if (emailBlacklisted) await logRequest("email_blocked", ip, { email, detail: "e-mail na lista negra" });
  return { emailAttempts, ipAttempts, emailBlacklisted };
}
