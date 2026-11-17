/** Browser-only credential transport. Each invocation performs exactly one POST. */
export type PresidentCredentials = { token: string; password: string };
export type PresidentDocument = { batchId: number; seq: number; kind: "partial" | "final"; documentVersion: string; sha256: string; byteLength: number };
export type PresidentReceipt = { receiptId: string; confirmedAt: string; assurance: "own-confirmation"; icpBrasil: false; govBr: false };
export type PresidentState = { state: "issued" | "verifying" | "consumed"; canConfirm: boolean; expiresAt: string; document: PresidentDocument; receipt: PresidentReceipt | null };
export type PresidentFailure = { ok: false; kind: "http" | "invalid" | "uncertain"; status?: number };
type Result<T> = { ok: true; data: T } | PresidentFailure;
const MAX_PDF = 25 * 1024 * 1024;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const time = (value: unknown): value is string => typeof value === "string" && value.length <= 30 && Number.isFinite(Date.parse(value));
const id = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0 && (value as number) <= 2147483647;
export function validPresidentCredentials(value: PresidentCredentials) {
  return /^[A-Za-z0-9_-]{43}$/.test(value.token) && /^[A-Za-z0-9_-]{12}$/.test(value.password);
}
export function parsePresidentState(value: unknown): PresidentState | null {
  if (!object(value) || value.ok !== true || !["issued", "verifying", "consumed"].includes(String(value.state)) || typeof value.canConfirm !== "boolean" || !time(value.expiresAt) || !object(value.document)) return null;
  const d = value.document;
  if (!id(d.batchId) || !id(d.seq) || !["partial", "final"].includes(String(d.kind)) || !hash(d.documentVersion) || !hash(d.sha256) || !Number.isInteger(d.byteLength) || (d.byteLength as number) < 8 || (d.byteLength as number) > MAX_PDF) return null;
  let receipt: PresidentReceipt | null = null;
  if (value.state === "consumed") {
    const r = value.receipt;
    if (value.canConfirm || !object(r) || !uuid(r.receiptId) || !time(r.confirmedAt) || r.assurance !== "own-confirmation" || r.icpBrasil !== false || r.govBr !== false) return null;
    receipt = { receiptId: r.receiptId, confirmedAt: r.confirmedAt, assurance: "own-confirmation", icpBrasil: false, govBr: false };
  } else if (value.receipt !== null) return null;
  return { state: value.state as PresidentState["state"], canConfirm: value.canConfirm, expiresAt: value.expiresAt, document: { batchId: d.batchId, seq: d.seq, kind: d.kind as PresidentDocument["kind"], documentVersion: d.documentVersion, sha256: d.sha256, byteLength: d.byteLength as number }, receipt };
}
export function samePresidentDocument(a: PresidentDocument, b: PresidentDocument) {
  return a.batchId === b.batchId && a.seq === b.seq && a.kind === b.kind && a.documentVersion === b.documentVersion && a.sha256 === b.sha256 && a.byteLength === b.byteLength;
}
export function parsePresidentConfirmation(value: unknown): Pick<PresidentReceipt, "receiptId" | "assurance" | "icpBrasil" | "govBr"> | null {
  if (!object(value) || value.ok !== true || !uuid(value.receiptId) || value.assurance !== "own-confirmation" || value.icpBrasil !== false || value.govBr !== false) return null;
  return { receiptId: value.receiptId, assurance: "own-confirmation", icpBrasil: false, govBr: false };
}

async function limitedPost<T>(path: string, body: unknown, maximum: number, decode: (bytes: Uint8Array, response: Response) => Promise<T | null>, transport: typeof fetch, timeoutMs: number): Promise<Result<T>> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const job = async (): Promise<Result<T>> => {
    try {
      const response = await transport(path, { method: "POST", credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok) { await response.body?.cancel().catch(() => {}); return { ok: false, kind: "http", status: response.status }; }
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) { await response.body?.cancel().catch(() => {}); return { ok: false, kind: "invalid" }; }
      if (!response.body) return { ok: false, kind: "invalid" };
      reader = response.body.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > maximum) { await reader.cancel().catch(() => {}); return { ok: false, kind: "invalid" }; }
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const value = await decode(bytes, response);
      return value === null ? { ok: false, kind: "invalid" } : { ok: true, data: value };
    } catch { return { ok: false, kind: "uncertain" }; }
  };
  try {
    const deadline = new Promise<PresidentFailure>(resolve => { timer = setTimeout(() => { controller.abort(); void reader?.cancel().catch(() => {}); resolve({ ok: false, kind: "uncertain" }); }, Math.min(60_000, Math.max(1, timeoutMs))); });
    return await Promise.race([job(), deadline]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
export function presidentJsonRequest(path: "/api/presidente/estado" | "/api/presidente/confirmar", body: unknown, transport: typeof fetch = fetch, timeoutMs = 30_000): Promise<Result<unknown>> {
  return limitedPost(path, body, 16 * 1024, async (bytes, response) => {
    if ((response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "application/json") return null;
    try { const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); return object(value) ? value : null; } catch { return null; }
  }, transport, timeoutMs);
}
export function presidentPdfRequest(credentials: PresidentCredentials, expected: PresidentDocument, transport: typeof fetch = fetch, timeoutMs = 30_000): Promise<Result<Uint8Array>> {
  return limitedPost("/api/presidente/documento", credentials, MAX_PDF, async (bytes, response) => {
    if ((response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "application/pdf" || response.headers.get("x-document-version") !== expected.documentVersion || response.headers.get("x-document-sha256") !== expected.sha256 || bytes.byteLength !== expected.byteLength || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return null;
    const digest = [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer))].map(n => n.toString(16).padStart(2, "0")).join("");
    return digest === expected.sha256 ? bytes : null;
  }, transport, timeoutMs);
}
