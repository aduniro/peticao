/** Only an opaque provider identifier, never a response body, token or transport credentials. */
export type TransportReceipt = { providerId?: string; accountScope?: string };
export function providerId(raw: unknown): string | undefined {
  return typeof raw === "string" && /^[A-Za-z0-9_.@+<>=:/-]{1,200}$/.test(raw) ? raw : undefined;
}
export function receiptId(raw: unknown) {
  try { return raw && typeof raw === "object" ? providerId((raw as TransportReceipt).providerId) : undefined; } catch { return undefined; }
}
/** SMTP's locally generated Message-ID is deliberately not considered a provider receipt. */
export function sesReceipt(response: unknown) {
  if (typeof response !== "string") return undefined;
  const match = /^250 Ok ([0-9a-f]{16}-[0-9a-f-]{30,90})$/i.exec(response.trim());
  return providerId(match?.[1]);
}
export function mailrelayReceipt(raw: unknown, recipient: string) {
  try {
    if (!Array.isArray(raw) || raw.length !== 1) return undefined;
    const row = raw[0];
    if (!row || typeof row !== "object" || typeof row.email !== "string" || row.email.toLowerCase() !== recipient.toLowerCase() || !Number.isSafeInteger(row.id) || row.id < 1) return undefined;
    return String(row.id);
  } catch { return undefined; }
}
export function smtpInfoReceipt(raw: unknown) {
  try { return raw && typeof raw === "object" ? sesReceipt((raw as {response?:unknown}).response) : undefined; } catch { return undefined; }
}
export function mailersendReceipt(response: Response) {
  try { return providerId(response.headers.get("x-message-id")); } catch { return undefined; }
}
/** Receipt parsing is best-effort after known HTTP acceptance: it must never initiate failover. */
export async function receiptJson(response: Response, maximum = 16384, timeoutMs = 1000): Promise<unknown> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, timer: ReturnType<typeof setTimeout> | undefined, complete = false;
  try {
    if (!response.body) return undefined;
    reader = response.body.getReader();
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("receipt_timeout")), timeoutMs); });
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk.done) { complete = true; break; }
      length += chunk.value.length; if (length > maximum) return undefined; chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return undefined; }
  finally {
    if (timer) clearTimeout(timer);
    if (reader) { if (!complete) void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch { /* A timed-out read is not a send failure. */ } }
  }
}
export function objectReceiptId(raw: unknown, field: "messageId" | "id") {
  try { return raw && typeof raw === "object" ? providerId((raw as Record<string, unknown>)[field]) : undefined; } catch { return undefined; }
}
