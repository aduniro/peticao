import { logCheck } from "./email-check-log";
import { promises as dns } from "node:dns";
import { emailDomain } from "./institutional";

/** Domínios de e-mail descartável mais comuns. Estenda com EXTRA_DISPOSABLE (separados por vírgula). */
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "10minutemail.com", "10minutemail.net", "tempmail.com", "temp-mail.org",
  "temp-mail.io", "yopmail.com", "yopmail.fr", "trashmail.com", "getnada.com", "dispostable.com", "maildrop.cc", "throwawaymail.com", "fakeinbox.com",
  "mohmal.com", "emailondeck.com", "mintemail.com", "spamgourmet.com", "tempinbox.com", "burnermail.io", "moakt.com", "mailnesia.com", "tmpmail.org",
]);

export function isDisposable(email: string): boolean {
  const d = emailDomain(email);
  if (!d) return false;
  const extra = (process.env.EXTRA_DISPOSABLE ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return [...DISPOSABLE, ...extra].some((x) => d === x || d.endsWith("." + x));
}

/** Para detectar duplicatas: no Gmail, pontos e "+etiqueta" não mudam a caixa de entrada. */
export function dedupEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return e;
  let local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.split("+")[0].replace(/\./g, "");
    return `${local}@gmail.com`;
  }
  return `${local.split("+")[0]}@${domain}`;
}

export type MxResult = "ok" | "none" | "erro";
type Resolver = (domain: string) => Promise<MxResult>;

const real: Resolver = async (domain) => {
  const withTimeout = <T,>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), 3000))]);
  try {
    const mx = await withTimeout(dns.resolveMx(domain));
    if (mx.length > 0) return "ok";
  } catch (e: any) {
    if (e?.code !== "ENODATA" && e?.code !== "ENOTFOUND") return "erro";
  }
  try {
    const a = await withTimeout(dns.resolve4(domain));
    return a.length > 0 ? "ok" : "none";
  } catch (e: any) {
    return e?.code === "ENODATA" || e?.code === "ENOTFOUND" ? "none" : "erro";
  }
};

let resolver: Resolver = real;
/** Só para testes: troca a consulta DNS. */
export const _setMxResolverForTests = (r: Resolver | null) => { resolver = r ?? real; };

/** "none" = o domínio não recebe e-mail (NXDOMAIN/sem MX/A); "erro" (rede/timeout) NUNCA bloqueia. */
export async function checkMx(email: string): Promise<MxResult> {
  const d = emailDomain(email);
  const t0 = Date.now();
  const r: MxResult = d ? await resolver(d) : "none";
  logCheck("mx", email, r, Date.now() - t0);
  return r;
}
