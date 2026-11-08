import { NextRequest, NextResponse } from "next/server";
import { validateEmailField } from "@/lib/email-validate";
import { rateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/net";

export const dynamic = "force-dynamic";

/** Validação do e-mail digitado (sem gravar nada): o formulário avisa antes do envio. */
export async function POST(req: NextRequest) {
  if (!rateLimit(`emailval:${clientIp(req.headers)}`, 60, 60_000)) return NextResponse.json({ ok: true, skipped: "limite" }); // falha aberta: o servidor valida de novo no envio
  let b: { email?: unknown; category?: unknown } = {};
  try { b = await req.json(); } catch { return NextResponse.json({ ok: true }); }
  const email = typeof b.email === "string" ? b.email.slice(0, 254) : "";
  const category = b.category === "servidor" ? "servidor" : b.category === "apoiador" ? "apoiador" : null;
  if (!email || !category) return NextResponse.json({ ok: true });
  const v = await validateEmailField(email, category);
  return NextResponse.json(v.ok ? { ok: true, ...(v.soft ? { soft: v.soft } : {}) } : { ok: false, code: v.code, suggest: v.suggest ?? null, ...(v.detail ? { fix: v.detail } : {}) });
}
