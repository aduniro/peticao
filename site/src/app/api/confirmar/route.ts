import { NextRequest, NextResponse } from "next/server";
import { confirmFull } from "@/lib/signatures";
import { rateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/net";
import { posConfirmacao } from "@/lib/pos-confirmacao";
import { checkConfirmation } from "@/lib/confirmation-check";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  if (!rateLimit(`confirm:${ip}`, 20, 10 * 60_000)) return NextResponse.json({ result: "invalid" }, { status: 429 });
  const body = await req.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token : "";
  const checked = await checkConfirmation(token, "email", body?.recovery);
  if (!checked.ok) return NextResponse.json(checked.json, { status: checked.status });
  const r = await confirmFull(token, { visitorId: req.cookies.get("vid")?.value, ip }, "email", checked.proof);
  if (r.result !== "ok") return NextResponse.json({ result: r.result });
  await posConfirmacao(r, { ip, headers: req.headers, canal: "email" });
  return NextResponse.json({ result: "ok", panel: r.manageToken ? `/meu/${r.manageToken}` : null });
}
