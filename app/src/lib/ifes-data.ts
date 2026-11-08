import raw from "../../public/data/ifes.json";
import { findByName, municipalityById, norm, regionOf, type Mun } from "./geo-data";

/** Instituições federais de ensino (universidades, institutos, CEFETs…) e os municípios dos campi (fonte: Censo da Educação Superior, INEP). */
export type Ifes = { s: string; n: string; k: "U" | "IF" | "CEFET" | "O"; u: string; m: number; c: number[] };
export const IFES = raw as Ifes[];

const sq = (s: string) => norm(s).replace(/ /g, "");
const byAcr = new Map(IFES.map((i) => [sq(i.s), i]));
const byName = new Map(IFES.map((i) => [sq(i.n), i]));

/** Acha a IFES pela sigla ("UNIR") ou pelo nome; aceita "UNIR - Fundação…" como a lista mostra. */
export function findIfes(text: string): Ifes | null {
  const t = text.trim();
  if (!t) return null;
  const head = t.split(/\s[-–—]\s/)[0];
  return byAcr.get(sq(head)) ?? byName.get(sq(t)) ?? byAcr.get(sq(t)) ?? null;
}

/** Municípios da sede e dos campi da instituição que estão na Amazônia Legal e/ou na faixa de fronteira (listas oficiais do IBGE). */
export function regionCampusIds(i: Ifes | null): number[] {
  if (!i) return [];
  return [...new Set([i.m, ...i.c])].filter((id) => { const r = regionOf(id); return r.amazoniaLegal || r.faixaFronteira; });
}
/** TODOS os campi (e a sede) da instituição ficam na Amazônia Legal? Então o servidor dela é obrigado a marcar a caixa de lotação na região. */
export function allCampiInAmazonia(i: Ifes | null): boolean {
  if (!i) return false;
  const ids = [...new Set([i.m, ...i.c])];
  return ids.length > 0 && ids.every((id) => regionOf(id).amazoniaLegal);
}
/** A instituição tem sede ou ao menos um campus na Amazônia Legal ou na faixa de fronteira? Só então o servidor dela pode marcar a lotação na região. */
export const ifesEligible = (i: Ifes | null) => regionCampusIds(i).length > 0;

export const campusCities = (i: Ifes | null): Mun[] => (i ? i.c.map((id) => municipalityById(id)).filter((m): m is Mun => !!m) : []);

export type CampusResolution = { ibge: number | null; listed: boolean; name: string };

/** Liga o campus digitado/escolhido a um município do IBGE. `listed` = o município consta nos campi conhecidos da IFES. */
export function resolveCampus(ifes: Ifes | null, text: string, pickedIbge?: number | null): CampusResolution | null {
  const clean = text.replace(/^campus( de| do| da)?\s+/i, "").replace(/\s*\([A-Z]{2}\)\s*$/, "").trim();
  if (pickedIbge) {
    const m = municipalityById(pickedIbge);
    return m ? { ibge: m.id, listed: !!ifes && (ifes.c.includes(m.id) || ifes.m === m.id), name: m.name } : null;
  }
  if (clean.length < 2) return null;
  const cands = findByName(clean);
  const pick = (ifes && cands.find((m) => ifes.c.includes(m.id))) || (ifes && cands.find((m) => m.uf === ifes.u)) || (cands.length === 1 ? cands[0] : null);
  return pick ? { ibge: pick.id, listed: !!ifes && (ifes.c.includes(pick.id) || ifes.m === pick.id), name: pick.name } : { ibge: null, listed: false, name: clean };
}

/** "UFMT - Universidade Federal de Mato Grosso": sigla seguida do nome por extenso (quando a sigla está na lista oficial das IFES). */
export function institutionLabel(inst: string | null | undefined): string {
  const t = (inst ?? "").trim();
  if (!t) return "";
  const i = findIfes(t);
  return i && i.s.toLowerCase() === t.toLowerCase() ? `${i.s} - ${i.n}` : t;
}
