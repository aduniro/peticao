import { NextRequest, NextResponse } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { campusReferenceEvidence } from "@/lib/contact-triage/campus-references";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const denied = await exigirNivel(req, "edicao");
  if (denied) return denied;
  const p = req.nextUrl.searchParams;
  if ([...p.keys()].some(k => !["institution", "cityIbge", "after", "limit"].includes(k))) return new NextResponse(null, { status: 400, headers: { "cache-control": "no-store" } });
  const numeric = (key: string) => p.has(key) ? /^[1-9][0-9]{0,9}$/.test(p.get(key)!) ? Number(p.get(key)) : NaN : undefined;
  const result = campusReferenceEvidence({ institution: p.get("institution") ?? "", cityIbge: numeric("cityIbge"), after: p.get("after") ?? undefined, limit: numeric("limit") });
  return NextResponse.json(result, { status: result.ok ? 200 : 400, headers: { "cache-control": "no-store" } });
}
