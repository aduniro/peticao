/** Filtros do explorador de assinaturas (sem acesso ao banco: serve ao navegador e ao servidor). */
export type Filtros = { categoria: string[]; instituicao: string[]; cargo: string[]; campus: string[]; regiao: string[]; uf: string[]; cidade: string[]; pais: string[]; universidade: string[]; status: string[]; cpf: string[]; whatsapp: string[]; q: string; de: string; ate: string };
const LISTAS = ["categoria", "instituicao", "cargo", "campus", "regiao", "uf", "cidade", "pais", "universidade", "status", "cpf", "whatsapp"] as const;
export type ChaveFiltro = (typeof LISTAS)[number];

/** New links encode ambiguous values as JSON arrays; ordinary and historical comma-separated links remain readable. */
export function parseListaFiltro(raw: string, encoding: "legacy" | "json" = "legacy"): string[] | null {
  if (!raw) return [];
  if (encoding === "legacy") return raw.split(",");
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.every(item => typeof item === "string") ? value : null;
  } catch { return null; }
}

export function filtrosVazios(): Filtros { return { categoria: [], instituicao: [], cargo: [], campus: [], regiao: [], uf: [], cidade: [], pais: [], universidade: [], status: [], cpf: [], whatsapp: [], q: "", de: "", ate: "" }; }
export function parseFiltros(sp: URLSearchParams): Filtros {
  const f = filtrosVazios();
  for (const k of LISTAS) {
    const raw = sp.get(k) ?? "";
    f[k] = (parseListaFiltro(raw, sp.get("listas") === "json" ? "json" : "legacy") ?? raw.split(",")).map((x) => x.trim()).filter(Boolean).slice(0, 200);
  }
  f.q = (sp.get("q") ?? "").slice(0, 80); f.de = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("de") ?? "") ? sp.get("de")! : ""; f.ate = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("ate") ?? "") ? sp.get("ate")! : "";
  return f;
}
export function filtrosParaQuery(f: Partial<Filtros>): string {
  const p = new URLSearchParams();
  const json = LISTAS.some(k => f[k]?.some(v => v.includes(",") || v.trimStart().startsWith("[")));
  if (json) p.set("listas", "json");
  for (const k of LISTAS) if (f[k]?.length) {
    const values = f[k]!;
    p.set(k, json ? JSON.stringify(values) : values.join(","));
  }
  if (f.q) p.set("q", f.q); if (f.de) p.set("de", f.de); if (f.ate) p.set("ate", f.ate);
  return p.toString();
}

