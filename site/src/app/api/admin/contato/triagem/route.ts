import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { requestTriage, triageHistory } from "@/lib/contact-triage/jobs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const denied = await exigirNivel(req, "edicao"); if (denied) return denied;
  const history = await triageHistory(Number(req.nextUrl.searchParams.get("contato")));
  return NextResponse.json(history ? { ok: true,history } : { ok: false,error: "parameters" }, { status: history ? 200 : 400, headers: { "cache-control": "no-store" } });
}
export async function POST(req: NextRequest) {
  const denied = await exigirNivel(req, "edicao", 30); if (denied) return denied;
  const actor = await quemAge(req), body = await req.json().catch(() => null);
  if (!actor || !body || typeof body !== "object") return NextResponse.json({ ok: false,error: "parameters" }, { status: 400 });
  const result = await requestTriage(body.contato, actor.email);
  return NextResponse.json(result, { status: result.ok ? 200 : result.error === "not_found" ? 404 : 400, headers: { "cache-control": "no-store" } });
}
