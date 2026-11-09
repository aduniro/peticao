import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { mailPreview } from "@/lib/mail/preview";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const denied = await exigirNivel(req, "total", 30, { stepup: true });
  if (denied) return denied;
  const params = req.nextUrl.searchParams, actor = await quemAge(req);
  if (!actor || params.size !== 1 || params.getAll("id").length !== 1) return NextResponse.json({ ok: false, error: "parameters" }, { status: 400, headers: { "cache-control": "no-store" } });
  const result = await mailPreview(params.get("id"), actor);
  return NextResponse.json(result, { status: result.ok ? 200 : result.error === "not_found" ? 404 : 400,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });
}
