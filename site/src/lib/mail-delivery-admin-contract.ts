import { pendingEmailCount, pendingEmailTimestamp, validPendingEmailActor, type PendingEmailActor, type PendingEmailSignal } from "@/lib/pending-email-admin-contract";

/** One row per registration ID, plus explicit unregistered addresses; never a deduplicated person. */
export type MailDeliveryActor = PendingEmailActor;
export const MAIL_DELIVERY_STATES = ["clicou", "abriu", "entregue", "devolvido", "aceito", "sem_registro"] as const;
export type MailDeliveryState = typeof MAIL_DELIVERY_STATES[number];
export type MailDeliveryFilters = { busca?: string; situacao?: MailDeliveryState; cadastro?: "aguardando" | "confirmado" | "sem"; categoria?: "servidor" | "apoiador" | "estrangeiro"; provedor?: string };
export type MailDeliveryOptions = { filters?: MailDeliveryFilters; page?: number; limit?: number };
export type MailDeliveryRow = {
  recordKey: string; rowKind: "registration" | "unregistered_address"; cadastroId: number | null;
  email: string; nome: string; categoria: string; instituicao: string; cargo: string; campus: string; universidade: string; cidadeUf: string; pais: string;
  cadastro: "" | "aguardando" | "confirmado"; cadastradoEm: string; confirmadoEm: string; whatsapp: string;
  envios: number; ultimoEnvio: string; ultimoTipo: string; provedores: string; situacao: MailDeliveryState;
  entregueEm: string; abertoEm: string; clicouEm: string; devolucao: string; devolucaoMotivo: string; devolucaoEm: string;
  evidence: {
    scope: "address_aggregate" | "none"; registrationLink: "email_only" | "none"; messageKinds: "all";
    providerScope: string | null; providersAll: string[]; lastSignal: PendingEmailSignal | null;
    relationToCurrentConfirmation: "not_proven"; timestamps: "earliest_recorded_history";
    legacyEngagementFirstOnly: boolean; acceptedLogRecords: number; acceptedJournalAttempts: number;
    sendCountMeaning: "legacy_accepted_log_records_not_unique_messages";
    contactState: "absent" | "withheld_no_opt_in" | "available" | "unavailable";
  };
};
export type MailDeliverySummary = { total: number; registrations: number; pending: number; confirmed: number; unregisteredAddresses: number; byState: Record<MailDeliveryState, number> };
export type MailDeliveryFailure = { ok: false; error: "invalid" | "forbidden" | "unavailable" };
export type MailDeliveryReadResult = {
  ok: true; asOf: string; unit: "registration_or_unregistered_address";
  total: number; pagina: number; limite: number; linhas: MailDeliveryRow[];
  inventory: { records: number; registrations: number; pending: number; confirmed: number; unregisteredAddresses: number };
  summary: MailDeliverySummary; providerScope: string | null;
  coverage: { inventoryRecords: number; matched: number; totalRowsReturned: number; complete: true; signalsComplete: true };
};
export type MailDeliveryExportResult = { ok: true; asOf: string; unit: "registration_or_unregistered_address"; rows: MailDeliveryRow[]; total: number; providerScope: string | null };
export const MAIL_DELIVERY_FILTER_KEYS = ["busca", "situacao", "cadastro", "categoria", "provedor"] as const;
export const validMailDeliveryActor = validPendingEmailActor;
export const mailDeliveryCount = pendingEmailCount;
export const mailDeliveryTimestamp = pendingEmailTimestamp;
const invalid = { ok: false, error: "invalid" } as const;
/** No silent clamp or truncation. Page/limit remain independent of filter scope. */
export function mailDeliverySearch(sp: URLSearchParams): { ok: true; options: MailDeliveryOptions; format: "json" | "csv" } | typeof invalid {
  if (sp.toString().length > 16384) return invalid;
  const filters: MailDeliveryFilters = {};
  for (const [key, raw] of sp) {
    if (![...MAIL_DELIVERY_FILTER_KEYS, "pagina", "limite", "formato"].includes(key) || sp.getAll(key).length !== 1 || /[\u0000-\u001f\u007f]/.test(raw)) return invalid;
    if (!MAIL_DELIVERY_FILTER_KEYS.includes(key as typeof MAIL_DELIVERY_FILTER_KEYS[number]) || raw === "") continue;
    if (raw !== raw.trim() || raw.length > (key === "busca" ? 80 : key === "provedor" ? 100 : 100)) return invalid;
    if (key === "situacao" && !MAIL_DELIVERY_STATES.includes(raw as MailDeliveryState) || key === "cadastro" && !["aguardando", "confirmado", "sem"].includes(raw) || key === "categoria" && !["servidor", "apoiador", "estrangeiro"].includes(raw)) return invalid;
    (filters as Record<string, string>)[key] = raw;
  }
  const number = (key: string, fallback: number) => { const raw = sp.get(key); if (raw === null) return fallback; if (!/^[1-9][0-9]{0,15}$/.test(raw)) return null; const n = Number(raw); return Number.isSafeInteger(n) ? n : null; };
  const page = number("pagina", 1), limit = number("limite", 50), format = sp.get("formato") ?? "json";
  if (page === null || limit === null || limit > 200 || !Number.isSafeInteger((page - 1) * limit) || !["json", "csv"].includes(format)) return invalid;
  return { ok: true, options: { filters, page, limit }, format: format as "json" | "csv" };
}
export function mailDeliveryQuery(options: MailDeliveryOptions): string {
  const sp = new URLSearchParams();
  for (const key of MAIL_DELIVERY_FILTER_KEYS) { const value = options.filters?.[key]; if (value !== undefined && value !== "") sp.set(key, value); }
  if (options.page !== undefined) sp.set("pagina", String(options.page)); if (options.limit !== undefined) sp.set("limite", String(options.limit));
  return sp.toString();
}
export function mailDeliveryMatches(row: MailDeliveryRow, filters: MailDeliveryFilters = {}): boolean {
  const normalize = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return (!filters.busca || normalize(row.nome + " " + row.email).includes(normalize(filters.busca))) && (!filters.situacao || row.situacao === filters.situacao) && (!filters.cadastro || (filters.cadastro === "sem" ? row.rowKind === "unregistered_address" : row.cadastro === filters.cadastro)) && (!filters.categoria || row.categoria === filters.categoria) && (!filters.provedor || row.evidence.providersAll.includes(filters.provedor));
}
