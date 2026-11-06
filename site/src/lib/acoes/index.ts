import { audit, query, tx } from "../db";
import { reenvioIniciar, reenvioParar, reenvioStatus } from "./reenvio";
import { estadoVer } from "./estado";
import { publicarPedir, publicarStatus } from "./publicar";
import type { Acao, Ctx } from "./tipos";

export type { Acao, Ctx } from "./tipos";
export const ACOES: Acao[] = [estadoVer, publicarStatus, publicarPedir, reenvioStatus, reenvioIniciar, reenvioParar];
export const acaoPorId = (id: unknown) => ACOES.find((a) => a.id === id);

export type Resposta =
  | { ok: true; modo: "simular"; efeito: string; palavra: string | null; resultado: Record<string, unknown> }
  | { ok: true; modo: "executar"; efeito: string; resultado: Record<string, unknown> }
  | { ok: false; erro: "acao_desconhecida" | "parametros" | "confirmacao" | "ocupado" | "falhou"; detalhe?: string };

/** Registra a execução (tabela admin_acoes + cadeia de auditoria). Simulações também entram, marcadas como tal. */
async function registrar(a: Acao, p: unknown, modo: string, ctx: Ctx, resultado: unknown, ok: boolean) {
  await query("INSERT INTO admin_acoes(user_id,email,acao,parametros,modo,resultado,ok) VALUES($1,$2,$3,$4,$5,$6,$7)", [ctx.userId || null, ctx.email, a.id, JSON.stringify(p ?? {}), modo, JSON.stringify(resultado ?? {}), ok]);
  if (modo === "executar") await audit("admin_acao_executada", null, { acao: a.id, por: ctx.email, ok });
}

/**
 * Roda uma ação do registro. Simular nunca grava (fora o registro da própria consulta). Executar uma ação que altera algo exige `confirmacao`
 * igual à palavra da ação, e roda sob trava (uma execução por vez da mesma ação, mesmo com dois cliques ou duas abas).
 */
export async function rodarAcao(id: unknown, modo: unknown, parametros: unknown, confirmacao: unknown, ctx: Ctx): Promise<Resposta> {
  const a = acaoPorId(id);
  if (!a) return { ok: false, erro: "acao_desconhecida" };
  const v = a.validar(parametros);
  if (!v.ok) return { ok: false, erro: "parametros", detalhe: v.erro };
  const efeito = a.descrever(v.p);
  if (modo === "simular") {
    const resultado = await a.simular(v.p);
    await registrar(a, v.p, "simular", ctx, resultado, true);
    return { ok: true, modo: "simular", efeito, palavra: a.palavra ?? null, resultado };
  }
  if (a.palavra && String(confirmacao ?? "").trim() !== a.palavra) return { ok: false, erro: "confirmacao" };
  return tx(async (c) => {
    const got = (await query<{ g: boolean }>("SELECT pg_try_advisory_xact_lock(hashtext($1)) g", ["acao:" + a.id], c)).rows[0].g;
    if (!got) return { ok: false, erro: "ocupado" } as Resposta;
    try {
      const resultado = await a.executar(v.p, ctx);
      await registrar(a, v.p, "executar", ctx, resultado, true);
      return { ok: true, modo: "executar", efeito, resultado } as Resposta;
    } catch (e) {
      await registrar(a, v.p, "executar", ctx, { erro: String((e as Error).message).slice(0, 300) }, false).catch(() => {});
      return { ok: false, erro: "falhou", detalhe: String((e as Error).message).slice(0, 200) } as Resposta;
    }
  });
}
