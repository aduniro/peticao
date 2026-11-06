import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { clientIp } from "@/lib/net";
import { rateLimit } from "@/lib/ratelimit";
import { sha256 } from "@/lib/security";
import { FORM_DRAFT_BODY_LIMIT, formDraftsEnabled, saveFormDraft, validDraftToken, withdrawFormDraft } from "@/lib/form-drafts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const reply = (status: number, value: Record<string, unknown>) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  // Browser fetch and sendBeacon both include Origin. Reject other sites outright.
  const allowed = new URL(config.appUrl()).origin;
  if (req.headers.get("origin") !== allowed) return reply(403, { ok: false });
  const contentType = req.headers.get("content-type")?.split(";")[0];
  if (contentType !== "application/json" && contentType !== "text/plain") return reply(415, { ok: false });
  if (!rateLimit(`form-draft:${sha256(clientIp(req.headers))}`, 180, 10 * 60_000)) return reply(429, { ok: false });
  try {
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (!Number.isFinite(declared) || declared > FORM_DRAFT_BODY_LIMIT) return reply(413, { ok: false });
    // Bound streaming requests too; never buffer an unbounded request body.
    const reader = req.body?.getReader();
    if (!reader) return reply(400, { ok: false });
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > FORM_DRAFT_BODY_LIMIT) { await reader.cancel(); return reply(413, { ok: false }); }
      chunks.push(part.value);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || !validDraftToken(data.token)) return reply(400, { ok: false });
    if (data.action === "withdraw") { await withdrawFormDraft(data.token); return reply(200, { ok: true }); }
    if (!formDraftsEnabled()) return reply(503, { ok: false, code: "disabled" });
    const result = await saveFormDraft(data.token, data.sequence, data);
    return reply(200, { ok: true, saved: result.saved });
  } catch { return reply(400, { ok: false }); }
}
