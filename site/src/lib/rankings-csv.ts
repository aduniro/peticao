/** CSV dos rankings: só contagens e nomes de IFES/campus/local (nunca pessoas). Protege contra "injeção de fórmula" em planilhas. */
export type Coluna = [chave: string, rotulo: string];
const celula = (v: unknown): string => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // Excel/Calc tratariam como fórmula
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Separador ponto e vírgula e BOM UTF-8: abre direto no Excel em português. */
export function paraCsv(colunas: Coluna[], linhas: Record<string, unknown>[]): string {
  return "﻿" + [colunas.map(([, r]) => celula(r)).join(";"), ...linhas.map((l) => colunas.map(([k]) => celula(l[k])).join(";"))].join("\r\n") + "\r\n";
}
const CONTAGENS: Coluna[] = [["total", "Total"], ["conf", "Confirmadas"], ["pend", "Aguardando"]];
const CARGOS: Coluna[] = [["docente", "Docentes"], ["tae", "Técnicos"], ["nd", "Não declarados"]];
export const COLUNAS: Record<string, Coluna[]> = {
  ifes: [["ifes", "IFES"], ...CARGOS, ...CONTAGENS],
  campi: [["municipio", "Campus (município)"], ["uf", "UF"], ["ifes", "IFES"], ...CARGOS, ...CONTAGENS],
  uf: [["nome", "Estado"], ...CONTAGENS],
  cidade: [["nome", "Cidade"], ["uf", "UF"], ...CONTAGENS],
  pais: [["nome", "País"], ...CONTAGENS],
  universidade: [["nome", "Universidade"], ["pais", "País (ISO)"], ...CONTAGENS],
};
