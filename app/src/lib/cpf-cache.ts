import { diagnosticMark } from "./signup-diagnostics";
import { tx, query } from "./db";
import { encryptCpfCache, decryptCpfCache } from "./cpf-cache-crypto";
import { hmac } from "./security";
import type { CpfProvider, CpfRecord } from "./cpf-check";

export const CPF_CACHE_DAYS = 30;
export const CPF_CACHE_TTL_MS = CPF_CACHE_DAYS * 86400_000;
export type CpfCacheEntry = { payload: string; fetched_at: string | Date; expires_at: string | Date };
export type CacheTransaction = <T>(hash: string, fn: (
  entry: CpfCacheEntry | null, save: (entry: CpfCacheEntry) => Promise<void>
) => Promise<T>) => Promise<T>;

/** CPF nunca em claro; a chave de criptografia é independente do HASH_PEPPER. */
export const cpfCacheContext = (hash: string) => `cpf-cache:v1:${hash}`;

const transaction: CacheTransaction = (hash, fn) => tx(async (c) => {
  // Serializa consultas do mesmo CPF inclusive entre processos do Next.
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["cpf-cache:" + hash]);
  const entry = (await c.query<CpfCacheEntry>(
    "SELECT payload,fetched_at,expires_at FROM cpf_lookup_cache WHERE cpf_hash=$1", [hash])).rows[0] ?? null;
  return fn(entry, async (value) => {
    await c.query(`INSERT INTO cpf_lookup_cache(cpf_hash,payload,fetched_at,expires_at) VALUES($1,$2,$3,$4)
      ON CONFLICT(cpf_hash) DO UPDATE SET payload=EXCLUDED.payload,fetched_at=EXCLUDED.fetched_at,expires_at=EXCLUDED.expires_at`,
    [hash, value.payload, value.fetched_at, value.expires_at]);
  });
});

function decode(entry: CpfCacheEntry | null, hash: string, now: number): CpfRecord | null {
  if (!entry) return null;
  const at = new Date(entry.fetched_at).getTime(), expires = new Date(entry.expires_at).getTime();
  if (!Number.isFinite(at) || !Number.isFinite(expires) || at > now || at + CPF_CACHE_TTL_MS <= now || expires <= now) return null;
  const plain = decryptCpfCache(entry.payload, cpfCacheContext(hash));
  if (!plain) return null;
  try {
    const r = JSON.parse(plain);
    if (typeof r.nome !== "string" || !r.nome.trim() ||
        ![r.mae, r.nasc, r.sexo].every(v => v === null || typeof v === "string")) return null;
    return { nome: r.nome, mae: r.mae, nasc: r.nasc, sexo: r.sexo };
  } catch { return null; }
}

/** Guarda o retorno cadastral; cada tentativa continua sendo validada novamente. */
export function cachedCpfProvider(provider: CpfProvider, options: {
  transaction?: CacheTransaction; now?: () => number;
} = {}): CpfProvider {
  const run = options.transaction ?? transaction, clock = options.now ?? Date.now;
  return {
    name: provider.name,
    async lookup(cpf) {
      const hash = hmac(cpf);
      let called = false, upstreamFailed = false, answer: CpfRecord | null = null, upstreamError: unknown;
      try {
        return await run(hash, async (entry, save) => {
          const hit = decode(entry, hash, clock());
          if (hit) { diagnosticMark("cache", "hit"); return hit; }
          diagnosticMark("cache", "miss");
          called = true;
          try { answer = await provider.lookup(cpf); }
          catch (error) { upstreamFailed = true; upstreamError = error; throw error; }
          // Falha e não encontrado nunca ficam presos no cache por 30 dias.
          if (answer) {
            const at = clock();
            const record = { nome: answer.nome, mae: answer.mae, nasc: answer.nasc, sexo: answer.sexo ?? null };
            await save({ payload: encryptCpfCache(JSON.stringify(record), cpfCacheContext(hash)),
              fetched_at: new Date(at).toISOString(), expires_at: new Date(at + CPF_CACHE_TTL_MS).toISOString() });
          }
          return answer;
        });
      } catch (error) {
        if (upstreamFailed) throw upstreamError;
        // Uma falha de gravação não invalida o retorno já obtido nem repete a cobrança.
        diagnosticMark("cache", "bypass");
        console.warn("[cpf-cache] cache indisponível; consulta segue sem persistência");
        return called ? answer : provider.lookup(cpf);
      }
    },
  };
}

/** Chamado pelo agendador. Não renova o prazo ao ler nem conserva registros vencidos. */
export async function purgeExpiredCpfCache(): Promise<number> {
  const result = await query("DELETE FROM cpf_lookup_cache WHERE expires_at <= now() OR fetched_at <= now() - interval '30 days'");
  return result.rowCount ?? 0;
}
