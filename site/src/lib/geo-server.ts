import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Base geográfica do painel (gerada por tools/geo/build.sh): centro dos municípios, países e estados. Carregada uma vez por processo. */
const dir = () => join(process.cwd(), "public", "data", "geo");
const g = globalThis as unknown as { __geoBase?: { mun: Record<string, [number, number]>; pais: Record<string, { n: string; c: [number, number] }>; nomes: Map<number, { n: string; uf: string }> } };

export function geo() {
  if (!g.__geoBase) {
    const mun = JSON.parse(readFileSync(join(dir(), "municipios-centroides.json"), "utf8"));
    const pais = JSON.parse(readFileSync(join(dir(), "paises.json"), "utf8"));
    const lista: [number, string, string][] = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "municipios.json"), "utf8"));
    g.__geoBase = { mun, pais, nomes: new Map(lista.map(([id, n, uf]) => [id, { n, uf }])) };
  }
  return g.__geoBase;
}

export const UF_POR_CODIGO: Record<string, string> = { "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO", "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA", "31": "MG", "32": "ES", "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS", "50": "MS", "51": "MT", "52": "GO", "53": "DF" };
export const CODIGO_POR_UF: Record<string, string> = Object.fromEntries(Object.entries(UF_POR_CODIGO).map(([c, u]) => [u, c]));

export const coordMunicipio = (ibge: number | null | undefined): [number, number] | null => (ibge ? geo().mun[String(ibge)] ?? null : null);
export const nomeMunicipio = (ibge: number | null | undefined) => (ibge ? geo().nomes.get(ibge) ?? null : null);
export const paisInfo = (iso: string | null | undefined) => (iso ? geo().pais[iso.toUpperCase()] ?? null : null);
