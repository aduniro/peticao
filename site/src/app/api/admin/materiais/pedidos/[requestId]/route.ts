import { NextRequest } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { readMaterialRequest } from "@/lib/materials-store";
import { materialResponse } from "@/lib/materials-response";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, { params }: { params: { requestId: string } }) {
  const denied = await exigirNivel(req, "leitura", 120); if (denied) return denied;
  if (req.nextUrl.searchParams.size) return materialResponse({ ok: false, error: "parameters" });
  try { return materialResponse(await readMaterialRequest(params.requestId, await quemAge(req))); }
  catch { return materialResponse({ ok: false, error: "unavailable" }); }
}
