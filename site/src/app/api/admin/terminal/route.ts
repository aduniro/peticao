import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { audit, query } from "@/lib/db";
import { comandoValido, executarNoTerminal, terminalAte, terminalConfigurado } from "@/lib/terminal";

export const dynamic = "force-dynamic";

/**
 * Terminal: executa UM comando no serviço separado e sem privilégios. Nível total + confirmação extra + Terminal ligado na Central de Ações.
 * O comando é registrado (auditoria e admin_acoes) ANTES de executar. A resposta é o texto da saída, em fluxo.
 */
export async function POST(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "total", 60, { stepup: true });
  if (bloqueio) return bloqueio;
  const s = await quemAge(req);
  const b = await req.json().catch(() => null);
  if (!s || !comandoValido(b?.comando)) return NextResponse.json({ ok: false, erro: "comando_invalido" }, { status: 400 });
  if (!terminalConfigurado()) return NextResponse.json({ ok: false, erro: "nao_configurado" }, { status: 503 });
  if (!(await terminalAte())) return NextResponse.json({ ok: false, erro: "desligado" }, { status: 403 });
  const comando: string = b.comando;
  await audit("terminal_comando", null, { por: s.email, comando });
  await query("INSERT INTO admin_acoes(user_id,email,acao,parametros,modo,resultado,ok) VALUES($1,$2,'terminal.comando',$3,'executar',NULL,true)", [s.userId || null, s.email, JSON.stringify({ comando })]);
  let r: Response;
  try { r = await executarNoTerminal(s.email, comando); } catch { return NextResponse.json({ ok: false, erro: "servico_fora" }, { status: 502 }); }
  if (!r.ok || !r.body) return NextResponse.json({ ok: false, erro: r.status === 409 ? "ocupado" : "recusado" }, { status: r.status === 409 ? 409 : 502 });
  return new Response(r.body, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
