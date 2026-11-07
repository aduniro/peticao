import { NextRequest, NextResponse } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { mailHistory, mailHistoryDetail } from "@/lib/mail/history";
export const dynamic = "force-dynamic";
/** Internal metadata only; content preview requires its own stricter access contract. */
export async function GET(req: NextRequest) {
  const denied = await exigirNivel(req, "edicao");
  if (denied) return denied;
  const q = req.nextUrl.searchParams;
  const allowed = new Set(["id", "before", "limit", "recipient", "kind", "channel", "status"]);
  if ([...q.keys()].some(key => !allowed.has(key) || q.getAll(key).length !== 1) || q.has("id") && q.size !== 1 || q.has("limit") && !/^[1-9]\d?$/.test(q.get("limit")!)) {
    return NextResponse.json({ ok: false, error: "parameters" }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  const result = q.has("id") ? await mailHistoryDetail(q.get("id")) : await mailHistory({
    before: q.get("before") ?? undefined,
    limit: q.has("limit") ? Number(q.get("limit")) : undefined,
    recipient: q.get("recipient") ?? undefined,
    kind: q.get("kind") ?? undefined,
    channel: q.get("channel") ?? undefined,
    status: q.get("status") ?? undefined,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : result.error === "not_found" ? 404 : 400, headers: { "cache-control": "no-store" } });
}
