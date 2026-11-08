/** Filtros do explorador de assinaturas (sem acesso ao banco: serve ao navegador e ao servidor). */
export type Filtros = { categoria: string[]; instituicao: string[]; cargo: string[]; campus: string[]; regiao: string[]; uf: string[]; cidade: string[]; pais: string[]; universidade: string[]; status: string[]; cpf: string[]; whatsapp: string[]; q: string; de: string; ate: string };
const LISTAS = ["categoria", "instituicao", "cargo", "campus", "regiao", "uf", "cidade", "pais", "universidade", "status", "cpf", "whatsapp"] as const;
export type ChaveFiltro = (typeof LISTAS)[number];

export function filtrosVazios(): Filtros { return { categoria: [], instituicao: [], cargo: [], campus: [], regiao: [], uf: [], cidade: [], pais: [], universidade: [], status: [], cpf: [], whatsapp: [], q: "", de: "", ate: "" }; }
export function parseFiltros(sp: URLSearchParams): Filtros {
  const f = filtrosVazios();
  for (const k of LISTAS) f[k] = (sp.get(k) ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 200);
  f.q = (sp.get("q") ?? "").slice(0, 80); f.de = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("de") ?? "") ? sp.get("de")! : ""; f.ate = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("ate") ?? "") ? sp.get("ate")! : "";
  return f;
}
export function filtrosParaQuery(f: Partial<Filtros>): string {
  const p = new URLSearchParams();
  for (const k of LISTAS) if (f[k]?.length) p.set(k, f[k]!.join(","));
  if (f.q) p.set("q", f.q); if (f.de) p.set("de", f.de); if (f.ate) p.set("ate", f.ate);
  return p.toString();
}

