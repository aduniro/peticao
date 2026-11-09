import { NextRequest, NextResponse } from "next/server";
import { readLimitedText } from "@/lib/http-body";
import { rateLimit } from "@/lib/ratelimit";
import { readSecret } from "@/lib/secrets";
import { INBOUND_MAX_BODY } from "@/lib/mail/inbound-contract";
import { acceptInboundMail } from "@/lib/mail/inbound-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const response = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status, headers: { "cache-control": "no-store" } });

/** Disabled by default. Explicitly configured participant relay, never the owner's
 * Ponte mailbox. HMAC authenticates delivery bytes, not a human or an action request.
 */
export async function POST(req: NextRequest) {
  if (process.env.MAIL_INBOUND_ENABLED !== "1") return response(404, "unavailable");
  const account = process.env.MAIL_INBOUND_ACCOUNT ?? "";
  const recipients = (process.env.MAIL_INBOUND_RECIPIENTS ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(account) || !recipients.length || recipients.includes("operator-1608598f41@example.invalid")) return response(503, "unavailable");
  if (!rateLimit(`mail-inbound:${account}`, 300, 60000)) return NextResponse.json({ ok: false, error: "rate" }, { status: 429, headers: { "retry-after": "60", "cache-control": "no-store" } });
  if (!/^application\/json(?:;|$)/i.test(req.headers.get("content-type") ?? "")) return response(415, "input");
  const size = req.headers.get("content-length");
  if (size !== null && (!/^[0-9]+$/.test(size) || Number(size) > INBOUND_MAX_BODY)) return response(413, "size");
  const key = readSecret("MAIL_INBOUND_RELAY_KEY", "mail-inbound-relay-key");
  if (!key || Buffer.byteLength(key) < 32) return response(503, "unavailable");
  const body = await readLimitedText(req, INBOUND_MAX_BODY);
  if (!body.ok) return response(body.status, body.status === 413 ? "size" : "input");
  try {
    const result = await acceptInboundMail(Buffer.from(body.raw, "utf8"), req.headers.get("x-peticao-timestamp"), req.headers.get("x-peticao-signature"), { enabled: true, account, recipients, key: Buffer.from(key, "utf8") });
    if (!result.ok) return response(result.error === "conflict" ? 409 : ["signature", "timestamp"].includes(result.error) ? 401 : result.error === "disabled" ? 503 : result.error === "size" ? 413 : 400, result.error);
    return NextResponse.json(result, { status: 202, headers: { "cache-control": "no-store" } });
  } catch {
    // Never acknowledge an uncommitted reception or expose payload/provider errors.
    return response(503, "unavailable");
  }
}
