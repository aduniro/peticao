import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { batchId } from "@/lib/batch-http-input";
import { ownUuid } from "@/lib/president-own-document-contract";
import { listPresidentConsumedReceipts } from "@/lib/president-portal-store";
import { listPresidentOwnDocumentArtifacts } from "@/lib/president-own-document-store";
export const dynamic = "force-dynamic";
const reply = (value: unknown, status: number) => NextResponse.json(value, { status, headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" } });
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await exigirNivel(req, "total", 120, { stepup: true });if (denied) return denied;
  const id = batchId(params.id), q = req.nextUrl.searchParams, kind = q.get("kind"), cursor = q.get("cursor");
  if (id === null || !["receipts", "artifacts"].includes(kind ?? "") || q.getAll("kind").length !== 1 || q.size !== 1 && q.size !== 2 || Array.from(q.keys()).some(key => !["kind", "cursor"].includes(key)) || q.has("cursor") && (q.getAll("cursor").length !== 1 || !ownUuid(cursor))) return reply({ ok: false, error: "parameters" }, 400);
  const actor = await quemAge(req);
  try {
    const result = kind === "receipts" ? await listPresidentConsumedReceipts(id, actor, cursor ?? undefined) : await listPresidentOwnDocumentArtifacts(id, actor, cursor ?? undefined);
    return reply(result, result.ok ? 200 : result.error === "parameters" ? 400 : result.error === "forbidden" ? 403 : result.error === "not_found" ? 404 : 503);
  } catch { return reply({ ok: false, error: "unavailable" }, 503); }
}
