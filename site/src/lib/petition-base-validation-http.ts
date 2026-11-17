/** Server-internal adapter transport. It does not select a validator or establish signature validity. */
export async function postBoundedValidationPdf(input: { url: string; token: string | null; bytes: Buffer }, fetcher: typeof fetch = fetch, timeoutMs = 30_000): Promise<unknown | null> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) return null;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); void reader?.cancel().catch(() => {}); reject(new Error("validation_deadline")); }, timeoutMs);
  });
  const run = async () => {
    const response = await fetcher(input.url, {
      method: "POST", headers: { "content-type": "application/pdf", accept: "application/json", ...(input.token ? { authorization: `Bearer ${input.token}` } : {}) },
      body: new Uint8Array(input.bytes), signal: controller.signal, redirect: "error", cache: "no-store",
    });
    const length = response.headers.get("content-length");
    if (controller.signal.aborted || !response.ok || !/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "") || length !== null && (!/^[0-9]+$/.test(length) || Number(length) > 65_536)) {
      void response.body?.cancel().catch(() => {}); return null;
    }
    reader = response.body?.getReader(); if (!reader) return null;
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const chunk = await reader.read(); if (controller.signal.aborted) return null; if (chunk.done) break;
      size += chunk.value.byteLength; if (size > 65_536) return null; chunks.push(chunk.value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)));
  };
  try { return await Promise.race([run(), deadline]); } catch { return null; }
  finally { if (timer !== undefined) clearTimeout(timer); void reader?.cancel().catch(() => {}); }
}
