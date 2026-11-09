import { isValidCpf } from "./cpf";

export type PresidentAccount = { id: number; nome: string; email: string };
export type PresidentProfile = { revision: number; responsibleId: number; enabled: boolean; hasCpf: boolean; hasWhatsapp: boolean };
export type PresidentProfileDraft = { responsibleId: string; cpf: string; whatsapp: string; whatsappMode: "keep" | "replace" | "remove"; enabled: boolean; expectedRevision: number };
export type ProfileError = "auth" | "stepup" | "forbidden" | "parameters" | "conflict" | "unavailable";
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : null;
const validId = (value: unknown): value is number => Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2147483647;

/** Explicit client DTO: never spread a user record or a stored profile. */
export function presidentAccounts(users: { id: number; nome: string; email: string; ativo: boolean }[]): PresidentAccount[] {
  return users.filter(user => user.ativo && validId(user.id)).map(({ id, nome, email }) => ({ id, nome, email }));
}

export function parsePresidentProfile(value: unknown): { profile: PresidentProfile | null } | null {
  const result = object(value);
  if (result?.ok !== true) return null;
  if (result.profile === null) return { profile: null };
  const p = object(result.profile);
  if (!p || !validId(p.revision) || !validId(p.responsibleId) || typeof p.enabled !== "boolean" || typeof p.hasCpf !== "boolean" || typeof p.hasWhatsapp !== "boolean") return null;
  return { profile: { revision: p.revision, responsibleId: p.responsibleId, enabled: p.enabled, hasCpf: p.hasCpf, hasWhatsapp: p.hasWhatsapp } };
}

export function initialPresidentProfile(profile: PresidentProfile | null, accounts: PresidentAccount[]): PresidentProfileDraft {
  return { responsibleId: profile && accounts.some(account => account.id === profile.responsibleId) ? String(profile.responsibleId) : "", cpf: "", whatsapp: "", whatsappMode: "keep", enabled: profile?.enabled ?? false, expectedRevision: profile?.revision ?? 0 };
}

export function presidentProfilePayload(draft: PresidentProfileDraft, profile: PresidentProfile | null, accounts: PresidentAccount[]) {
  const responsibleId = Number(draft.responsibleId), same = responsibleId === profile?.responsibleId;
  if (!/^[1-9][0-9]*$/.test(draft.responsibleId) || !validId(responsibleId) || !accounts.some(account => account.id === responsibleId) || draft.expectedRevision !== (profile?.revision ?? 0) || draft.expectedRevision >= 2147483647) return null;
  const cpf = draft.cpf.trim(), whatsapp = draft.whatsapp.trim();
  if (cpf ? cpf.length > 20 || !isValidCpf(cpf) : !same || !profile?.hasCpf) return null;
  if (draft.whatsappMode === "keep" && profile && !same) return null;
  if (draft.whatsappMode === "replace" && !/^\+[1-9][0-9]{7,14}$/.test(whatsapp)) return null;
  if (!["keep", "replace", "remove"].includes(draft.whatsappMode)) return null;
  return { responsibleId, enabled: draft.enabled, expectedRevision: draft.expectedRevision, ...(cpf ? { cpf } : {}), ...(draft.whatsappMode === "replace" ? { whatsapp } : draft.whatsappMode === "remove" ? { whatsapp: "" } : {}) };
}

async function responseError(response: Response): Promise<ProfileError> {
  if (response.status === 401) return "auth";
  if (response.status === 403) { const data = object(await response.json().catch(() => null)); return data?.erro === "stepup" ? "stepup" : "forbidden"; }
  return response.status === 409 ? "conflict" : response.status === 400 ? "parameters" : "unavailable";
}

export async function loadPresidentProfile(fetcher: typeof fetch, signal?: AbortSignal): Promise<{ ok: true; profile: PresidentProfile | null } | { ok: false; error: ProfileError }> {
  try {
    const response = await fetcher("/api/admin/presidente/perfil", { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "manual", signal });
    if (!response.ok) return { ok: false, error: await responseError(response) };
    const parsed = parsePresidentProfile(await response.json());
    return parsed ? { ok: true, ...parsed } : { ok: false, error: "unavailable" };
  } catch { return { ok: false, error: "unavailable" }; }
}

/** Does not mutate the draft or advance CAS on rejection, timeout or conflict. */
export async function savePresidentProfile(fetcher: typeof fetch, draft: PresidentProfileDraft, profile: PresidentProfile | null, accounts: PresidentAccount[], signal?: AbortSignal): Promise<{ ok: true; profile: PresidentProfile } | { ok: false; error: ProfileError }> {
  const payload = presidentProfilePayload(draft, profile, accounts);
  if (!payload) return { ok: false, error: "parameters" };
  try {
    const response = await fetcher("/api/admin/presidente/perfil", { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "manual", referrerPolicy: "no-referrer", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal });
    if (!response.ok) return { ok: false, error: await responseError(response) };
    const result = object(await response.json());
    if (result?.ok !== true || result.revision !== draft.expectedRevision + 1) return { ok: false, error: "unavailable" };
    return { ok: true, profile: { revision: result.revision as number, responsibleId: payload.responsibleId, enabled: payload.enabled, hasCpf: true, hasWhatsapp: draft.whatsappMode === "keep" ? profile?.hasWhatsapp ?? false : draft.whatsappMode === "replace" } };
  } catch { return { ok: false, error: "unavailable" }; }
}
