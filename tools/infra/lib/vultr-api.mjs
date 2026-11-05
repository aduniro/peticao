// Cliente mínimo da API v2 do Vultr. A chave fica só em memória e vai no cabeçalho Authorization (nunca em argumento de linha de comando).
const BASE = "https://api.vultr.com/v2";

export class VultrError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

/** Texto em português para os erros mais comuns (nunca inclui a chave). */
export function explain(status, serverMsg = "") {
  if (status === 401) return "Chave inválida, revogada ou colada incompleta (HTTP 401).";
  if (status === 403) return "Acesso negado (HTTP 403): o IP desta máquina provavelmente não está em Access Control da chave. No painel do Vultr: Account → API → Access Control, adicione o seu IP público (ou ative 'Any IPv4' só enquanto configura).";
  if (status === 429) return "Limite de requisições do Vultr (HTTP 429): aguarde alguns segundos e tente de novo.";
  if (status === 404) return `Não encontrado (HTTP 404). ${serverMsg}`.trim();
  return `Erro ${status}${serverMsg ? `: ${serverMsg}` : ""}`;
}

export function createClient({ key, fetchImpl = globalThis.fetch, base = BASE, timeoutMs = 30_000 }) {
  if (!key) throw new Error("sem chave do Vultr");
  async function call(method, path, body) {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 300) }; }
    if (!res.ok) throw new VultrError(res.status, explain(res.status, data?.error ?? ""), data);
    return data;
  }
  return {
    get: (p) => call("GET", p), patch: (p, b) => call("PATCH", p, b), post: (p, b) => call("POST", p, b ?? {}), del: (p) => call("DELETE", p),
    account: () => call("GET", "/account"),
  };
}
