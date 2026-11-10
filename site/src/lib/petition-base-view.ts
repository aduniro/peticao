import type { BaseHttpResult, BaseValidationIntent, BaseIntentView, BasePacketIntent, BaseSelectionIntent } from "./petition-base-request";
export type ValidationRefusal = { status: number; error: string };
export function validationRefusal(result: BaseHttpResult<unknown>): ValidationRefusal | null {
  return result.kind === "rejected" && ((result.status === 400 && result.error === "parameters") || (result.status === 404 && result.error === "not_found") || (result.status === 409 && ["document_conflict", "profile_unavailable", "disabled"].includes(result.error))) ? { status: result.status, error: result.error } : null;
}
/** A refusal is released only when exact readback independently proves no durable reservation. */
export function releaseUnrecordedValidation(pending: BasePending, outcome: BaseHttpResult<unknown> | null): boolean {
  return pending.kind === "validation" && !!pending.refusal && !!validationRefusal({ kind: "rejected", ...pending.refusal }) && outcome?.kind === "rejected" && outcome.status === 404 && outcome.error === "not_found";
}
export type BasePending = { kind: "validation"; input: BaseValidationIntent; refusal?: ValidationRefusal } | { kind: "upload"; requestId: string; sha256: string } | { kind: "selection"; input: BaseSelectionIntent } | { kind: "package"; input: BasePacketIntent };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const revision = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) < 2147483647;
/** Storage contains identities only. It cannot contain files, verifier claims, secrets or an arbitrary URL. */
export function parseBasePending(raw: unknown, batchId: number): BasePending | null {
  if (!Number.isSafeInteger(batchId) || batchId < 1 || batchId > 2147483647 || !object(raw)) return null;
  if (raw.kind === "upload") return Object.keys(raw).sort().join(",") === "kind,requestId,sha256" && uuid(raw.requestId) && hash(raw.sha256) ? { kind: "upload", requestId: raw.requestId, sha256: raw.sha256 } : null;
  const validationKeys = raw.kind === "validation" && Object.keys(raw).sort().join(",") === "input,kind,refusal";
  if ((!validationKeys && Object.keys(raw).sort().join(",") !== "input,kind") || !object(raw.input)) return null;
  let refusal: ValidationRefusal | undefined;
  if (validationKeys) {
    if (!object(raw.refusal) || typeof raw.refusal.status !== "number" || typeof raw.refusal.error !== "string" || Object.keys(raw.refusal).sort().join(",") !== "error,status") return null;
    const parsed = validationRefusal({ kind: "rejected", status: Number(raw.refusal.status), error: String(raw.refusal.error) }); if (!parsed) return null; refusal = parsed;
  }
  const p = raw.input;
  if (!uuid(p.requestId)) return null;
  if (raw.kind === "validation" && Object.keys(p).sort().join(",") === "artifactId,requestId,sha256" && uuid(p.artifactId) && hash(p.sha256)) return { kind: "validation", input: { requestId: p.requestId, artifactId: p.artifactId, sha256: p.sha256 }, ...(refusal ? { refusal } : {}) };
  if (raw.kind === "selection" && Object.keys(p).sort().join(",") === "expectedRevision,expectedTextVersion,requestId,reviewedSha256,validationId" && revision(p.expectedRevision) && hash(p.expectedTextVersion) && uuid(p.validationId) && hash(p.reviewedSha256)) return { kind: "selection", input: { requestId: p.requestId, expectedRevision: Number(p.expectedRevision), expectedTextVersion: p.expectedTextVersion, validationId: p.validationId, reviewedSha256: p.reviewedSha256 } };
  if (raw.kind === "package" && Object.keys(p).sort().join(",") === "batchId,expectedDocumentVersion,expectedPackageRevision,expectedSelectionId,requestId" && p.batchId === batchId && hash(p.expectedDocumentVersion) && revision(p.expectedPackageRevision) && uuid(p.expectedSelectionId)) return { kind: "package", input: { batchId, requestId: p.requestId, expectedDocumentVersion: p.expectedDocumentVersion, expectedPackageRevision: Number(p.expectedPackageRevision), expectedSelectionId: p.expectedSelectionId } };
  return null;
}
export const basePendingRequestId = (p: BasePending) => p.kind === "upload" ? p.requestId : p.input.requestId;
/** Exact matching is independent of the currently selected artifact or whichever GET finishes last. */
export function matchBaseRecovery(pending: BasePending, observed: BaseIntentView): "current" | "obsolete" | "mismatch" | "pending" {
  if (pending.kind === "validation" && observed.kind === "validation") {
    const p = pending.input, v = observed.validation;
    if (p.requestId !== v.requestId || p.artifactId !== v.artifactId || p.sha256 !== v.sha256) return "mismatch";
    return !v.contextMatches ? "obsolete" : v.state === "pending" ? "pending" : v.isCurrent ? "current" : "obsolete";
  }
  if (pending.kind === "upload" && observed.kind === "upload") return observed.artifact.sha256 === pending.sha256 ? "current" : "mismatch";
  if (pending.kind === "selection" && observed.kind === "selection") {
    const p = pending.input, v = observed.selection;
    if (v.validationId !== p.validationId || v.sha256 !== p.reviewedSha256 || v.petitionTextVersion !== p.expectedTextVersion || v.revision !== p.expectedRevision + 1) return "mismatch";
    return observed.isCurrent ? "current" : "obsolete";
  }
  if (pending.kind === "package" && observed.kind === "package") {
    const p = pending.input, v = observed.package;
    if (v.batchId !== p.batchId || v.documentVersion !== p.expectedDocumentVersion || v.selectionId !== p.expectedSelectionId || v.ordinal !== p.expectedPackageRevision + 1) return "mismatch";
    return observed.isCurrent ? "current" : "obsolete";
  }
  return "mismatch";
}
