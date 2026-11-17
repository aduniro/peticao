import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { contactGroupResult } from "@/lib/contact-group-execution";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const denied = await exigirNivel(req, "total", 60, { stepup: true });
  if (denied) return denied;
  const actor = await quemAge(req);
  if (!actor) return new NextResponse(null, { status: 401 });
  if ([...req.nextUrl.searchParams.keys()].some(k => k !== "requestId")) return new NextResponse(null, { status: 400 });
  const result = await contactGroupResult(req.nextUrl.searchParams.get("requestId"), actor);
  return NextResponse.json(result, { status: result.ok ? 200 : result.error === "forbidden" ? 403 : result.error === "not_found" ? 404 : 400, headers: { "cache-control": "no-store" } });
}
