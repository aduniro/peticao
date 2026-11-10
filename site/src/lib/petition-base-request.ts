/** Browser-safe transport for explicit base/policy operations. Never retries a POST. */
export type BaseHttpResult<T> = { kind: "success"; value: T } | { kind: "rejected"; status: number; error: string } | { kind: "uncertain" };
export type BaseArtifactView = { artifactId: string; sha256: string; byteLength: number; lastValidationId: string | null };
export type BaseSelectionView = { selectionId: string; revision: number; validationId: string; artifactId: string; sha256: string; petitionTextVersion: string };
export type BasePacketView = { packageId: string; batchId: number; ordinal: number; documentVersion: string; selectionId: string; baseArtifactId: string; baseSha256: string; batchSha256: string; packageDigest: string };
export type BaseSelectionIntent = { requestId: string; expectedRevision: number; validationId: string; reviewedSha256: string; expectedTextVersion: string };
export type BasePacketIntent = { requestId: string; batchId: number; expectedDocumentVersion: string; expectedSelectionId: string; expectedPackageRevision: number };
export type BaseReviewView = { batchId: number; documentVersion: string; configured: boolean; canPrepare: boolean; selectionId: string | null; latestPackage: BasePacketView | null };
export type BaseIntentView = { kind: "upload"; artifact: BaseArtifactView } | { kind: "selection"; selection: BaseSelectionView; isCurrent: boolean } | { kind: "package"; package: BasePacketView; isCurrent: boolean };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const id = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0 && Number(v) <= 2147483647;
const revision = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) < 2147483647;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const invalid = { kind: "rejected" as const, status: 400, error: "parameters" };
const uncertain = { kind: "uncertain" as const };
function artifact(raw: unknown): BaseArtifactView | null {
  if (!object(raw) || !uuid(raw.artifactId) || !hash(raw.sha256) || !id(raw.byteLength) || raw.byteLength > 25 * 1024 * 1024 || raw.usableInPackage !== false || raw.lastValidationId != null && !uuid(raw.lastValidationId)) return null;
  return { artifactId: raw.artifactId, sha256: raw.sha256, byteLength: raw.byteLength, lastValidationId: raw.lastValidationId as string | null ?? null };
}
function selection(raw: unknown): BaseSelectionView | null {
  if (!object(raw) || !uuid(raw.selectionId) || !id(raw.revision) || !uuid(raw.validationId) || !uuid(raw.artifactId) || !hash(raw.sha256) || !hash(raw.petitionTextVersion) || raw.usableInPackage !== false) return null;
  return { selectionId: raw.selectionId, revision: raw.revision, validationId: raw.validationId, artifactId: raw.artifactId, sha256: raw.sha256, petitionTextVersion: raw.petitionTextVersion };
}
function packet(raw: unknown, batchId: number): BasePacketView | null {
  if (!object(raw) || !uuid(raw.packageId) || raw.batchId !== batchId || !id(raw.ordinal) || !hash(raw.documentVersion) || !uuid(raw.selectionId) || !uuid(raw.baseArtifactId) || !hash(raw.baseSha256) || !hash(raw.batchSha256) || !hash(raw.packageDigest) || raw.approvalRequired !== true || raw.dispatchAllowed !== false) return null;
  return { packageId: raw.packageId, batchId, ordinal: raw.ordinal, documentVersion: raw.documentVersion, selectionId: raw.selectionId, baseArtifactId: raw.baseArtifactId, baseSha256: raw.baseSha256, batchSha256: raw.batchSha256, packageDigest: raw.packageDigest };
}
async function exchange<T>(path: string, method: "GET" | "POST", body: Record<string, unknown> | FormData | undefined, parse: (raw: Record<string, unknown>) => T | null, fetcher: typeof fetch, timeoutMs: number): Promise<BaseHttpResult<T>> {
  if (!id(timeoutMs) || timeoutMs > 60_000) return invalid;
  const abort = new AbortController(); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); void reader?.cancel().catch(() => {}); reject(new Error("base_deadline")); }, timeoutMs); });
  const work = async (): Promise<BaseHttpResult<T>> => {
    const multipart = body instanceof FormData;
    const response = await fetcher(path, { method, credentials: "same-origin", cache: "no-store", redirect: "error", signal: abort.signal, headers: { accept: "application/json", ...(!multipart && method === "POST" ? { "content-type": "application/json" } : {}) }, ...(method === "POST" ? { body: multipart ? body : JSON.stringify(body) } : {}) });
    if (abort.signal.aborted) { void response.body?.cancel().catch(() => {}); return uncertain; }
    if (!/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) { void response.body?.cancel().catch(() => {}); return uncertain; }
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > 65_536)) { void response.body?.cancel().catch(() => {}); return uncertain; }
    reader = response.body?.getReader(); if (!reader) return uncertain;
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) { const part = await reader.read(); if (abort.signal.aborted) return uncertain; if (part.done) break; length += part.value.byteLength; if (length > 65_536) return uncertain; chunks.push(part.value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); if (!object(raw)) return uncertain;
    if (response.ok && raw.ok === true) { const value = parse(raw); return value === null ? uncertain : { kind: "success", value }; }
    if ([400, 401, 403, 404, 409, 413, 429].includes(response.status) && raw.ok === false) {
      const error = typeof raw.error === "string" && /^[a-z][a-z_]{0,63}$/.test(raw.error) ? raw.error : response.status === 401 ? "authentication_required" : response.status === 403 && raw.erro === "stepup" ? "stepup_required" : "request_rejected";
      return { kind: "rejected", status: response.status, error };
    }
    return uncertain;
  };
  try { return await Promise.race([work(), deadline]); } catch { return uncertain; }
  finally { if (timer !== undefined) clearTimeout(timer); void reader?.cancel().catch(() => {}); }
}
export function readBaseInventory(fetcher: typeof fetch = fetch, timeoutMs = 15_000) {
  return exchange("/api/admin/documentos/base", "GET", undefined, raw => {
    if (!Array.isArray(raw.artifacts) || raw.artifacts.length > 20 || typeof raw.hasMore !== "boolean") return null;
    const artifacts = raw.artifacts.map(artifact); if (artifacts.some(x => x === null) || new Set(artifacts.map(x => x!.artifactId)).size !== artifacts.length) return null;
    return { artifacts: artifacts as BaseArtifactView[], hasMore: raw.hasMore };
  }, fetcher, timeoutMs);
}
export function readBaseSelection(fetcher: typeof fetch = fetch, timeoutMs = 15_000) {
  return exchange("/api/admin/documentos/base/selecao", "GET", undefined, raw => {
    if (raw.selection === null) return { selection: null as BaseSelectionView | null, currentBindingMatches: false };
    const value = selection(raw.selection); return value && typeof raw.currentBindingMatches === "boolean" ? { selection: value, currentBindingMatches: raw.currentBindingMatches } : null;
  }, fetcher, timeoutMs);
}
export function readBasePacketReview(batchId: number, fetcher: typeof fetch = fetch, timeoutMs = 15_000): Promise<BaseHttpResult<BaseReviewView>> {
  if (!id(batchId)) return Promise.resolve(invalid);
  return exchange(`/api/admin/lotes/${batchId}/pacote`, "GET", undefined, raw => {
    if (raw.batchId !== batchId || !hash(raw.documentVersion) || typeof raw.configured !== "boolean" || typeof raw.canPrepare !== "boolean" || raw.selectionId !== null && !uuid(raw.selectionId)) return null;
    const latestPackage = raw.latestPackage === null ? null : packet(raw.latestPackage, batchId); if (raw.latestPackage !== null && !latestPackage) return null;
    return { batchId, documentVersion: raw.documentVersion, configured: raw.configured, canPrepare: raw.canPrepare, selectionId: raw.selectionId as string | null, latestPackage };
  }, fetcher, timeoutMs);
}
export function uploadBase(requestId: string, file: File, expectedSha256: string, fetcher: typeof fetch = fetch, timeoutMs = 45_000): Promise<BaseHttpResult<BaseArtifactView>> {
  if (!uuid(requestId) || !hash(expectedSha256) || !(file instanceof File) || file.size < 16 || file.size > 25 * 1024 * 1024) return Promise.resolve(invalid);
  const form = new FormData(); form.set("requestId", requestId); form.set("file", file);
  return exchange("/api/admin/documentos/base", "POST", form, raw => { const value = artifact(raw); return value && value.sha256 === expectedSha256 && value.byteLength === file.size ? value : null; }, fetcher, timeoutMs);
}
export function validateBase(artifactId: string, expectedSha256: string, fetcher: typeof fetch = fetch, timeoutMs = 45_000) {
  if (!uuid(artifactId) || !hash(expectedSha256)) return Promise.resolve(invalid);
  return exchange(`/api/admin/documentos/base/${artifactId}/validar`, "POST", { expectedSha256 }, raw => uuid(raw.validationId) && raw.artifactId === artifactId && raw.sha256 === expectedSha256 && raw.validationState === "valid" && raw.method === "gov-br-advanced" && raw.usableInPackage === false ? { validationId: raw.validationId, artifactId, sha256: expectedSha256 } : null, fetcher, timeoutMs);
}
export function selectBase(intent: BaseSelectionIntent, fetcher: typeof fetch = fetch, timeoutMs = 15_000) {
  if (!intent || !uuid(intent.requestId) || !revision(intent.expectedRevision) || !uuid(intent.validationId) || !hash(intent.reviewedSha256) || !hash(intent.expectedTextVersion)) return Promise.resolve(invalid);
  return exchange("/api/admin/documentos/base/selecao", "POST", { ...intent }, raw => {
    const value = selection(raw.selection); return value && value.revision === intent.expectedRevision + 1 && value.validationId === intent.validationId && value.sha256 === intent.reviewedSha256 && value.petitionTextVersion === intent.expectedTextVersion && typeof raw.isCurrent === "boolean" ? { selection: value, isCurrent: raw.isCurrent } : null;
  }, fetcher, timeoutMs);
}
export function prepareBasePacket(intent: BasePacketIntent, fetcher: typeof fetch = fetch, timeoutMs = 15_000) {
  if (!intent || !id(intent.batchId) || !uuid(intent.requestId) || !revision(intent.expectedPackageRevision) || !uuid(intent.expectedSelectionId) || !hash(intent.expectedDocumentVersion)) return Promise.resolve(invalid);
  const { batchId, ...body } = intent;
  return exchange(`/api/admin/lotes/${batchId}/pacote`, "POST", body, raw => {
    const value = packet(raw.package, batchId); return value && value.documentVersion === intent.expectedDocumentVersion && value.selectionId === intent.expectedSelectionId && value.ordinal === intent.expectedPackageRevision + 1 && typeof raw.isCurrent === "boolean" ? { package: value, isCurrent: raw.isCurrent } : null;
  }, fetcher, timeoutMs);
}
/** A read is scoped to the original intent, never silently to whichever record is latest. */
export function readBaseIntent(kind: "upload" | "selection" | "package", requestId: string, batchId: number, fetcher: typeof fetch = fetch, timeoutMs = 15_000) {
  if (!uuid(requestId) || !id(batchId) || !["upload", "selection", "package"].includes(kind)) return Promise.resolve(invalid);
  const path = kind === "upload" ? "/api/admin/documentos/base" : kind === "selection" ? "/api/admin/documentos/base/selecao" : `/api/admin/lotes/${batchId}/pacote`;
  return exchange<BaseIntentView>(path + "?requestId=" + encodeURIComponent(requestId), "GET", undefined, raw => {
    if (raw.requestId !== requestId) return null;
    if (kind === "upload") { const value = artifact(raw); return value ? { kind: "upload" as const, artifact: value } : null; }
    if (typeof raw.isCurrent !== "boolean") return null;
    if (kind === "selection") { const value = selection(raw.selection); return value ? { kind: "selection" as const, selection: value, isCurrent: raw.isCurrent } : null; }
    const value = packet(raw.package, batchId); return value ? { kind: "package" as const, package: value, isCurrent: raw.isCurrent } : null;
  }, fetcher, timeoutMs);
}
