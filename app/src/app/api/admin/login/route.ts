import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, ADMIN_SESSAO_SEGUNDOS, adminIpAllowed, adminToken, passwordOk } from "@/lib/admin";
import { rateLimit } from "@/lib/ratelimit";
import { isProd } from "@/lib/config";
import { clientIp, requestOrigin } from "@/lib/net";
import { turnstileEnabled, verifyTurnstile } from "@/lib/turnstile";
import { audit } from "@/lib/db";
import { hmac } from "@/lib/security";

export const dynamic = "force-dynamic";

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Login do painel, mais rigoroso que o resto do site: antirrobô (Turnstile) ANTES da senha, 5 tentativas por IP em 15 min,
 * trava global (20 falhas em 15 min bloqueiam qualquer IP por alguns minutos), atraso fixo em toda falha e registro na auditoria.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  const url = new URL("/admin", requestOrigin(req.headers));
  const volta = (erro: string) => { url.searchParams.set("erro", erro); return NextResponse.redirect(url, 303); };
  const origin = req.headers.get("origin");
  if (origin) { try { if (new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) return volta("1"); } catch { return volta("1"); } }
  if (!(await adminIpAllowed(ip))) return volta("local");
  if (!rateLimit(`admin:${ip}`, 5, 15 * 60_000)) return volta("limite");
  if (!rateLimit("admin:global-tentativas", 60, 15 * 60_000)) return volta("limite");
  const form = await req.formData();
  if (turnstileEnabled() && !(await verifyTurnstile(form.get("cf-turnstile-response") ?? form.get("turnstile"), ip))) {
    await audit("admin_login_robo", null, { ip: hmac("ip:" + ip).slice(0, 12) }).catch(() => {});
    await espera(800);
    return volta("robo");
  }
  if (!passwordOk(String(form.get("password") ?? ""))) {
    const global = rateLimit("admin:global-falhas", 20, 15 * 60_000);
    await audit("admin_login_falha", null, { ip: hmac("ip:" + ip).slice(0, 12) }).catch(() => {});
    await espera(1200);
    return volta(global ? "1" : "limite");
  }
  const res = NextResponse.redirect(url, 303);
  res.cookies.set(ADMIN_COOKIE, adminToken(), { httpOnly: true, sameSite: "strict", secure: isProd, path: "/", maxAge: ADMIN_SESSAO_SEGUNDOS });
  await audit("admin_login_ok", null, { ip: hmac("ip:" + ip).slice(0, 12) }).catch(() => {});
  return res;
}
