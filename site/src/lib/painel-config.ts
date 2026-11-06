import { getSetting, setSetting } from "./batches";

/** Preferências de exibição do painel (guardadas na tabela `settings`, valem para todos os usuários). Ligadas por padrão. */
export const CHAVES_PAINEL = { popupEstado: "painel_popup_estado", popupRegiao: "painel_popup_regiao" } as const;
export type ChavePainel = keyof typeof CHAVES_PAINEL;
export type ConfigPainel = Record<ChavePainel, boolean>;
export const ehChavePainel = (x: unknown): x is ChavePainel => typeof x === "string" && Object.prototype.hasOwnProperty.call(CHAVES_PAINEL, x); // nunca "in": "toString" e "__proto__" passariam

export async function lerConfigPainel(): Promise<ConfigPainel> {
  const [e, r] = await Promise.all([getSetting(CHAVES_PAINEL.popupEstado, "1"), getSetting(CHAVES_PAINEL.popupRegiao, "1")]);
  return { popupEstado: e !== "0", popupRegiao: r !== "0" };
}
export async function gravarConfigPainel(chave: ChavePainel, valor: boolean) { await setSetting(CHAVES_PAINEL[chave], valor ? "1" : "0"); }
