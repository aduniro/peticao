import { readSecret } from "./secrets";
import { egressGet, egressSocket } from "./egress";
import { normalizeRegistryBirth, parseBirth } from "./birth";

/**
 * Consulta de CPF no cpf-brasil.org (documentação v2.0): GET /cpf/{cpf} com o cabeçalho X-API-Key.
 * Sem chave configurada, nenhuma consulta externa acontece. Os dados cadastrais retornados (nome da mãe, nascimento)
 * são comparados em memória e DESCARTADOS: não são gravados em banco, log nem cache.
 */
export type CpfNameCheck = "match" | "mismatch" | "indisponivel" | "nao_verificado";
export type CpfRecord = { nome: string; mae: string | null; nasc: string | null };

/** Falha do serviço (chave inválida/expirada, plano ou quota, rede, erro 5xx). Nunca é culpa do usuário. */
export class ProviderUnavailable extends Error {
  constructor(public code: string) { super(`cpf provider: ${code}`); }
}

export interface CpfProvider {
  name: string;
  /** Registro do CPF, `null` se não encontrado; lança ProviderUnavailable em falha do serviço. */
  lookup(cpf: string): Promise<CpfRecord | null>;
}

const PARTICLES = new Set(["da", "de", "do", "das", "dos", "e"]);
const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
const tokens = (s: string) => strip(s).filter((t) => !PARTICLES.has(t)); // para o nome do assinante (tolerante)
const same = (a: string, b: string) => a === b || (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b)); // aceita iniciais

/** Tolerante a acentos, partículas ("da", "de"), iniciais ("M." = "Maria") e nomes do meio omitidos. */
export function namesMatch(registered: string, declared: string): boolean {
  const R = tokens(registered), D = tokens(declared);
  if (R.length === 0 || D.length === 0) return false;
  if (!same(R[0], D[0])) return false; // primeiro nome precisa conferir
  const [small, big] = R.length <= D.length ? [R, D] : [D, R];
  const used = new Set<number>();
  let shared = 0;
  for (const t of small) {
    const i = big.findIndex((u, k) => !used.has(k) && same(t, u));
    if (i >= 0) { used.add(i); shared++; }
  }
  return shared / small.length >= 0.6 && shared >= Math.min(2, small.length);
}

/**
 * Nome da mãe: o nome COMPLETO, palavra por palavra e na mesma ordem. Ignora acentos e maiúsculas/minúsculas e espaços
 * repetidos, mas as palavras (inclusive "da", "de") precisam estar corretas e separadas por espaço. Aceita a inicial
 * quando o cadastro abrevia (ex.: cadastro "ROSEMAR MARIA P LUNA" aceita "Rosemar Maria Pereira Luna").
 */
export function motherNameMatches(registered: string | null | undefined, typed: string): boolean {
  if (!registered) return false;
  const R = strip(registered), T = strip(typed);
  if (R.length < 2 || R.length !== T.length) return false;
  return R.every((r, i) => same(r, T[i]));
}

export function birthMatches(registered: string | null | undefined, typed: string): boolean {
  const reg = normalizeRegistryBirth(registered);
  const t = parseBirth(typed);
  return !!reg && !!t && reg === t.text;
}

export function nameCheckFromRecord(rec: CpfRecord | null, declaredName: string): CpfNameCheck {
  return rec && namesMatch(rec.nome, declaredName) ? "match" : "mismatch";
}

const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Interpreta a resposta da CPF Brasil (v2.0): { success, data: { NOME, NOME_MAE, NASC } } ou formato plano; erros por `code`. */
export function parseCpfResponse(status: number, text: string): CpfRecord | null {
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* corpo não-JSON */ }
  if (status === 404 || body?.code === "CPF_NOT_FOUND") return null;
  if (status < 200 || status >= 300) throw new ProviderUnavailable(String(body?.code ?? `HTTP_${status}`)); // MISSING/INVALID_API_KEY, TOKEN_EXPIRED, PLAN_*, QUOTA_EXCEEDED, NO_KEY, RATE_LIMITED, DATABASE_*
  const d = body?.data ?? body;
  const nome = clean(d?.NOME ?? d?.nome);
  if (!nome) throw new ProviderUnavailable("EMPTY_RESPONSE");
  return { nome, mae: clean(d?.NOME_MAE ?? d?.nome_mae), nasc: clean(d?.NASC ?? d?.nasc) };
}

export function cpfBrasilProvider(apiKey: string, fetchImpl: typeof fetch = fetch): CpfProvider {
  return {
    name: "cpf-brasil.org",
    async lookup(cpf) {
      let res: Response;
      try {
        res = await fetchImpl(`https://api.cpf-brasil.org/cpf/${cpf}`, { headers: { "X-API-Key": apiKey, accept: "application/json" }, signal: AbortSignal.timeout(5000) });
      } catch {
        throw new ProviderUnavailable("NETWORK");
      }
      return parseCpfResponse(res.status, await res.text().catch(() => ""));
    },
  };
}

/** Pré-visualização isolada (sem rede): a consulta passa pela PONTE de saída, que fica fora do sandbox e guarda a chave. */
export function cpfBridgeProvider(): CpfProvider {
  return {
    name: "cpf-brasil.org (ponte)",
    async lookup(cpf) {
      try {
        const r = await egressGet(`/cpf/${cpf}`);
        return parseCpfResponse(r.status, r.body);
      } catch (e) {
        if (e instanceof ProviderUnavailable) throw e;
        throw new ProviderUnavailable("BRIDGE_DOWN");
      }
    },
  };
}

/** Provedor de mentira para testes e pré-visualização: { "CPF11digitos": { nome, mae, nasc } }. Desligado em produção. */
export function mockProvider(data: Record<string, { nome: string; mae?: string; nasc?: string }>): CpfProvider {
  return { name: "mock", lookup: async (cpf) => { const r = data[cpf]; return r ? { nome: r.nome, mae: r.mae ?? null, nasc: r.nasc ?? null } : null; } };
}

/** Ordem: ponte (sandbox) > chave direta > dados de teste (só fora de produção; CPF_FORCE_MOCK=1 faz o teste vencer a chave). */
export function defaultProvider(): CpfProvider | null {
  const live = process.env.NODE_ENV === "production" && process.env.PREVIEW_MODE !== "1";
  const mock = () => { if (!process.env.CPF_MOCK_DATA || live) return null; try { return mockProvider(JSON.parse(process.env.CPF_MOCK_DATA)); } catch { return null; } };
  if (process.env.CPF_FORCE_MOCK === "1" && !live) { const m = mock(); if (m) return m; }
  if (egressSocket() && process.env.CPF_VIA_BRIDGE === "1") return cpfBridgeProvider();
  const key = readSecret("CPF_BRASIL_API_KEY", "cpf-brasil-api-key");
  if (key) return cpfBrasilProvider(key);
  return mock();
}

/** Conferência de nome sem identidade (mantida para uso avulso). Nunca lança. */
export async function checkCpfName(cpf: string, declaredName: string, provider: CpfProvider | null = defaultProvider()): Promise<CpfNameCheck> {
  if (!provider) return "nao_verificado";
  try { return nameCheckFromRecord(await provider.lookup(cpf), declaredName); } catch { return "indisponivel"; }
}
