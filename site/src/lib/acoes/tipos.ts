/**
 * Central de Ações: cada ação é um item FIXO do registro (nada de texto livre executável). Tem:
 *  - validar: confere e normaliza os parâmetros (rejeita o que não conhece);
 *  - descrever: o efeito exato, em português, mostrado ANTES de executar;
 *  - simular: o que aconteceria, SEM gravar nada;
 *  - executar: faz de verdade (só chamado depois da confirmação por palavra + a confirmação extra por e-mail).
 * `palavra`: ação que altera algo exige que o usuário digite esta palavra; ação só de leitura não tem.
 */
export type Ctx = { userId: number; email: string };
export type Validado<P> = { ok: true; p: P } | { ok: false; erro: string };
export type Acao<P = any> = {
  id: string;
  grupo: "reenvio" | "estado";
  titulo: string;
  palavra?: string;
  validar(entrada: unknown): Validado<P>;
  descrever(p: P): string;
  simular(p: P): Promise<Record<string, unknown>>;
  executar(p: P, ctx: Ctx): Promise<Record<string, unknown>>;
};
