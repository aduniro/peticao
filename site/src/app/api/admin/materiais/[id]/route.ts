import { NextRequest } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { materialRevision } from "@/lib/materials-contract";
import { materialHistory } from "@/lib/materials-store";
import { materialResponse } from "@/lib/materials-response";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await exigirNivel(req, "leitura", 120); if (denied) return denied;
  const query = req.nextUrl.searchParams, raw = query.get("before"), before = raw === null ? null : Number(raw);
  if ([...query.keys()].some(k => k !== "before") || query.getAll("before").length > 1 || raw !== null && (!/^[1-9][0-9]{0,9}$/.test(raw) || !materialRevision(before))) return materialResponse({ ok: false, error: "parameters" });
  try { return materialResponse(await materialHistory(params.id, await quemAge(req), before)); }
  catch { return materialResponse({ ok: false, error: "unavailable" }); }
}
