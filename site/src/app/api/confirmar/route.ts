import { NextRequest, NextResponse } from "next/server";
import { confirmFull } from "@/lib/signatures";
import { rateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/net";
import { posConfirmacao } from "@/lib/pos-confirmacao";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  if (!rateLimit(`confirm:${ip}`, 20, 10 * 60_000)) return NextResponse.json({ result: "invalid" }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  const r = await confirmFull(typeof body?.token === "string" ? body.token : "", { visitorId: req.cookies.get("vid")?.value, ip });
  if (r.result !== "ok") return NextResponse.json({ result: r.result });
  if (r.signatureId) await posConfirmacao(r, { ip, headers: req.headers, canal: "email" });
  return NextResponse.json({ result: "ok", panel: r.manageToken ? `/meu/${r.manageToken}` : null });
}
