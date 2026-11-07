import { query, tx } from "../db";
import { reenvioIniciar, reenvioParar, reenvioStatus } from "./reenvio";
import { estadoVer } from "./estado";
import { publicarPedir, publicarStatus } from "./publicar";
import { terminalDesligar, terminalLigar, terminalStatus } from "./terminal";
import { ActionNotApplied, type Acao, type Ctx } from "./tipos";
import { inspectIntent, type IntentCheck, type ActionIntent } from "./intent";
import { finishAction, prepareAction, readAction, recordRead, recoverActions, supplementAction } from "./journal";

export type { Acao, Ctx } from "./tipos";
export const ACOES: Acao[] = [estadoVer, publicarStatus, publicarPedir, reenvioStatus, reenvioIniciar, reenvioParar, terminalStatus, terminalLigar, terminalDesligar];
export const acaoPorId = (id: unknown) => ACOES.find((a) => a.id === id);

export type Resposta =
  | { ok: true; modo: "simular"; efeito: string; palavra: string | null; resultado: Record<string, unknown>; simulacao?: ActionIntent }
  | { ok: true; modo: "executar"; efeito: string; resultado: Record<string, unknown> }
  | { ok: false; erro: "acao_desconhecida" | "parametros" | "confirmacao" | "ocupado" | "falhou" | "indeterminado"; detalhe?: string; encerrada?: boolean };

function priorResult(checked: IntentCheck, efeito: string): Resposta | null {
  if (checked.kind === "ready") return null;
  if (checked.kind === "invalid" || checked.kind === "expired") return { ok: false, erro: "parametros", ...(checked.kind === "expired" ? { encerrada: true } : {}) };
  const { record } = checked;
  if (["concluido", "aceito"].includes(record.central_estado)) return { ok: true, modo: "executar", efeito, resultado: record.resultado ?? {} };
  if (record.central_estado === "falhou") return { ok: false, erro: "falhou", encerrada: true, ...(typeof record.resultado?.erro === "string" ? { detalhe: record.resultado.erro.slice(0, 200) } : {}) };
  return { ok: false, erro: "indeterminado" };
}

/**
 * Roda uma ação do registro. Simular nunca grava (fora o registro da própria consulta). Executar uma ação que altera algo exige `confirmacao`
 * igual à palavra da ação, e roda sob trava (uma execução por vez da mesma ação, mesmo com dois cliques ou duas abas).
 */
export async function rodarAcao(id: unknown, modo: unknown, parametros: unknown, confirmacao: unknown, ctx: Ctx, options: { requireIntent?: boolean; simulacao?: unknown } = {}): Promise<Resposta> {
  const a = acaoPorId(id);
  if (!a) return { ok: false, erro: "acao_desconhecida" };
  if (modo !== "simular" && modo !== "executar" && modo !== "consultar") return { ok: false, erro: "parametros" };
  const v = a.validar(parametros);
  if (!v.ok) return { ok: false, erro: "parametros", detalhe: v.erro };
  const efeito = a.descrever(v.p);
  if (modo === "consultar") {
    if (!a.palavra) return { ok: false, erro: "parametros" };
    const checked = await inspectIntent(options.simulacao, a.id, v.p, ctx);
    return priorResult(checked, efeito) ?? { ok: false, erro: "indeterminado" };
  }
  if (modo === "simular" || !a.palavra) {
    try {
      const resultado = modo === "simular" ? await a.simular(v.p) : await a.executar(v.p, ctx);
      const candidate = (resultado.candidato as { sha256?: unknown } | undefined)?.sha256;
      const ready = a.id !== "publicar.pedir" || typeof candidate === "string" && /^[a-f0-9]{64}$/.test(candidate);
      const simulationParams = a.id === "publicar.pedir" && ready ? { candidato: candidate } : v.p;
      const simulacao = await recordRead(a.id, simulationParams, modo, ctx, resultado, modo === "simular" && !!a.palavra && ready);
      return modo === "simular" ? { ok: true, modo, efeito, palavra: a.palavra ?? null, resultado, ...(simulacao ? { simulacao } : {}) } : { ok: true, modo, efeito, resultado };
    } catch { return { ok: false, erro: "falhou" }; }
  }
  if (String(confirmacao ?? "").trim() !== a.palavra) return { ok: false, erro: "confirmacao" };
  const enforceIntent = options.requireIntent || options.simulacao !== undefined;
  if (enforceIntent) {
    const previous = priorResult(await inspectIntent(options.simulacao, a.id, v.p, ctx), efeito);
    if (previous) return previous;
  }
  let journalId: number | undefined;
  try {
    const response = await tx<Resposta>(async client => {
      const lock = (await query<{ g: boolean }>("SELECT pg_try_advisory_xact_lock(hashtext(current_schema()), hashtext($1)) g", ["acao-grupo:" + a.grupo], client)).rows[0].g;
      if (!lock) return { ok: false, erro: "ocupado" } as Resposta;
      if (await recoverActions(ACOES.filter(item => item.grupo === a.grupo).map(item => item.id), a.id)) return { ok: false, erro: "indeterminado" } as Resposta;
      const admission = await prepareAction(a.id, v.p, ctx, a.transacional === true, enforceIntent ? options.simulacao : undefined);
      if ("checked" in admission) return priorResult(admission.checked, efeito) ?? { ok: false, erro: "parametros" };
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
      return { ok: false, erro: "falhou", encerrada: true, detalhe: String((error as Error).message).slice(0, 200) };
    }
    return { ok: false, erro: uncertain ? "indeterminado" : "falhou", detalhe: String((error as Error).message).slice(0, 200) };
  }
}
