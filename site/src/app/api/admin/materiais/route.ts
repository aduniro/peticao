import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { readLimitedText } from "@/lib/http-body";
import { materialListQuery } from "@/lib/materials-contract";
import { listMaterials, mutateMaterial } from "@/lib/materials-store";
import { materialResponse } from "@/lib/materials-response";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const denied = await exigirNivel(req, "leitura", 120); if (denied) return denied;
  const filter = materialListQuery(req.nextUrl.searchParams);
  if (!filter) return materialResponse({ ok: false, error: "parameters" });
  try { return materialResponse(await listMaterials(await quemAge(req), filter.archived, filter.before)); }
  catch { return materialResponse({ ok: false, error: "unavailable" }); }
}
export async function POST(req: NextRequest) {
  const denied = await exigirNivel(req, "edicao", 30); if (denied) return denied;
  if (req.nextUrl.searchParams.size) return materialResponse({ ok: false, error: "parameters" });
  const body = await readLimitedText(req, 16 * 1024);
  if (!body.ok) return NextResponse.json({ ok: false, error: "parameters" }, { status: body.status, headers: { "cache-control": "no-store" } });
  let raw: unknown; try { raw = JSON.parse(body.raw); } catch { return materialResponse({ ok: false, error: "parameters" }); }
  try { return materialResponse(await mutateMaterial(raw, await quemAge(req))); }
  catch { return materialResponse({ ok: false, error: "unavailable" }); }
}
