import type { A1SigningIntent } from "@/lib/a1-job-view";

export type A1UiContext = { batchId: number; actorScope?: string; ownArtifactId?: string | null; documentRevision?: string | null };
type Reader = Pick<Storage, "getItem">;
type Writer = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const a1UiUuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const a1UiModeValid = (context: A1UiContext) => Number.isInteger(context.batchId) && context.batchId > 0 && context.batchId <= 2147483647 && (context.ownArtifactId == null || a1UiUuid(context.ownArtifactId)) && (context.documentRevision == null || hash(context.documentRevision));
function baseKey(context: A1UiContext) {
  if (!a1UiModeValid(context) || typeof context.actorScope !== "string" || !/^[1-9][0-9]{0,9}:[1-9][0-9]{0,9}$/.test(context.actorScope) || context.actorScope.split(":").some(value => Number(value) > 2147483647)) return null;
  return `a1-ui:${context.actorScope}:${context.batchId}:${context.ownArtifactId ?? "original"}:${context.documentRevision ?? "current"}`;
}
export function a1UiIntent(value: unknown, context: A1UiContext): A1SigningIntent | null {
  if (!a1UiModeValid(context) || !value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length || Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !("value" in d))) return null;
  const v = value as Record<string, unknown>;
  const keys = ["batchId", "expectedDocumentVersion", "expectedPolicyRevision", "requestId", ...(context.ownArtifactId == null ? [] : ["expectedOwnArtifactId"])].sort().join(",");
  if (Object.keys(v).sort().join(",") !== keys || v.batchId !== context.batchId || !a1UiUuid(v.requestId) || !hash(v.expectedDocumentVersion) || !Number.isSafeInteger(v.expectedPolicyRevision) || (v.expectedPolicyRevision as number) < 1 || (v.expectedOwnArtifactId ?? null) !== (context.ownArtifactId ?? null)) return null;
  return { batchId: context.batchId, requestId: v.requestId, expectedDocumentVersion: v.expectedDocumentVersion, expectedPolicyRevision: v.expectedPolicyRevision as number, ...(context.ownArtifactId == null ? {} : { expectedOwnArtifactId: context.ownArtifactId }) };
}
function intentKey(context: A1UiContext, value: A1SigningIntent) {
  const base = baseKey(context), parsed = a1UiIntent(value, context);
  return base && parsed ? `${base}:doc:${parsed.expectedDocumentVersion}:policy:${parsed.expectedPolicyRevision}` : null;
}
export function rememberA1UiIntent(storage: Writer, context: A1UiContext, value: A1SigningIntent): boolean {
  const base = baseKey(context), key = intentKey(context, value), parsed = a1UiIntent(value, context);
  if (!base || !key || !parsed) return false;
  try { storage.setItem(key, JSON.stringify(parsed)); storage.setItem(`${base}:selected`, key); return true; } catch { return false; }
}
export function restoreA1UiIntent(storage: Reader, context: A1UiContext): A1SigningIntent | null {
  const base = baseKey(context); if (!base) return null;
  try {
    const selected = storage.getItem(`${base}:selected`);
    if (!selected || selected.length > 512 || !selected.startsWith(`${base}:doc:`)) return null;
    const raw = storage.getItem(selected); if (!raw || raw.length > 1024) return null;
    const parsed = a1UiIntent(JSON.parse(raw), context);
    return parsed && intentKey(context, parsed) === selected ? parsed : null;
  } catch { return null; }
}
export const a1UiJobMatchesMode = (job: { ownArtifactId?: string | null } | null | undefined, context: A1UiContext) => !!job && a1UiModeValid(context) && (job.ownArtifactId ?? null) === (context.ownArtifactId ?? null);
