import type { PoolClient } from "pg";

/**
 * Central de Ações: cada ação é um item FIXO do registro (nada de texto livre executável). Tem:
 *  - validar: confere e normaliza os parâmetros (rejeita o que não conhece);
 *  - descrever: o efeito exato, em português, mostrado ANTES de executar;
 *  - simular: o que aconteceria, SEM gravar nada;
 *  - executar: faz de verdade (só chamado depois da confirmação por palavra + a confirmação extra por e-mail).
 * `palavra`: ação que altera algo exige que o usuário digite esta palavra; ação só de leitura não tem.
 */
export type Ctx = { userId: number; email: string; client?: PoolClient; requestId?: string };
/** The operation proves that no external request was accepted. */
export class ActionNotApplied extends Error {}
export type Validado<P> = { ok: true; p: P } | { ok: false; erro: string };
export type Acao<P = any> = {
  id: string;
  grupo: "reenvio" | "estado" | "publicar" | "terminal";
  titulo: string;
  palavra?: string;
  transacional?: boolean;
  aceite?: boolean;
  aposCommit?(p: P, ctx: Ctx, resultado: Record<string, unknown>): Promise<Record<string, unknown>>;
  validar(entrada: unknown): Validado<P>;
  descrever(p: P): string;
  simular(p: P): Promise<Record<string, unknown>>;
  executar(p: P, ctx: Ctx): Promise<Record<string, unknown>>;
};
