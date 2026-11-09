export type TriageView = {
  id: number; revision: number; status: "queued" | "running" | "complete" | "failed";
  createdAt: string; finishedAt: string | null; error: string | null;
  analysis: Record<string, unknown> | null; evidence: Record<string, unknown> | null;
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const pick = (value: unknown, keys: string[]) => record(value) ? Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]])) : null;

/** Only fields intended for the administrative view; never copy worker possession. */
export function triageViewHistory(value: unknown, contactId: number): TriageView[] | null {
  if (!Array.isArray(value) || value.length > 10) return null;
  const rows: TriageView[] = [], ids = new Set(), revisions = new Set();
  for (const row of value) {
    if (!record(row) || !id(row.id) || row.contact_id !== contactId || !id(row.revision) || ids.has(row.id) || revisions.has(row.revision) || typeof row.status !== "string" || !["queued", "running", "complete", "failed"].includes(row.status) || !date(row.created_at) || row.finished_at !== null && !date(row.finished_at)) return null;
    if (rows.length && row.revision >= rows[rows.length - 1].revision) return null;
    ids.add(row.id); revisions.add(row.revision);
    rows.push({ id: row.id, revision: row.revision, status: row.status as TriageView["status"], createdAt: row.created_at, finishedAt: row.finished_at as string | null,
      error: typeof row.error_code === "string" && /^[a-z_]{1,60}$/.test(row.error_code) ? row.error_code : null,
      analysis: pick(row.analysis, ["engine", "category", "state", "priority", "reasons", "suggestedActions", "campus"]),
      evidence: pick(row.evidence, ["contact", "snapshotAt", "signatures", "mail", "events", "outbound", "suppression", "queue", "unavailable", "truncated"]) });
  }
  return rows;
}

export function triageViewSuggestion(value: unknown, contactId: number, latest: TriageView) {
  if (!record(value) || value.ok !== true || value.requiresHumanReview !== true || value.persisted !== false || !record(value.context) || !record(value.draft) || latest.status !== "complete") return null;
  if (value.context.contactId !== contactId || value.context.jobId !== latest.id || value.context.revision !== latest.revision || typeof value.draft.assunto !== "string" || value.draft.assunto.length > 150 || typeof value.draft.corpo !== "string" || value.draft.corpo.length > 5000) return null;
  return { subject: value.draft.assunto, body: value.draft.corpo };
}

/** AV14 approved vocabulary. Unknown future codes remain technical evidence only. */
const PROCESSING = { queued: "Em fila", running: "Em análise", complete: "Concluída", failed: "Falha técnica" } as const;
const CATEGORIES: Record<string, string> = { nao_recebeu: "Confirmação por e-mail", expirou: "Link expirado", email_recusado: "E-mail recusado", cpf: "Nome/CPF", remover: "Pedido de remoção", corrigir: "Pedido de correção", campus: "Campus", erro: "Erro no formulário", duvida: "Dúvida" };
const DIAGNOSES: Record<string, string> = { inconclusive: "Inconclusivo", review: "Revisão necessária", resolved: "Confirmação posterior ao relato" };
export function triageViewLabels(job: TriageView) {
  const analysis = job.analysis;
  const lookup = (map: Record<string, string>, value: unknown) => typeof value === "string" && Object.hasOwn(map, value) ? map[value] : null;
  return { processing: PROCESSING[job.status], category: lookup(CATEGORIES, analysis?.category), diagnosis: lookup(DIAGNOSES, analysis?.state), priority: lookup({ normal: "Normal", high: "Alta" }, analysis?.priority) };
}
export function triageViewFailure(error: string) {
  return error === "analysis_stale" || error === "context_changed"
    ? "Os dados mudaram. Solicite uma nova análise."
    : "Não foi possível atualizar a análise. Reabra este painel para conferir o estado atual.";
}
