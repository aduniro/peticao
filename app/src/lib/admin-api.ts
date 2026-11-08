import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "./admin";
import { clientIp } from "./net";
import { rateLimit } from "./ratelimit";

/** Porteiro das ações do painel: sessão admin, mesma origem (contra requisição forjada de outro site) e limite de taxa. Devolve a resposta de erro, ou null se pode seguir. */
export function exigirAdmin(req: NextRequest, limite = 120): NextResponse | null {
  if (!isAdmin()) return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 });
  const origin = req.headers.get("origin");
  if (origin) { try { if (new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) return NextResponse.json({ ok: false, erro: "Origem não permitida." }, { status: 403 }); } catch { return NextResponse.json({ ok: false, erro: "Origem inválida." }, { status: 403 }); } }
  if (!["GET", "HEAD"].includes(req.method) && !origin && req.headers.get("sec-fetch-site") !== "same-origin") return NextResponse.json({ ok: false, erro: "Origem ausente." }, { status: 403 });
  if (!rateLimit(`admin-acao:${clientIp(req.headers)}`, limite, 60_000)) return NextResponse.json({ ok: false, erro: "Muitas ações em pouco tempo. Aguarde um minuto." }, { status: 429 });
  return null;
}
