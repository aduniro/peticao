import { NextRequest, NextResponse } from "next/server";
import { adminIpAllowed } from "@/lib/admin";
import { pedirReset } from "@/lib/admin-users";
import { rateLimit } from "@/lib/ratelimit";
import { clientIp, requestOrigin } from "@/lib/net";
import { turnstileEnabled, verifyTurnstile } from "@/lib/turnstile";

export const dynamic = "force-dynamic";
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "Esqueci minha senha": manda o link de redefinição se o e-mail tiver conta ativa. A resposta é sempre a mesma (não revela quem tem conta). */
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers), origem = requestOrigin(req.headers);
  const volta = (q: string) => NextResponse.redirect(new URL("/admin" + q, origem), 303);
  const o = req.headers.get("origin");
  if (o) { try { if (new URL(o).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) return volta("?erro=limite"); } catch { return volta("?erro=limite"); } }
  if (!(await adminIpAllowed(ip))) return volta("?erro=local");
  if (!rateLimit(`admin-esqueci:${ip}`, 5, 15 * 60_000) || !rateLimit("admin-esqueci:global", 30, 60 * 60_000)) return volta("?erro=limite");
  const form = await req.formData();
  if (turnstileEnabled() && !(await verifyTurnstile(form.get("cf-turnstile-response") ?? form.get("turnstile"), ip))) return volta("?erro=robo");
  await pedirReset(String(form.get("email") ?? ""), { origin: origem }).catch((e) => console.error("redefinição de senha falhou:", e instanceof Error ? e.message : e));
  await espera(600);
  return volta("?msg=reset-enviado");
}
