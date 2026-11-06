import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, sessaoDoCookie } from "./admin";
import { nivelOk, stepupValido, type Nivel, type SessaoAdmin } from "./admin-users";
import { clientIp } from "./net";
import { rateLimit } from "./ratelimit";

/**
 * Porteiro das rotas do painel. TODA rota de /api/admin precisa chamá-lo com o nível mínimo exigido (um teste varre as rotas e falha se alguma não chamar):
 *  - leitura: consultas e estatísticas; edição: o que mostra dados de contato ou corrige cadastros, e-mails, domínios e filas;
 *  - exclusão: remover dados (reservado: hoje nenhuma rota remove); total: lotes, envio ao Governo, WhatsApp, usuários, ações.
 * Confere: sessão no banco (usuário ativo e nível atual), mesma origem (contra requisição forjada de outro site) e limite de taxa.
 * Com `{ stepup: true }` exige também a confirmação extra (senha de novo + código por e-mail, válida por 15 min): sem ela responde 403 `{ erro: "stepup" }`.
 * Devolve a resposta de erro (401 sem sessão, 403 sem nível) ou null se pode seguir.
 */
export async function exigirNivel(req: NextRequest, nivel: Nivel, limite = 120, opcoes: { stepup?: boolean } = {}): Promise<NextResponse | null> {
  const s = await quemAge(req);
  if (!s) return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 });
  if (!nivelOk(s.nivel, nivel)) return NextResponse.json({ ok: false, erro: "O seu nível de acesso não permite esta ação." }, { status: 403 });
  if (opcoes.stepup && !stepupValido(s)) return NextResponse.json({ ok: false, erro: "stepup" }, { status: 403 });
  const origin = req.headers.get("origin");
  if (origin) { try { if (new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) return NextResponse.json({ ok: false, erro: "Origem não permitida." }, { status: 403 }); } catch { return NextResponse.json({ ok: false, erro: "Origem inválida." }, { status: 403 }); } }
  if (!["GET", "HEAD"].includes(req.method) && !origin && req.headers.get("sec-fetch-site") !== "same-origin") return NextResponse.json({ ok: false, erro: "Origem ausente." }, { status: 403 });
  if (!rateLimit(`admin-acao:${clientIp(req.headers)}`, limite, 60_000)) return NextResponse.json({ ok: false, erro: "Muitas ações em pouco tempo. Aguarde um minuto." }, { status: 429 });
  return null;
}

/** Quem está agindo (para gravar no registro de auditoria): a sessão do cookie da própria requisição. */
export const quemAge = (req: NextRequest): Promise<SessaoAdmin | null> => sessaoDoCookie(req.cookies.get(ADMIN_COOKIE)?.value);
