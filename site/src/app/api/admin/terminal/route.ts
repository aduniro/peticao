import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { recordTerminalRequest, recordTerminalResult } from "@/lib/terminal-audit";
import { forwardTerminalOutput, unknownTerminalResult } from "@/lib/terminal-protocol";
import { TerminalProtocolUnavailable, type TerminalExecution, comandoValido, executarNoTerminal, terminalAte, terminalConfigurado } from "@/lib/terminal";

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
  const id = await recordTerminalRequest(s, comando);
  const finish = (result: Parameters<typeof recordTerminalResult>[2]) => recordTerminalResult(id, s, result);
  let execution: TerminalExecution;
  try { execution = await executarNoTerminal(s.email, comando); }
  catch (error) {
    const incompatible = error instanceof TerminalProtocolUnavailable;
    await finish({ ...unknownTerminalResult(incompatible ? "protocol" : "unavailable"), ...(incompatible ? { estado: "recusado" as const } : {}) });
    return NextResponse.json({ ok: false, erro: incompatible ? "recusado" : "servico_fora" }, { status: 502 });
  }
  const r = execution.response;
  if (!r.ok || !r.body) {
    await finish({ ...unknownTerminalResult(r.status === 409 ? "busy" : "rejected"), estado: "recusado" });
    await r.body?.cancel().catch(() => {});
    return NextResponse.json({ ok: false, erro: r.status === 409 ? "ocupado" : "recusado" }, { status: r.status === 409 ? 409 : 502 });
  }
  let output: ReadableStream<Uint8Array>;
  try { output = forwardTerminalOutput(r, finish, execution.verify); }
  catch { await finish(unknownTerminalResult("protocol")); await r.body.cancel().catch(() => {}); return NextResponse.json({ ok: false, erro: "recusado" }, { status: 502 }); }
  return new Response(output, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
