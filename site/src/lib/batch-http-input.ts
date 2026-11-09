import { readLimitedText } from "./http-body";

export const BATCH_PDF_BYTES = 25 * 1024 * 1024;
export const BATCH_MULTIPART_BYTES = BATCH_PDF_BYTES + 64 * 1024;
export function batchId(raw: string): number | null {
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) return null;
  const id = Number(raw); return id <= 2147483647 ? id : null;
}

/** Count actual streamed bytes before multipart parsing; a small header cannot bypass it. */
export async function readBatchMultipart(req: Pick<Request, "body" | "headers">, maximum = BATCH_MULTIPART_BYTES): Promise<{ ok: true; form: FormData } | { ok: false; status: 400 | 413 }> {
  const type = req.headers.get("content-type") ?? "", size = req.headers.get("content-length");
  if (!/^multipart\/form-data(?:;|$)/i.test(type) || size !== null && !/^[0-9]+$/.test(size)) return { ok: false, status: 400 };
  if (size !== null && Number(size) > maximum) return { ok: false, status: 413 };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    reader = req.body?.getReader(); if (!reader) return { ok: false, status: 400 };
    let length = 0; const chunks: Uint8Array[] = [];
    while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength; if (length > maximum) return { ok: false, status: 413 }; chunks.push(chunk.value); }
    const form = await new Response(new Uint8Array(Buffer.concat(chunks)), { headers: { "content-type": type } }).formData();
    return { ok: true, form };
  } catch { return { ok: false, status: 400 }; }
  finally { void reader?.cancel().catch(() => {}); }
}

/** Existing HTML form encoding, also retaining bounded multipart clients. */
export async function readBatchFields(req: Pick<Request, "body" | "headers">) {
  if (/^multipart\/form-data(?:;|$)/i.test(req.headers.get("content-type") ?? "")) return readBatchMultipart(req, 1024);
  const body = await readLimitedText(req, 1024);
  return body.ok ? { ok: true as const, form: new URLSearchParams(body.raw) } : body;
}
