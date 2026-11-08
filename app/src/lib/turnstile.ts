import { readSecret } from "./secrets";

/** Cloudflare Turnstile (antirrobô). Sem chave secreta configurada, não verifica nada. */
export const turnstileSiteKey = () => process.env.TURNSTILE_SITE_KEY?.trim() || null;
const secret = () => readSecret("TURNSTILE_SECRET_KEY", "turnstile-secret");
export const turnstileEnabled = () => !!secret() && !!turnstileSiteKey();

export async function verifyTurnstile(token: unknown, ip: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const s = secret();
  if (!s) return true;
  if (typeof token !== "string" || !token || token.length > 4096) return false;
  try {
    const body = new URLSearchParams({ secret: s, response: token });
    if (ip && ip !== "local") body.set("remoteip", ip);
    const r = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(5000) });
    return !!((await r.json()) as { success?: boolean }).success;
  } catch {
    return false; // sem resposta do Cloudflare: bloqueia (fail-closed); só vale se a chave secreta estiver configurada
  }
}
