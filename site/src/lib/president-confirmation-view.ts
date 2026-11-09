import { isValidCpf, onlyDigits } from "./cpf";
import { normalizeRegistryBirth, parseBirth } from "./birth";

/** Client-only data contract for the existing v1 API. No persistence or telemetry. */
export type PresidentFields = { password: string; cpf: string; birthDate: string };
export type ConfirmationInput = PresidentFields & { token: string };
export type ConfirmationOutcome = { kind: "confirmed"; receiptId: string } | { kind: "rejected" } | { kind: "uncertain" };
export type ConfirmationState = { phase: "idle" | "submitting" | "confirmed" | "rejected" | "uncertain"; requestId: number; receiptId?: string };
export type ConfirmationEvent = { type: "begin"; requestId: number } | { type: "result"; requestId: number; result: ConfirmationOutcome };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export const isPresidentToken = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);

export function presidentFieldErrors(fields: PresidentFields, today = new Date()) {
  const errors: Partial<Record<keyof PresidentFields, "invalid">> = {};
  if (!/^[A-Za-z0-9_-]{12}$/.test(fields.password)) errors.password = "invalid";
  if (fields.cpf.length > 20 || !/^[0-9.\s-]+$/.test(fields.cpf) || !isValidCpf(fields.cpf)) errors.cpf = "invalid";
  const birth = fields.birthDate.length <= 10 ? normalizeRegistryBirth(fields.birthDate) : null;
  if (!birth || !parseBirth(birth, 1900, today)) errors.birthDate = "invalid";
  return errors;
}

/** The caller owns ephemeral inputs. Nothing here copies them into status/errors. */
export function confirmationState(state: ConfirmationState, event: ConfirmationEvent): ConfirmationState {
  if (event.type === "begin") {
    if (!["idle", "rejected"].includes(state.phase) || !Number.isSafeInteger(event.requestId) || event.requestId <= state.requestId) return state;
    return { phase: "submitting", requestId: event.requestId };
  }
  if (state.phase !== "submitting" || event.requestId !== state.requestId) return state;
  return event.result.kind === "confirmed"
    ? { phase: "confirmed", requestId: state.requestId, receiptId: event.result.receiptId }
    : { phase: event.result.kind, requestId: state.requestId };
}

export function confirmationOutcome(status: number, body: unknown): ConfirmationOutcome {
  if (status === 200 && record(body) && body.ok === true && typeof body.receiptId === "string" && UUID.test(body.receiptId) && body.assurance === "own-confirmation" && body.icpBrasil === false && body.govBr === false) return { kind: "confirmed", receiptId: body.receiptId };
  if ([400, 403, 413, 415, 429].includes(status) || status === 409 && record(body) && body.ok === false && typeof body.error === "string" && ["parameters", "unavailable"].includes(body.error)) return { kind: "rejected" };
  // A timeout, missing/malformed receipt or unexpected success must be reconciled.
  return { kind: "uncertain" };
}

/** Exactly one POST. There is deliberately no retry, storage, logger or status guess. */
export async function postPresidentConfirmation(input: ConfirmationInput, transport: typeof fetch): Promise<ConfirmationOutcome> {
  if (!isPresidentToken(input.token)) return { kind: "rejected" };
  try {
    const response = await transport("/api/presidente/confirmar", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: input.token, password: input.password, cpf: onlyDigits(input.cpf), birthDate: input.birthDate }) });
    const body: unknown = await response.json().catch(() => null);
    return confirmationOutcome(response.status, body);
  } catch { return { kind: "uncertain" }; }
}

export type IssuedChallengeView = { id: string; token: string; password: string; expiresAt: number; documentVersion: string };
export function issuedChallengeView(body: unknown): IssuedChallengeView | null {
  if (!record(body) || body.ok !== true || typeof body.id !== "string" || !UUID.test(body.id) || !isPresidentToken(body.token) || typeof body.password !== "string" || !/^[A-Za-z0-9_-]{12}$/.test(body.password) || !Number.isSafeInteger(body.expiresAt) || Number(body.expiresAt) <= 0 || Number(body.expiresAt) > 8_640_000_000_000_000 || typeof body.documentVersion !== "string" || !/^[a-f0-9]{64}$/.test(body.documentVersion)) return null;
  return { id: body.id, token: body.token, password: body.password, expiresAt: Number(body.expiresAt), documentVersion: body.documentVersion };
}
export function presidentChallengeLink(origin: string, token: string) {
  if (!isPresidentToken(token)) return null;
  try {
    const base = new URL(origin);
    if (base.origin !== origin || base.username || base.password || base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))) return null;
    return new URL("/assinar-lote/" + token, base).href;
  } catch { return null; }
}


export type PresidentReadResult = { kind: "received"; response: Response } | { kind: "rejected" } | { kind: "uncertain" };
/** Draft adapter for the two read-only POST contracts owned by the server integrator.
 * No CPF/birth is sent; reading never calls the confirmation action. */
export async function postPresidentRead(action: "documento" | "estado", credentials: { token: string; password: string }, transport: typeof fetch): Promise<PresidentReadResult> {
  if (!["documento", "estado"].includes(action) || !isPresidentToken(credentials.token) || !/^[A-Za-z0-9_-]{12}$/.test(credentials.password)) return { kind: "rejected" };
  try {
    const response = await transport("/api/presidente/" + action, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: credentials.token, password: credentials.password }) });
    return response.ok ? { kind: "received", response } : response.status >= 400 && response.status < 500 ? { kind: "rejected" } : { kind: "uncertain" };
  } catch { return { kind: "uncertain" }; }
}
