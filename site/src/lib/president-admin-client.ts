/** Browser-only admin transport. One bounded request per explicit invocation; no retry. */
export type PresidentAdminResult = { ok: true; data: unknown } | { ok: false; kind: "http" | "invalid" | "uncertain"; status?: number };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export async function presidentAdminRequest(path: string, method: "GET" | "POST", body?: unknown, transport: typeof fetch = fetch, timeoutMs = 30_000): Promise<PresidentAdminResult> {
  const allowed = path === "/api/admin/presidente/perfil" || method === "POST" && path === "/api/admin/presidente/desafio" || method === "GET" && path.startsWith("/api/admin/presidente/desafio?requestId=") && UUID.test(path.slice("/api/admin/presidente/desafio?requestId=".length));
  if (!["GET", "POST"].includes(method) || !allowed || method === "GET" && body !== undefined) return { ok: false, kind: "invalid" };
  let encoded: string | undefined;
  try { encoded = body === undefined ? undefined : JSON.stringify(body); } catch { return { ok: false, kind: "invalid" }; }
  if (encoded !== undefined && new TextEncoder().encode(encoded).byteLength > 2048) return { ok: false, kind: "invalid" };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const job = async (): Promise<PresidentAdminResult> => {
    try {
      const response = await transport(path, { method, credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", headers: { "content-type": "application/json" }, body: encoded, signal: controller.signal });
      if (!response.ok) { await response.body?.cancel().catch(() => {}); return { ok: false, kind: "http", status: response.status }; }
      if ((response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "application/json") { await response.body?.cancel().catch(() => {}); return { ok: false, kind: "invalid" }; }
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > 16384) || !response.body) { await response.body?.cancel().catch(() => {}); return { ok: false, kind: "invalid" }; }
      reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 16384) { await reader.cancel().catch(() => {}); return { ok: false, kind: "invalid" }; }
        chunks.push(chunk.value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      try {
        const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        return data && typeof data === "object" && !Array.isArray(data) ? { ok: true, data } : { ok: false, kind: "invalid" };
      } catch { return { ok: false, kind: "invalid" }; }
    } catch { return { ok: false, kind: "uncertain" }; }
    finally { try { reader?.releaseLock(); } catch { /* A timed-out reader may still be cancelling. */ } }
  };
  try {
    const deadline = new Promise<PresidentAdminResult>(resolve => { timer = setTimeout(() => { controller.abort(); void reader?.cancel().catch(() => {}); resolve({ ok: false, kind: "uncertain" }); }, Math.min(60_000, Math.max(1, timeoutMs))); });
    return await Promise.race([job(), deadline]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
