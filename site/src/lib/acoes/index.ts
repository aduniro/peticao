import { query, tx } from "../db";
import { reenvioIniciar, reenvioParar, reenvioStatus } from "./reenvio";
import { estadoVer } from "./estado";
import { publicarPedir, publicarStatus } from "./publicar";
import { terminalDesligar, terminalLigar, terminalStatus } from "./terminal";
import { ActionNotApplied, type Acao, type Ctx } from "./tipos";
import { finishAction, prepareAction, readAction, recordRead, recoverActions, supplementAction } from "./journal";

export type { Acao, Ctx } from "./tipos";
export const ACOES: Acao[] = [estadoVer, publicarStatus, publicarPedir, reenvioStatus, reenvioIniciar, reenvioParar, terminalStatus, terminalLigar, terminalDesligar];
export const acaoPorId = (id: unknown) => ACOES.find((a) => a.id === id);

export type Resposta =
  | { ok: true; modo: "simular"; efeito: string; palavra: string | null; resultado: Record<string, unknown> }
  | { ok: true; modo: "executar"; efeito: string; resultado: Record<string, unknown> }
  | { ok: false; erro: "acao_desconhecida" | "parametros" | "confirmacao" | "ocupado" | "falhou" | "indeterminado"; detalhe?: string };

/**
 * Roda uma ação do registro. Simular nunca grava (fora o registro da própria consulta). Executar uma ação que altera algo exige `confirmacao`
 * igual à palavra da ação, e roda sob trava (uma execução por vez da mesma ação, mesmo com dois cliques ou duas abas).
 */
export async function rodarAcao(id: unknown, modo: unknown, parametros: unknown, confirmacao: unknown, ctx: Ctx): Promise<Resposta> {
  const a = acaoPorId(id);
  if (!a) return { ok: false, erro: "acao_desconhecida" };
  if (modo !== "simular" && modo !== "executar") return { ok: false, erro: "parametros" };
  const v = a.validar(parametros);
  if (!v.ok) return { ok: false, erro: "parametros", detalhe: v.erro };
  const efeito = a.descrever(v.p);
  if (modo === "simular" || !a.palavra) {
    try {
      const resultado = modo === "simular" ? await a.simular(v.p) : await a.executar(v.p, ctx);
      await recordRead(a.id, v.p, modo, ctx, resultado);
      return modo === "simular" ? { ok: true, modo, efeito, palavra: a.palavra ?? null, resultado } : { ok: true, modo, efeito, resultado };
    } catch { return { ok: false, erro: "falhou" }; }
  }
  if (String(confirmacao ?? "").trim() !== a.palavra) return { ok: false, erro: "confirmacao" };
  let journalId: number | undefined;
  try {
    const response = await tx(async client => {
      const lock = (await query<{ g: boolean }>("SELECT pg_try_advisory_xact_lock(hashtext(current_schema()), hashtext($1)) g", ["acao-grupo:" + a.grupo], client)).rows[0].g;
      if (!lock) return { ok: false, erro: "ocupado" } as Resposta;
      if (await recoverActions(ACOES.filter(item => item.grupo === a.grupo).map(item => item.id), a.id)) return { ok: false, erro: "indeterminado" } as Resposta;
      const admission = await prepareAction(a.id, v.p, ctx, a.transacional === true);
      journalId = admission.id;
      const resultado = await a.executar(v.p, { userId: ctx.userId, email: ctx.email, requestId: admission.requestId, ...(a.transacional ? { client } : {}) });
      await finishAction(journalId, ctx, a.aceite ? "aceito" : "concluido", resultado, client);
      return { ok: true, modo: "executar", efeito, resultado } as Resposta;
    });
    if (response.ok && response.modo === "executar" && a.aposCommit && journalId !== undefined) {
      try {
        const patch = await a.aposCommit(v.p, ctx, response.resultado);
        await supplementAction(journalId, ctx, patch);
        response.resultado = { ...response.resultado, ...patch };
      } catch { /* Core effect is already committed; optional notification cannot turn it into a failure. */ }
    }
    return response;
  } catch (error) {
    const uncertain = journalId !== undefined && !a.transacional && !(error instanceof ActionNotApplied);
    if (journalId !== undefined) {
      await finishAction(journalId, ctx, uncertain ? "indeterminado" : "falhou", { erro: String((error as Error).message).slice(0, 300) }).catch(() => {});
      const recorded = await readAction(journalId, ctx).catch(() => null);
      // A COMMIT acknowledgement can be lost after a successful commit. Trust the durable result.
      if (recorded && ["concluido", "aceito"].includes(recorded.central_estado)) return { ok: true, modo: "executar", efeito, resultado: recorded.resultado };
      if (!recorded || recorded.central_estado !== "falhou") return { ok: false, erro: "indeterminado" };
    }
    return { ok: false, erro: uncertain ? "indeterminado" : "falhou", detalhe: String((error as Error).message).slice(0, 200) };
  }
}
