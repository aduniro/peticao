"use client";
import { isInstitutionEligibleForServer } from "./institution-eligibility";
/** Dados públicos carregados sob demanda no navegador (IBGE e IFES): evitam pesar a página inicial. */
export type Mun = { id: number; name: string; uf: string };
export type Ifes = { id?: string; a?: string[]; s: string; n: string; k: string; u: string; m: number; c: number[] };

export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const squash = (s: string) => norm(s).replace(/ /g, "");

const cache = new Map<string, Promise<unknown>>();
const load = <T,>(url: string): Promise<T> => {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.json(); }).catch((e) => { cache.delete(url); throw e; }));
  return cache.get(url) as Promise<T>;
};

export type Geo = { muns: Mun[]; byId: Map<number, Mun>; al: Set<number>; ff: Set<number> };
let geoP: Promise<Geo> | null = null;
export function loadGeo(): Promise<Geo> {
  geoP ??= Promise.all([load<[number, string, string][]>("/data/municipios.json"), load<{ al: string[]; ff: string[]; ffExcecoes?: string[] }>("/data/regiao.json")]).then(([m, r]) => {
    const muns = m.map(([id, name, uf]) => ({ id, name, uf }));
    return { muns, byId: new Map(muns.map((x) => [x.id, x])), al: new Set(r.al.map(Number)), ff: new Set([...r.ff, ...(r.ffExcecoes ?? [])].map(Number)) };
  }).catch((e) => { geoP = null; throw e; });
  return geoP;
}
export const institutionSearchText = (institution: Ifes): string => [institution.s, institution.n, ...(institution.a ?? [])].join(" ");

export function matchesInstitutionSelection(text: string, institution: Ifes | null): boolean {
  if (!institution) return false;
  const value = squash(text);
  return !!value && [institution.s, institution.n, `${institution.s} - ${institution.n}`, ...(institution.a ?? [])].some((label) => squash(label) === value);
}

export function mergeInstitutionCatalog(base: Ifes[], extra: Ifes[]): Ifes[] {
  const institutions = new Map<string, Ifes>();
  for (const institution of [...base, ...extra]) {
    const key = squash(institution.s);
    if (!key || institutions.has(key)) throw new Error("Duplicate institution in catalog");
    institutions.set(key, institution);
  }
  return [...institutions.values()];
}

let ifesP: Promise<Ifes[]> | null = null;
export function loadIfes(): Promise<Ifes[]> {
  ifesP ??= Promise.all([
    load<Ifes[]>("/data/ifes.json"),
    load<Ifes[]>("/data/server-institution-extras.json"),
  ]).then(([base, extra]) => mergeInstitutionCatalog(base, extra).filter((institution) => isInstitutionEligibleForServer(institution.id))).catch((error) => { ifesP = null; throw error; });
  return ifesP;
}

/** Ordena sugestões: começa com o texto primeiro, depois contém. */
export function rank<T>(items: T[], text: string, get: (x: T) => string, limit = 50): T[] {
  const t = norm(text);
  if (!t) return items.slice(0, limit);
  const a: T[] = [], b: T[] = [];
  const exact = items.filter((x) => norm(get(x).split(" ")[0]) === t || norm(get(x)) === t);
  for (const x of items) { if (exact.includes(x)) continue; const n = norm(get(x)); if (n.startsWith(t)) a.push(x); else if (n.includes(t)) b.push(x); if (a.length >= limit) break; }
  return [...exact, ...a, ...b].slice(0, limit);
}
