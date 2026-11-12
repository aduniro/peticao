import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { materialHistory } from "@/lib/materials-store";
import { prepareMaterialPreview } from "@/lib/materials-preview";
import { materialResponse } from "@/lib/materials-response";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await exigirNivel(req, "leitura", 120); if (denied) return denied;
  if (process.env.MATERIALS_LIBRARY_ENABLED !== "1") return materialResponse({ ok: false, error: "disabled" });
  try {
    const result = await prepareMaterialPreview(params.id, req.nextUrl.searchParams, await quemAge(req), materialHistory);
    return result.ok ? new NextResponse(result.html, { status: 200, headers: result.headers }) : materialResponse(result);
  } catch { return materialResponse({ ok: false, error: "unavailable" }); }
}
