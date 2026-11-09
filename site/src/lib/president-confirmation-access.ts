import { postPresidentRead } from "./president-confirmation-view";

type Credentials = { token: string; password: string };
export type PresidentDocumentView = { batchId: number; seq: number; kind: "partial" | "final"; documentVersion: string; sha256: string; byteLength: number };
export type PresidentReceiptView = { receiptId: string; confirmedAt: string; assurance: "own-confirmation"; icpBrasil: false; govBr: false };
export type PresidentAccessView = { state: "issued" | "verifying" | "consumed"; expiresAt: string; canConfirm: boolean; document: PresidentDocumentView; receipt: PresidentReceiptView | null };
export type PresidentAccessResult = { kind: "available"; value: PresidentAccessView } | { kind: "rejected" | "uncertain" };
export type PresidentPdfResult = { kind: "available"; pdf: Blob; documentVersion: string; serverState: "issued" | "verifying"; canConfirm: boolean } | { kind: "confirmed"; documentVersion: string; receiptId: string } | { kind: "rejected" | "uncertain" };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is number => Number.isInteger(v) && Number(v) > 0 && Number(v) <= 2147483647;
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && v.length <= 35 && Number.isFinite(Date.parse(v));
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);

/** Picks only the real server contract, not profile data or opaque extra fields. */
export function presidentAccessView(body: unknown): PresidentAccessView | null {
  if (!record(body) || body.ok !== true || typeof body.state !== "string" || !["issued", "verifying", "consumed"].includes(body.state) || !date(body.expiresAt) || typeof body.canConfirm !== "boolean" || !record(body.document)) return null;
  const doc = body.document;
  if (!id(doc.batchId) || !id(doc.seq) || typeof doc.kind !== "string" || !["partial", "final"].includes(doc.kind) || !digest(doc.documentVersion) || !digest(doc.sha256) || !Number.isSafeInteger(doc.byteLength) || Number(doc.byteLength) <= 0) return null;
  let receipt: PresidentReceiptView | null = null;
  if (body.state === "consumed") {
    const r = body.receipt;
    if (body.canConfirm || !record(r) || !uuid(r.receiptId) || !date(r.confirmedAt) || r.assurance !== "own-confirmation" || r.icpBrasil !== false || r.govBr !== false) return null;
    receipt = { receiptId: r.receiptId, confirmedAt: r.confirmedAt, assurance: "own-confirmation", icpBrasil: false, govBr: false };
  } else if (body.receipt !== null) return null;
  return { state: body.state as PresidentAccessView["state"], expiresAt: body.expiresAt, canConfirm: body.canConfirm, document: { batchId: doc.batchId, seq: doc.seq, kind: doc.kind as "partial" | "final", documentVersion: doc.documentVersion, sha256: doc.sha256, byteLength: Number(doc.byteLength) }, receipt };
}

async function boundedBytes(response: Response, maximum: number): Promise<Uint8Array | null> {
  const reader = response.body?.getReader(); if (!reader) return null;
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > maximum) { await reader.cancel(); return null; } chunks.push(part.value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
  } finally { reader.releaseLock(); }
}
export async function readPresidentAccess(credentials: Credentials, transport: typeof fetch): Promise<PresidentAccessResult> {
  try {
    const read = await postPresidentRead("estado", credentials, transport); if (read.kind !== "received") return read;
    if (read.response.status !== 200 || !/^application\/json(?:;|$)/i.test(read.response.headers.get("content-type") ?? "")) return { kind: "uncertain" };
    const bytes = await boundedBytes(read.response, 16 * 1024); if (!bytes) return { kind: "uncertain" };
    const result = presidentAccessView(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    return result ? { kind: "available", value: result } : { kind: "uncertain" };
  } catch { return { kind: "uncertain" }; }
}
async function browserDigest(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.length); copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, "0")).join("");
}
/** The PDF is exposed to the viewer only after exact version, byte length and hash match. */
export async function loadPresidentPdf(credentials: Credentials, transport: typeof fetch, sha256: (bytes: Uint8Array) => Promise<string> = browserDigest): Promise<PresidentPdfResult> {
  try {
    const access = await readPresidentAccess(credentials, transport); if (access.kind !== "available") return access;
    const { document, receipt, state } = access.value;
    if (state === "consumed" && receipt) return { kind: "confirmed", documentVersion: document.documentVersion, receiptId: receipt.receiptId };
    const read = await postPresidentRead("documento", credentials, transport); if (read.kind !== "received") return read;
    const response = read.response;
    if (response.status !== 200 || (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "application/pdf" || response.headers.get("x-document-version") !== document.documentVersion || response.headers.get("x-document-sha256") !== document.sha256) return { kind: "uncertain" };
    const length = response.headers.get("content-length"), encoding = response.headers.get("content-encoding"); if ((!encoding || encoding.trim().toLowerCase() === "identity") && length !== null && (!/^[0-9]+$/.test(length) || Number(length) !== document.byteLength)) return { kind: "uncertain" };
    const bytes = await boundedBytes(response, document.byteLength);
    if (!bytes || bytes.length !== document.byteLength || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-" || await sha256(bytes) !== document.sha256) return { kind: "uncertain" };
    const safe = new Uint8Array(bytes.length); safe.set(bytes);
    return { kind: "available", pdf: new Blob([safe.buffer], { type: "application/pdf" }), documentVersion: document.documentVersion, serverState: state as "issued" | "verifying", canConfirm: access.value.canConfirm };
  } catch { return { kind: "uncertain" }; }
}
