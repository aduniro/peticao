import municipiosRaw from "../../public/data/municipios.json";
import regiaoRaw from "../../public/data/regiao.json";

/** Municípios do IBGE (5.571) e as duas listas oficiais usadas pelo PLV: Amazônia Legal e Faixa de Fronteira. */
export type Mun = { id: number; name: string; uf: string };

export const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"] as const;
export const UF_NAMES: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão",
  MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte", RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

/** Sem acento, minúsculas, só letras e números: "Sant'Ana do Livramento" ≈ "santana do livramento". */
export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const squash = (s: string) => norm(s).replace(/ /g, "");

export const MUNS: Mun[] = (municipiosRaw as [number, string, string][]).map(([id, name, uf]) => ({ id, name, uf }));
const byId = new Map(MUNS.map((m) => [m.id, m]));
const byKey = new Map(MUNS.map((m) => [`${m.uf}|${squash(m.name)}`, m]));
const byName = new Map<string, Mun[]>();
for (const m of MUNS) byName.set(squash(m.name), [...(byName.get(squash(m.name)) ?? []), m]);

const AL = new Set((regiaoRaw as { al: string[] }).al.map(Number));
const FF_OFICIAL = (regiaoRaw as { ff: string[] }).ff.map(Number);
/** Municípios que a ADUNIR decidiu tratar como faixa de fronteira mesmo fora da lista do IBGE (ex.: Ibirubá-RS); a justificativa está em regiao.json (fonte.ffExcecoes). */
export const FF_EXCECOES: readonly number[] = ((regiaoRaw as { ffExcecoes?: string[] }).ffExcecoes ?? []).map(Number);
const FF = new Set([...FF_OFICIAL, ...FF_EXCECOES]);

export const municipalityById = (id: number | null | undefined) => (id ? byId.get(id) ?? null : null);

/** O par (UF, cidade) existe no IBGE? Tolera acento, caixa e apóstrofo. */
export function findMunicipality(uf: string, name: string): Mun | null {
  return byKey.get(`${uf.toUpperCase()}|${squash(name)}`) ?? null;
}

/** Cidade sem UF: devolve todas as homônimas (para pedir a UF quando houver mais de uma). */
export const findByName = (name: string): Mun[] => byName.get(squash(name)) ?? [];

export type Region = { amazoniaLegal: boolean; faixaFronteira: boolean };
export function regionOf(ibge: number | null | undefined): Region {
  return { amazoniaLegal: !!ibge && AL.has(ibge), faixaFronteira: !!ibge && FF.has(ibge) };
}
export const regionCriteria = (r: Region): "ambos" | "amazonia_legal" | "faixa_fronteira" | null =>
  r.amazoniaLegal && r.faixaFronteira ? "ambos" : r.amazoniaLegal ? "amazonia_legal" : r.faixaFronteira ? "faixa_fronteira" : null;
export const REGION_COUNTS = { municipios: MUNS.length, amazoniaLegal: AL.size, faixaFronteira: FF_OFICIAL.length, faixaFronteiraExcecoes: FF_EXCECOES.length };
