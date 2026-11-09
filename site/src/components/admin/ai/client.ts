export type Purpose = "painel" | "divulgacao" | "atendimento";
export type Source = { id: string; title: string; text: string; source: { version: string; ref: string; kind: string } };
export type ContextInput = { uso: Purpose; consulta: string; contato?: number; instrucoes?: string };
export type Prepared = { proof: string; executionAvailable: boolean; requestedEnabled: boolean; inputBytes: number; sources: { id: string; version: string }[] };
export type Draft = { text: string; citations: { id: string; version: string }[] };
const ERRORS: Record<string, string> = {
  parameters: "Confira os campos informados. Use um tema curto para buscar fontes e escreva o pedido no campo separado.",
  insufficient_sources: "Não foram encontradas fontes suficientes. Ajuste o tema da busca.",
  context_too_large: "O contexto ficou grande demais. Reduza o pedido ou refine a busca.",
  context_changed: "As fontes ou a configuração mudaram. Prepare o contexto novamente.",
  configuration_conflict: "A configuração mudou. Seus campos foram preservados; recarregue a configuração antes de salvar.",
  disabled: "A geração de IA está desabilitada neste ambiente. A busca de fontes continua disponível.",
  credential_unavailable: "O serviço de IA ainda não está configurado neste ambiente.",
  budget_exhausted: "A cota diária de IA foi atingida.",
  result_uncertain: "O resultado da tentativa não pôde ser confirmado. Confira a tentativa antes de solicitar outra geração.",
  already_attempted: "Esta solicitação já foi tentada. Confira o resultado; ela não será gerada novamente automaticamente.",
  analysis_pending: "A análise deste contato ainda está pendente.",
  analysis_stale: "A análise do contato mudou. Reanalise o caso antes de preparar a minuta.",
  rate_limited: "Muitas solicitações em pouco tempo. Aguarde um minuto.",
  source_stale: "Uma fonte mudou. Prepare o contexto novamente.",
  not_found: "O registro solicitado não foi encontrado.",
};
export class AiError extends Error { constructor(public code: string) { super(ERRORS[code] ?? "Não foi possível concluir a solicitação. Seus campos foram preservados."); } }
export async function aiRequest(path: string, body?: unknown, timeout = 15_000) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    const data = await response.json().catch(() => null);
    if (response.status === 401) { window.location.assign("/admin"); throw new AiError("forbidden"); }
    if (response.status === 403 && data?.erro === "stepup") { window.location.assign(`/admin/confirmar?volta=${encodeURIComponent(window.location.pathname)}`); throw new AiError("forbidden"); }
    if (!response.ok || data?.ok !== true) throw new AiError(typeof data?.error === "string" ? data.error : response.status === 429 ? "rate_limited" : "unavailable");
    return data;
  } finally { clearTimeout(timer); }
}
export const errorText = (error: unknown) => error instanceof AiError ? error.message : "Falha de rede. Seus campos foram preservados; confira a tentativa antes de repetir uma geração.";
export const validSources = (value: unknown): value is Prepared["sources"] => Array.isArray(value) && value.length <= 10 && value.every(item => item && typeof item.id === "string" && item.id.length <= 100 && /^[a-f0-9]{64}$/.test(item.version));
export function downloadText(text: string, name: string, mime = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type: mime })), link = document.createElement("a");
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
