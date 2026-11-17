import { audit, tx } from "./db";
import type { TerminalResult } from "./terminal-protocol";
export type TerminalActor = { userId: number; email: string };

export async function recordTerminalRequest(actor: TerminalActor, comando: string): Promise<number> {
  return tx(async c => {
    const row = await c.query<{ id: number }>("INSERT INTO admin_acoes(user_id,email,acao,parametros,modo,resultado,ok) VALUES($1,$2,'terminal.comando',$3,'executar',$4,false) RETURNING id", [actor.userId || null, actor.email, JSON.stringify({ comando }), JSON.stringify({ estado: "solicitado" })]);
    const id = row.rows[0].id;
    await audit("terminal_comando", null, { por: actor.email, comando, acaoId: id }, c);
    return id;
  });
}

export async function recordTerminalResult(id: number, actor: TerminalActor, result: TerminalResult): Promise<void> {
  await tx(async c => {
    const ok = result.estado === "concluido" && result.code === 0 && !result.timedOut && !result.truncated && !result.spawnError;
    const updated = await c.query("UPDATE admin_acoes SET resultado=$3,ok=$4 WHERE id=$1 AND email=$2 AND acao='terminal.comando' AND resultado->>'estado'='solicitado' RETURNING id", [id, actor.email, JSON.stringify(result), ok]);
    if (updated.rowCount) await audit("terminal_resultado", null, { por: actor.email, acaoId: id, ...result }, c);
  });
}
