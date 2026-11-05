import { query } from "./db";
import { birthMatches, type CpfProvider, type CpfNameCheck, defaultProvider, motherNameMatches, nameCheckFromRecord, ProviderUnavailable } from "./cpf-check";
import { parseBirth, normalizeRegistryBirth } from "./birth";
import { dedupEmail } from "./email-check";
import { institutionalKind } from "./institutional";
import { hmac, safeEqual } from "./security";
import { setSetting } from "./batches";

export type IdentityMethod = "mae" | "nascimento";
export const MAX_FAILED = 5; // tentativas erradas por CPF em 24 h

/** `required` quando há provedor de CPF configurado; força com IDENTITY_CHECK_MODE=required|off. */
export function identityMode(provider: CpfProvider | null = defaultProvider()): "required" | "off" {
  const env = process.env.IDENTITY_CHECK_MODE;
  if (env === "required" || env === "off") return env;
  return provider ? "required" : "off";
}

/** Quem NÃO usa e-mail institucional (provedor comum, domínio próprio, domínio de discentes) precisa confirmar identidade. */
export async function needsIdentity(email: string, provider: CpfProvider | null = defaultProvider()): Promise<boolean> {
  if (identityMode(provider) === "off") return false;
  const kind = await institutionalKind(email);
  return kind === null || kind === "discente";
}

// Ticket: prova que a 1ª etapa (validação + antirrobô) passou para ESTE CPF e ESTE e-mail; vale 15 min.
const TICKET_TTL_MS = 15 * 60_000;
const sig = (cpf: string, email: string, exp: number) => hmac(`ticket|${cpf}|${dedupEmail(email)}|${exp}`);
export const makeTicket = (cpf: string, email: string, now = Date.now()) => { const exp = now + TICKET_TTL_MS; return `${exp}.${sig(cpf, email, exp)}`; };
export function checkTicket(ticket: unknown, cpf: string, email: string, now = Date.now()): boolean {
  if (typeof ticket !== "string") return false;
  const [e, s] = ticket.split(".");
  const exp = Number(e);
  return !!s && Number.isFinite(exp) && exp > now && safeEqual(s, sig(cpf, email, exp));
}

export type IdentityResult =
  | { ok: true; nameCheck: CpfNameCheck }
  | { ok: false; reason: "mismatch" | "locked" | "unavailable" | "method_unavailable" | "bad_input" | "mock_unknown"; attemptsLeft?: number };

const failedRecent = async (cpfHash: string) =>
  (await query<{ n: number }>("SELECT COUNT(*)::int n FROM identity_attempts WHERE cpf_hash=$1 AND ok=false AND ts > $2", [cpfHash, new Date(Date.now() - 24 * 3600_000).toISOString()])).rows[0].n;

async function record(cpfHash: string, method: string, ok: boolean) {
  await query("INSERT INTO identity_attempts(cpf_hash,method,ok,ts) VALUES($1,$2,$3,$4)", [cpfHash, method, ok, new Date().toISOString()]);
  if (Math.random() < 0.02) await query("DELETE FROM identity_attempts WHERE ts < $1", [new Date(Date.now() - 7 * 86400_000).toISOString()]);
}

/**
 * Confere a identidade comparando o dado digitado com o cadastro do CPF. O dado digitado e o retornado pelo serviço
 * existem apenas em memória durante esta chamada: só gravamos o CPF em hash, o método e se acertou.
 */
export async function verifyIdentity(a: { cpf: string; method: IdentityMethod; value: string; declaredName: string; provider?: CpfProvider | null }): Promise<IdentityResult> {
  const provider = a.provider === undefined ? defaultProvider() : a.provider;
  if (!provider) return { ok: false, reason: "unavailable" };
  if (a.method !== "mae" && a.method !== "nascimento") return { ok: false, reason: "bad_input" };
  if (a.method === "nascimento" ? !parseBirth(a.value) : a.value.trim().split(/\s+/).length < 2) return { ok: false, reason: "bad_input" };

  const cpfHash = hmac(a.cpf);
  const failed = await failedRecent(cpfHash);
  if (failed >= MAX_FAILED) return { ok: false, reason: "locked", attemptsLeft: 0 };

  let rec;
  try {
    rec = await provider.lookup(a.cpf);
  } catch (e) {
    const code = e instanceof ProviderUnavailable ? e.code : "UNKNOWN";
    console.error(`[cpf] serviço de verificação indisponível: ${code}`); // só o código, nunca dados pessoais
    await setSetting("cpf_provider_last_error", `${code} em ${new Date().toISOString()}`).catch(() => {});
    return { ok: false, reason: "unavailable" };
  }
  if (!rec && provider.name === "mock") return { ok: false, reason: "mock_unknown" }; // dados de teste: não conta como tentativa errada
  if (rec && (a.method === "mae" ? !rec.mae : !normalizeRegistryBirth(rec.nasc))) return { ok: false, reason: "method_unavailable" };

  const ok = !!rec && (a.method === "mae" ? motherNameMatches(rec.mae, a.value) : birthMatches(rec.nasc, a.value));
  await record(cpfHash, a.method, ok);
  if (!ok) return { ok: false, reason: "mismatch", attemptsLeft: Math.max(0, MAX_FAILED - failed - 1) };
  return { ok: true, nameCheck: nameCheckFromRecord(rec, a.declaredName) };
}

/** Suporte: libera um CPF que ficou bloqueado por tentativas erradas (ex.: pessoa legítima que errou o nome da mãe). */
export async function resetIdentityAttempts(cpf: string): Promise<number> {
  const r = await query("DELETE FROM identity_attempts WHERE cpf_hash=$1", [hmac(cpf.replace(/\D/g, ""))]);
  return r.rowCount ?? 0;
}

// ---- Conferência de NOME x CPF (servidores): só o nome declarado é comparado com o cadastro do CPF; nada de nome da mãe ou nascimento. ----
export type NameGate =
  | { ok: true; nameCheck: "match" }
  | { ok: false; reason: "mismatch" | "not_found" | "unavailable" | "locked" };

const nameCache = new Map<string, { at: number; ok: boolean }>();
const NAME_TTL = 10 * 60_000;
export const _clearNameCache = () => nameCache.clear();
const foldName = (n: string) => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean).join(" ");

/**
 * Impede o CPF de outra pessoa com um nome qualquer. Guarda só o veredito (booleano) por 10 min, para não repetir consulta quando a pessoa
 * reenvia o formulário; os dados cadastrais retornados pelo serviço nunca são gravados. 5 recusas por CPF em 24 h travam por 24 h.
 */
export async function verifyCpfName(a: { cpf: string; declaredName: string; provider: CpfProvider }): Promise<NameGate> {
  const cpfHash = hmac(a.cpf);
  const key = hmac(`${a.cpf}|${foldName(a.declaredName)}`);
  const hit = nameCache.get(key);
  if (hit && Date.now() - hit.at < NAME_TTL) return hit.ok ? { ok: true, nameCheck: "match" } : { ok: false, reason: "mismatch" };
  if ((await failedRecent(cpfHash)) >= MAX_FAILED) return { ok: false, reason: "locked" };
  let rec;
  try {
    rec = await a.provider.lookup(a.cpf);
  } catch (e) {
    const code = e instanceof ProviderUnavailable ? e.code : "UNKNOWN";
    console.error(`[cpf] serviço de verificação indisponível: ${code}`); // só o código, nunca dados pessoais
    await setSetting("cpf_provider_last_error", `${code} em ${new Date().toISOString()}`).catch(() => {});
    return { ok: false, reason: "unavailable" };
  }
  if (!rec) { await record(cpfHash, "nome", false); return { ok: false, reason: "not_found" }; }
  const ok = nameCheckFromRecord(rec, a.declaredName) === "match";
  await record(cpfHash, "nome", ok);
  if (nameCache.size > 2000) nameCache.clear();
  nameCache.set(key, { at: Date.now(), ok });
  return ok ? { ok: true, nameCheck: "match" } : { ok: false, reason: "mismatch" };
}
