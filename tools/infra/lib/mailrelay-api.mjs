// Cliente mínimo da API v1 do Mailrelay (https://apidocs.mailrelay.com/). A chave vai no cabeçalho X-AUTH-TOKEN e nunca é impressa.
export const MAILRELAY_HOST = "sancionapresidente.ipzmarketing.com";

export async function mailrelayCall(path, key, { host = MAILRELAY_HOST, fetchImpl = globalThis.fetch, method = "GET", body } = {}) {
  const headers = { "X-AUTH-TOKEN": key, accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetchImpl(`https://${host}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* sem corpo JSON (ex.: 204) */ }
  return { status: res.status, json };
}

/** Valida a chave com GET /ping (204 = válida) e, se válida, conta os remetentes cadastrados. */
export async function validateMailrelay(key, opts = {}) {
  const host = opts.host ?? MAILRELAY_HOST;
  const p = await mailrelayCall("/ping", key, opts);
  if (p.status === 204 || p.status === 200) {
    let extra = "";
    try { const s = await mailrelayCall("/senders", key, opts); if (s.status === 200 && Array.isArray(s.json)) extra = ` Remetentes cadastrados: ${s.json.length}${s.json.length ? ` (${s.json.map((x) => x.email ?? x.name).filter(Boolean).slice(0, 5).join(", ")})` : ""}.`; } catch { /* a chave pode não ter essa permissão */ }
    return `Conexão OK com o Mailrelay (${host}).${extra}`;
  }
  if (p.status === 401 || p.status === 403) throw new Error(`O Mailrelay recusou a chave (HTTP ${p.status}). Confira se copiou a chave inteira e se ela pertence à conta ${host}.`);
  if (p.status === 404) throw new Error(`Conta não encontrada em ${host} (HTTP 404).`);
  if (p.status === 429) throw new Error("Limite de requisições do Mailrelay (HTTP 429): tente de novo em alguns segundos.");
  throw new Error(`Resposta inesperada do Mailrelay: HTTP ${p.status}.`);
}
