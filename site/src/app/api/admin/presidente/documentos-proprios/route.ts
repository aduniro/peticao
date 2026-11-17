import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { readLimitedText } from "@/lib/http-body";
import { ownDocumentRequest, ownUuid } from "@/lib/president-own-document-contract";
import { createPresidentOwnDocument, readPresidentOwnDocumentRequest } from "@/lib/president-own-document-store";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
const status = { parameters: 400, forbidden: 403, not_found: 404, conflict: 409, unavailable: 503 };
export async function POST(req: NextRequest) {
  const blocked = await exigirNivel(req, "total", 15, { stepup: true }); if (blocked) return blocked;
  const actor = await quemAge(req); if (!actor) return NextResponse.json({ ok: false }, { status: 401, headers });
  if (req.nextUrl.searchParams.size) return NextResponse.json({ ok: false, error: "parameters" }, { status: 400, headers });
  if ((req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "application/json") return new NextResponse(null, { status: 415, headers });
  const body = await readLimitedText(req, 1024); if (!body.ok) return new NextResponse(null, { status: body.status, headers });
  let input: unknown; try { input = JSON.parse(body.raw); } catch { return NextResponse.json({ ok: false, error: "parameters" }, { status: 400, headers }); }
  if (!ownDocumentRequest(input)) return NextResponse.json({ ok: false, error: "parameters" }, { status: 400, headers });
  const result = await createPresidentOwnDocument(input, actor);
  return NextResponse.json(result, { status: result.ok ? result.document.state === "pending" ? 202 : 200 : status[result.error], headers });
}
export async function GET(req: NextRequest) {
  const blocked = await exigirNivel(req, "total", 60, { stepup: true }); if (blocked) return blocked;
  const actor = await quemAge(req); if (!actor) return NextResponse.json({ ok: false }, { status: 401, headers });
  const requestId = req.nextUrl.searchParams.get("requestId");
  if (req.nextUrl.searchParams.size !== 1 || req.nextUrl.searchParams.getAll("requestId").length !== 1 || !ownUuid(requestId)) return NextResponse.json({ ok: false, error: "parameters" }, { status: 400, headers });
  const result = await readPresidentOwnDocumentRequest(requestId, actor);
  return NextResponse.json(result, { status: result.ok ? 200 : status[result.error], headers });
}
