/** Shared role rules; safe to import in browser components (no database or secrets). */
export const NIVEIS = ["leitura", "edicao", "exclusao", "total"] as const;
export type Nivel = (typeof NIVEIS)[number];
export const ROTULO_NIVEL: Record<Nivel, string> = { leitura: "Leitura", edicao: "Edição", exclusao: "Exclusão", total: "Total" };
export const ehNivel = (value: unknown): value is Nivel => typeof value === "string" && (NIVEIS as readonly string[]).includes(value);
export const nivelOk = (tem: Nivel, exige: Nivel): boolean => ehNivel(tem) && ehNivel(exige) && NIVEIS.indexOf(tem) >= NIVEIS.indexOf(exige);
