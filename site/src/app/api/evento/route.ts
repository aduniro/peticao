import { NextRequest, NextResponse } from "next/server";
import { optedOut, recordEvent } from "@/lib/track";
import { clientIp } from "@/lib/net";
import { rateLimit } from "@/lib/ratelimit";
import { newToken } from "@/lib/security";
import { cookieOpts } from "@/lib/cookies";

export const dynamic = "force-dynamic";

/** Recebe eventos do navegador (visita, clique, início do formulário…). Respeita Do Not Track / Global Privacy Control. */
export async function POST(req: NextRequest) {
  const res = new NextResponse(null, { status: 204 });
  if (optedOut(req.headers)) return res;
  const ip = clientIp(req.headers);
  if (!rateLimit(`ev:${ip}`, 240, 60_000)) return new NextResponse(null, { status: 429 });
  let body: any = {};
  try { body = JSON.parse(await req.text()); } catch { return new NextResponse(null, { status: 400 }); }
  const path = typeof body.path === "string" ? body.path : "";
  if (path.startsWith("/admin") || path.startsWith("/dev") || path.startsWith("/api")) return res; // painéis e APIs não são rastreados
  let vid = req.cookies.get("vid")?.value;
  if (!vid) { vid = newToken().slice(0, 24); res.cookies.set("vid", vid, cookieOpts(req, 365 * 86400)); }
  const events: any[] = Array.isArray(body.events) ? body.events.slice(0, 20) : [body];
  for (const e of events) {
    await recordEvent({
      visitorId: vid, sessionId: body.sid, type: e.type, path: e.path ?? path, target: e.target, label: e.label,
      refCode: req.cookies.get("ref")?.value, ip, ua: req.headers.get("user-agent") ?? "", lang: body.lang, screen: body.screen,
    }).catch(() => {});
  }
  return res;
}
