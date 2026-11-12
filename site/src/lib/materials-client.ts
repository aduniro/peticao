import type { MaterialContent, MaterialMutation, MaterialVersion } from "./materials-contract";

/** Browser-only structured data. No runtime import from the Node contract or persistence. */
export const MATERIAL_CLIENT_TEMPLATES: readonly MaterialContent["template"][] = Object.freeze(["poster-a4-v1", "flyer-mono-cut-v1", "social-square-v1"] as const);
export const MATERIAL_CLIENT_ASSETS: readonly MaterialContent["assetKey"][] = Object.freeze(["adunir", "adunir-andes", "andes"] as const);
export type MaterialsContext = { actorId: number; actorScope: string; materialId: string | null };
export type MaterialsLibraryPage = { archived: boolean; versions: MaterialVersion[]; nextBefore: string | null };
export type MaterialsHistoryPage = { current: MaterialVersion; versions: MaterialVersion[]; nextBefore: number | null };
export type MaterialsError = "parameters" | "auth" | "forbidden" | "rate_limited" | "body_too_large" | "disabled" | "not_found" | "conflict" | "request_conflict" | "archived" | "unavailable" | "transport" | "timeout" | "protocol" | "obsolete" | "busy" | "recovery_required" | "review_required" | "no_pending";
export type MaterialsResult<T> = { ok: true; value: T } | { ok: false; error: MaterialsError };
export type MaterialsPending = { intent: MaterialMutation; base: MaterialVersion | null };
export type MaterialsReceipt = { requestId: string; version: MaterialVersion; replayed: boolean | null };
export type MaterialsState = {
  context: MaterialsContext; library: MaterialsLibraryPage | null; history: MaterialsHistoryPage | null;
  head: MaterialVersion | null; draft: MaterialContent | null; draftBase: MaterialVersion | null;
  pending: MaterialsPending | null; receipt: MaterialsReceipt | null;
  phase: "idle" | "saving" | "uncertain" | "recovering" | "confirmed" | "conflict" | "rejected";
  needsReview: boolean; error: MaterialsError | null;
  loadingLibrary: boolean; loadingHistory: boolean; libraryError: MaterialsError | null; historyError: MaterialsError | null;
};
export type MaterialsTransport = (input: string, init: RequestInit) => Promise<Response>;
const encoder = new TextEncoder();
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const revision = (v: unknown): v is number => Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 2147483646;
const positiveId = (v: unknown): v is number => Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 2147483647;
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function object(v: unknown): Record<string, unknown> | null {
  try {
    if (!v || typeof v !== "object" || Object.getPrototypeOf(v) !== Object.prototype || Object.getOwnPropertySymbols(v).length) return null;
    const descriptors = Object.getOwnPropertyDescriptors(v);
    if (Object.values(descriptors).some(d => !("value" in d))) return null;
    return Object.fromEntries(Object.entries(descriptors).map(([key, d]) => [key, d.value]));
  } catch { return null; }
}
function array(raw: unknown): unknown[] | null {
  try {
    if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || Object.getOwnPropertySymbols(raw).length) return null;
    const descriptors = Object.getOwnPropertyDescriptors(raw) as unknown as Record<string, PropertyDescriptor>;
    const length = descriptors.length?.value;
    if (!Number.isInteger(length) || length < 0 || length > 50 || Object.keys(descriptors).length !== length + 1) return null;
    const values: unknown[] = [];
    for (let n = 0; n < length; n++) { const d = descriptors[String(n)]; if (!d || !("value" in d)) return null; values.push(d.value); }
    return values;
  } catch { return null; }
}
const exact = (v: Record<string, unknown>, names: string) => Object.keys(v).sort().join(",") === names.split(",").sort().join(",");
const text = (v: unknown, limit: number, required: boolean): v is string => typeof v === "string" && (!required || !!v.trim()) && encoder.encode(v).byteLength <= limit && !/[<>\u0000-\u0008\u000b-\u001f\u007f\ud800-\udfff]/u.test(v);
export function parseMaterialsContent(raw: unknown): MaterialContent | null {
  const v = object(raw);
  if (!v || !exact(v, "template,assetKey,title,body,callToAction,footer") || !MATERIAL_CLIENT_TEMPLATES.includes(v.template as MaterialContent["template"]) || !MATERIAL_CLIENT_ASSETS.includes(v.assetKey as MaterialContent["assetKey"]) || !text(v.title, 240, true) || !text(v.body, v.template === "social-square-v1" ? 1400 : 6000, true) || !text(v.callToAction, 320, true) || !text(v.footer, 600, false)) return null;
  return { template: v.template as MaterialContent["template"], assetKey: v.assetKey as MaterialContent["assetKey"], title: v.title, body: v.body, callToAction: v.callToAction, footer: v.footer };
}
export function parseMaterialsIntent(raw: unknown): MaterialMutation | null {
  const v = object(raw); if (!v || !uuid(v.requestId)) return null;
  if (v.operation === "create" && exact(v, "operation,requestId,content")) {
    const content = parseMaterialsContent(v.content); return content ? { operation: "create", requestId: v.requestId, content } : null;
  }
  if (!uuid(v.materialId) || !revision(v.expectedRevision)) return null;
  if (v.operation === "archive" && exact(v, "operation,requestId,materialId,expectedRevision")) return { operation: "archive", requestId: v.requestId, materialId: v.materialId, expectedRevision: v.expectedRevision };
  if (v.operation === "revise" && exact(v, "operation,requestId,materialId,expectedRevision,content")) {
    const content = parseMaterialsContent(v.content); return content ? { operation: "revise", requestId: v.requestId, materialId: v.materialId, expectedRevision: v.expectedRevision, content } : null;
  }
  return null;
}
export function parseMaterialsVersion(raw: unknown, materialId?: string): MaterialVersion | null {
  const v = object(raw); if (!v || !exact(v, "id,materialId,revision,content,sha256,archived,authorId,createdAt")) return null;
  const content = parseMaterialsContent(v.content);
  if (!uuid(v.id) || !uuid(v.materialId) || materialId !== undefined && v.materialId !== materialId || !revision(v.revision) || !content || !hash(v.sha256) || typeof v.archived !== "boolean" || !positiveId(v.authorId) || typeof v.createdAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.createdAt) || !Number.isFinite(Date.parse(v.createdAt))) return null;
  return { id: v.id, materialId: v.materialId, revision: v.revision, content, sha256: v.sha256, archived: v.archived, authorId: v.authorId, createdAt: v.createdAt };
}
export function parseMaterialsLibrary(raw: unknown, archived: boolean, before: string | null): MaterialsLibraryPage | null {
  const v = object(raw), rows = v && array(v.versions); if (!rows || typeof archived !== "boolean" || before !== null && !uuid(before) || !v || !exact(v, "ok,versions,nextBefore") || v.ok !== true || v.nextBefore !== null && !uuid(v.nextBefore)) return null;
  const versions: MaterialVersion[] = [], ids = new Set<string>();
  for (const rawVersion of rows) {
    const row = parseMaterialsVersion(rawVersion), previous = versions.at(-1);
    if (!row || row.archived !== archived || before !== null && row.materialId >= before || ids.has(row.id) || versions.some(v => v.materialId === row.materialId) || previous && previous.materialId <= row.materialId) return null;
    ids.add(row.id); versions.push(row);
  }
  if (v.nextBefore !== null && (versions.length !== 50 || v.nextBefore !== versions.at(-1)?.materialId)) return null;
  return { archived, versions, nextBefore: v.nextBefore as string | null };
}
export function parseMaterialsHistory(raw: unknown, materialId: string, before: number | null): MaterialsHistoryPage | null {
  const v = object(raw), rows = v && array(v.versions); if (!rows || !uuid(materialId) || before !== null && !revision(before) || !v || !exact(v, "ok,current,versions,nextBefore") || v.ok !== true || v.nextBefore !== null && !revision(v.nextBefore)) return null;
  const current = parseMaterialsVersion(v.current, materialId); if (!current) return null;
  const versions: MaterialVersion[] = [], ids = new Set<string>();
  for (const rawVersion of rows) {
    const row = parseMaterialsVersion(rawVersion, materialId), previous = versions.at(-1);
    if (!row || row.revision > current.revision || before !== null && row.revision >= before || row.archived && row.revision !== current.revision || ids.has(row.id) || previous && previous.revision <= row.revision || row.revision === current.revision && !same(row, current)) return null;
    ids.add(row.id); versions.push(row);
  }
  if (before === null && (!versions.length || !same(versions[0], current)) || v.nextBefore !== null && (versions.length !== 50 || v.nextBefore !== versions.at(-1)?.revision)) return null;
  return { current, versions, nextBefore: v.nextBefore as number | null };
}
function boundVersion(raw: unknown, pending: MaterialsPending, actorId: number): MaterialVersion | null {
  const version = parseMaterialsVersion(raw), intent = pending.intent;
  if (!version || version.authorId !== actorId) return null;
  if (intent.operation === "create") return version.revision === 1 && !version.archived && same(version.content, intent.content) ? version : null;
  if (!pending.base || version.materialId !== intent.materialId || version.revision !== intent.expectedRevision + 1 || version.id === pending.base.id || version.archived !== (intent.operation === "archive")) return null;
  return intent.operation === "archive" ? same(version.content, pending.base.content) && version.sha256 === pending.base.sha256 ? version : null : same(version.content, intent.content) ? version : null;
}
export function parseMaterialsReceipt(raw: unknown, pending: MaterialsPending, actorId: number, mutation: boolean): MaterialsReceipt | null {
  const v = object(raw); if (!v || !exact(v, mutation ? "ok,replayed,version" : "ok,version") || v.ok !== true || mutation && typeof v.replayed !== "boolean") return null;
  const version = boundVersion(v.version, pending, actorId);
  return version ? { requestId: pending.intent.requestId, version, replayed: mutation ? v.replayed as boolean : null } : null;
}
function parseContext(raw: unknown): MaterialsContext | null {
  const v = object(raw);
  return v && exact(v, "actorId,actorScope,materialId") && positiveId(v.actorId) && typeof v.actorScope === "string" && /^[A-Za-z0-9:._-]{1,160}$/.test(v.actorScope) && (v.materialId === null || uuid(v.materialId)) ? { actorId: v.actorId, actorScope: v.actorScope, materialId: v.materialId as string | null } : null;
}
function emptyState(context: MaterialsContext): MaterialsState {
  return { context, library: null, history: null, head: null, draft: null, draftBase: null, pending: null, receipt: null, phase: "idle", needsReview: false, error: null, loadingLibrary: false, loadingHistory: false, libraryError: null, historyError: null };
}
const failure = <T = never>(error: MaterialsError): MaterialsResult<T> => ({ ok: false, error });
type Wire = { kind: "wire"; status: number; value: unknown } | { kind: "failed"; error: "transport" | "timeout" | "protocol" | "obsolete" };
async function jsonRequest(transport: MaterialsTransport, url: string, init: RequestInit, external: AbortSignal, timeoutMs: number): Promise<Wire> {
  const controller = new AbortController(); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let stop: (value: Wire) => void = () => {};
  const stopped = new Promise<Wire>(resolve => { stop = resolve; });
  const abort = () => { controller.abort(); void reader?.cancel().catch(() => {}); stop({ kind: "failed", error: "obsolete" }); };
  external.addEventListener("abort", abort, { once: true });
  timer = setTimeout(() => { controller.abort(); void reader?.cancel().catch(() => {}); stop({ kind: "failed", error: "timeout" }); }, timeoutMs);
  const job = async (): Promise<Wire> => {
    try {
      if (external.aborted) return { kind: "failed", error: "obsolete" };
      const response = await transport(url, { ...init, signal: controller.signal, credentials: "same-origin", cache: "no-store", redirect: "error" });
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); return { kind: "failed", error: external.aborted ? "obsolete" : "timeout" }; }
      const length = response.headers.get("content-length");
      if (response.redirected || (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "application/json" || !response.body || length !== null && (!/^\d+$/.test(length) || Number(length) > 1048576)) { void response.body?.cancel().catch(() => {}); return { kind: "failed", error: "protocol" }; }
      reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      for (;;) { if (controller.signal.aborted) return { kind: "failed", error: external.aborted ? "obsolete" : "timeout" }; const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 1048576) { void reader.cancel().catch(() => {}); return { kind: "failed", error: "protocol" }; } chunks.push(next.value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      try { return { kind: "wire", status: response.status, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) }; }
      catch { return { kind: "failed", error: "protocol" }; }
    } catch { return { kind: "failed", error: controller.signal.aborted ? external.aborted ? "obsolete" : "timeout" : "transport" }; }
    finally { try { reader?.releaseLock(); } catch { /* A cancelled body may still be settling. */ } }
  };
  try { return await Promise.race([job(), stopped]); }
  finally { clearTimeout(timer); external.removeEventListener("abort", abort); }
}
function wireError(wire: Extract<Wire, { kind: "wire" }>): MaterialsError {
  const v = object(wire.value);
  if (v && exact(v, "ok,erro") && v.ok === false && typeof v.erro === "string" && v.erro.length <= 512) {
    if (wire.status === 401) return "auth"; if (wire.status === 403) return "forbidden"; if (wire.status === 429) return "rate_limited";
  }
  if (!v || !exact(v, "ok,error") || v.ok !== false || typeof v.error !== "string") return "protocol";
  const statuses: Record<string, number> = { parameters: 400, forbidden: 403, not_found: 404, disabled: 409, conflict: 409, request_conflict: 409, archived: 409, unavailable: 503 };
  if (wire.status === 413 && v.error === "parameters") return "body_too_large";
  return statuses[v.error] === wire.status ? v.error as MaterialsError : "protocol";
}

/** In-memory controller for one actor/session/material context. Never retries POST. */
export class MaterialsClient {
  private value: MaterialsState;
  private generation = 0;
  private sequence = { library: 0, history: 0, mutation: 0 };
  private controllers: Partial<Record<keyof MaterialsClient["sequence"], AbortController>> = {};
  private usedRequestIds = new Set<string>();
  private disposed = false;
  // Start sequence of the last successful history read, not a completion count.
  private historyReads = 0;
  private conflictNeedsRead = 0;
  constructor(context: MaterialsContext, private transport: MaterialsTransport = (url, init) => fetch(url, init), private timeoutMs = 15000) {
    const parsed = parseContext(context); if (!parsed || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error("materials_client_parameters");
    this.value = emptyState(parsed);
  }
  getState(): MaterialsState { return copy(this.value); }
  setContext(raw: MaterialsContext): boolean {
    const context = parseContext(raw); if (!context || this.disposed) return false;
    if (same(context, this.value.context)) return true;
    for (const controller of Object.values(this.controllers)) controller?.abort();
    this.controllers = {}; this.generation++; this.usedRequestIds.clear(); this.historyReads = 0; this.conflictNeedsRead = 0; this.value = emptyState(context); return true;
  }
  dispose(): void { for (const controller of Object.values(this.controllers)) controller?.abort(); this.controllers = {}; this.generation++; this.disposed = true; this.value.loadingLibrary = false; this.value.loadingHistory = false; if (this.value.pending) this.value.phase = "uncertain"; }
  setDraft(raw: unknown): boolean { const draft = parseMaterialsContent(raw); if (!draft || this.disposed) return false; this.value.draft = draft; return true; }
  seedHead(raw: unknown): boolean {
    const id = this.value.context.materialId, head = id && parseMaterialsVersion(raw, id); if (!head || this.disposed) return false;
    const old = this.value.head; if (old && (head.revision < old.revision || head.revision === old.revision && !same(head, old))) return false;
    this.value.head = head;
    if (!this.value.draft) { this.value.draft = copy(head.content); this.value.draftBase = copy(head); }
    else if (this.value.draftBase && head.revision > this.value.draftBase.revision) this.value.needsReview = true;
    return true;
  }
  /** Explicit review is possible only after a definitive result; it preserves local text. */
  reviewHead(): boolean {
    if (this.disposed || ["saving", "uncertain", "recovering"].includes(this.value.phase)) return false;
    if (this.value.phase === "conflict" && (this.value.context.materialId === null || this.historyReads < this.conflictNeedsRead)) return false;
    if (this.value.context.materialId !== null && (!this.value.head || this.value.receipt && this.value.head.revision < this.value.receipt.version.revision)) return false;
    this.value.draftBase = copy(this.value.head); this.value.pending = null; this.value.needsReview = false; this.value.error = null; this.value.phase = "idle"; return true;
  }
  private begin(slot: keyof MaterialsClient["sequence"]) {
    this.controllers[slot]?.abort(); const controller = new AbortController(); this.controllers[slot] = controller;
    return { controller, generation: this.generation, sequence: ++this.sequence[slot], slot };
  }
  private current(token: { generation: number; sequence: number; slot: keyof MaterialsClient["sequence"] }): boolean { return !this.disposed && token.generation === this.generation && token.sequence === this.sequence[token.slot]; }
  async loadLibrary(archived = false, before: string | null = null): Promise<MaterialsResult<MaterialsLibraryPage>> {
    if (this.disposed) return failure("obsolete"); if (typeof archived !== "boolean" || before !== null && !uuid(before)) return failure("parameters");
    const token = this.begin("library"); this.value.loadingLibrary = true; this.value.libraryError = null;
    const query = new URLSearchParams({ archived: archived ? "1" : "0" }); if (before) query.set("before", before);
    const wire = await jsonRequest(this.transport, "/api/admin/materiais?" + query, { method: "GET" }, token.controller.signal, this.timeoutMs);
    if (!this.current(token)) return failure("obsolete"); this.value.loadingLibrary = false;
    const page = wire.kind === "wire" && wire.status === 200 ? parseMaterialsLibrary(wire.value, archived, before) : null;
    if (!page) { const error = wire.kind === "failed" ? wire.error : wire.status === 200 ? "protocol" : wireError(wire); this.value.libraryError = error; return failure(error); }
    this.value.library = page; return { ok: true, value: copy(page) };
  }
  async loadHistory(before: number | null = null): Promise<MaterialsResult<MaterialsHistoryPage>> {
    const id = this.value.context.materialId; if (this.disposed) return failure("obsolete"); if (!id || before !== null && !revision(before)) return failure("parameters");
    const token = this.begin("history"); this.value.loadingHistory = true; this.value.historyError = null;
    const wire = await jsonRequest(this.transport, "/api/admin/materiais/" + id + (before === null ? "" : "?before=" + before), { method: "GET" }, token.controller.signal, this.timeoutMs);
    if (!this.current(token)) return failure("obsolete"); this.value.loadingHistory = false;
    const page = wire.kind === "wire" && wire.status === 200 ? parseMaterialsHistory(wire.value, id, before) : null;
    if (!page || !this.seedHead(page.current)) { const error = wire.kind === "failed" ? wire.error : wire.status === 200 ? "protocol" : wireError(wire); this.value.historyError = error; return failure(error); }
    this.historyReads = token.sequence; this.value.history = page; return { ok: true, value: copy(page) };
  }
  async save(raw: unknown): Promise<MaterialsResult<MaterialsReceipt>> {
    if (this.disposed) return failure("obsolete");
    if (["saving", "recovering"].includes(this.value.phase)) return failure("busy");
    if (this.value.pending) return failure("recovery_required");
    if (this.value.needsReview) return failure("review_required");
    const intent = parseMaterialsIntent(raw); if (!intent) return failure("parameters");
    if (this.usedRequestIds.has(intent.requestId)) return failure("request_conflict");
    const id = this.value.context.materialId, head = this.value.head;
    if (intent.operation === "create") { if (id !== null || head || !this.value.draft || !same(intent.content, this.value.draft)) return failure("parameters"); }
    else {
      if (!head || intent.materialId !== id || head.revision !== intent.expectedRevision || this.value.draftBase?.revision !== intent.expectedRevision) return failure("review_required");
      if (head.archived) return failure("archived");
      if (intent.operation === "revise" && (!this.value.draft || !same(intent.content, this.value.draft))) return failure("parameters");
    }
    const token = this.begin("mutation"), pending: MaterialsPending = { intent, base: copy(head) };
    this.usedRequestIds.add(intent.requestId); this.value.pending = pending; this.value.phase = "saving"; this.value.error = null;
    const wire = await jsonRequest(this.transport, "/api/admin/materiais", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(intent) }, token.controller.signal, this.timeoutMs);
    if (!this.current(token)) return failure("obsolete");
    const receipt = wire.kind === "wire" && wire.status === 200 ? parseMaterialsReceipt(wire.value, pending, this.value.context.actorId, true) : null;
    if (receipt) return this.confirm(receipt);
    const error = wire.kind === "failed" ? wire.error : wire.status === 200 ? "protocol" : wireError(wire);
    this.value.error = error; this.value.needsReview = true;
    if (["conflict", "request_conflict", "archived"].includes(error)) this.conflictNeedsRead = this.sequence.history + 1;
    this.value.phase = ["conflict", "request_conflict", "archived"].includes(error) ? "conflict" : ["parameters", "auth", "forbidden", "rate_limited", "body_too_large", "disabled", "not_found"].includes(error) ? "rejected" : "uncertain";
    return failure(error);
  }
  async recoverPending(): Promise<MaterialsResult<MaterialsReceipt>> {
    if (this.disposed) return failure("obsolete");
    if (["saving", "recovering"].includes(this.value.phase)) return failure("busy");
    const pending = this.value.pending; if (!pending) return failure("no_pending");
    const token = this.begin("mutation"); this.value.phase = "recovering"; this.value.error = null;
    const wire = await jsonRequest(this.transport, "/api/admin/materiais/pedidos/" + pending.intent.requestId, { method: "GET" }, token.controller.signal, this.timeoutMs);
    if (!this.current(token)) return failure("obsolete");
    const receipt = wire.kind === "wire" && wire.status === 200 ? parseMaterialsReceipt(wire.value, pending, this.value.context.actorId, false) : null;
    if (receipt) return this.confirm(receipt);
    const error = wire.kind === "failed" ? wire.error : wire.status === 200 ? "protocol" : wireError(wire);
    this.value.error = error; this.value.phase = "uncertain"; return failure(error);
  }
  private confirm(receipt: MaterialsReceipt): MaterialsResult<MaterialsReceipt> {
    this.value.receipt = receipt; this.value.pending = null; this.value.phase = "confirmed"; this.value.error = null; this.value.needsReview = true;
    // A receipt is not the latest head. Only an explicit head/history read may advance it.
    return { ok: true, value: copy(receipt) };
  }
}
