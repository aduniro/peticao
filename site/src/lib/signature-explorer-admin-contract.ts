import { parseListaFiltro, type Filtros } from "./assinaturas-filtros";

/** Pure admin boundary. Does not change the tolerant parser used by existing consumers. */
export type SignatureExplorerActor = { userId: number; email: string; sessaoId: number | null };
export const SIGNATURE_EXPLORER_ORDER = ["nome", "categoria", "instituicao", "cargo", "campus", "status", "criada", "confirmada"] as const;
export type SignatureExplorerOrder = typeof SIGNATURE_EXPLORER_ORDER[number];
export type SignatureExplorerOptions = { filters: Filtros; page: number; limit: number; order: SignatureExplorerOrder; direction: "asc" | "desc"; format: "json" | "csv" };
export type SignatureExplorerCapabilities = { contacts: boolean };
export type SignatureExplorerCoverage = { matched: number; totalRowsReturned: number; facetsComplete: true; mapComplete: true; complete: true };
export type SignatureExplorerLine = { id: number; nome: string; categoria: string; instituicao: string; cargo: string; regiao: string; campus: string; cidadeUf: string; pais: string; status: string; criada: string; confirmada: string | null; cpf: boolean; whatsapp: string; waConfirmado: boolean };
export type SignatureExplorerPoint = { chave: string; lat: number; lon: number; nome: string; uf: string; conf: number; pend: number; por: Record<string, { conf: number; pend: number }> };
export type SignatureExplorerFacet = { v: string; n: number; rotulo?: string };
export type SignatureExplorerResult = { ok: true; asOf: string; capabilities: SignatureExplorerCapabilities; coverage: SignatureExplorerCoverage; total: number; linhas: SignatureExplorerLine[]; pontos: SignatureExplorerPoint[]; facetas: Record<string, SignatureExplorerFacet[]>; totais: { confirmadas: number; pendentes: number; servidores: number; apoiadores: number; estrangeiros: number; cpfConferido: number }; semLocal: number; pagina: number; limite: number };
export type SignatureExplorerFailure = { ok: false; error: "invalid" | "forbidden" | "unavailable" };

const LISTS = ["categoria", "instituicao", "cargo", "campus", "regiao", "uf", "cidade", "pais", "universidade", "status", "cpf", "whatsapp"] as const;
const SCALARS = ["q", "de", "ate", "pagina", "limite", "ordem", "dir", "formato", "listas"];
const ENUMS: Partial<Record<typeof LISTS[number], readonly string[]>> = {
  categoria: ["servidor", "apoiador", "estrangeiro"],
  regiao: ["al", "ff", "amazonia_legal", "faixa_fronteira", "ambos", "fora"],
  status: ["confirmed", "pending"], cpf: ["sim", "nao"], whatsapp: ["sim", "nao"],
  uf: ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"],
};
const invalid = { ok: false, error: "invalid" } as const;
export function validSignatureExplorerDate(raw: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(raw)) return false;
  const [y, m, d] = raw.split("-").map(Number);
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  return d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}
/** No silent clamp/truncation; malformed/over-budget input is not a successful query. */
export function signatureExplorerSearch(sp: URLSearchParams): { ok: true; options: SignatureExplorerOptions } | typeof invalid {
  if (sp.toString().length > 65536) return invalid;
  for (const [key] of sp) if ((!LISTS.includes(key as typeof LISTS[number]) && !SCALARS.includes(key)) || sp.getAll(key).length !== 1) return invalid;
  if (sp.has("listas") && sp.get("listas") !== "json") return invalid;
  const filters = { q: "", de: "", ate: "" } as Filtros;
  for (const key of LISTS) {
    const raw = sp.get(key);
    const decoded = parseListaFiltro(raw ?? "", sp.get("listas") === "json" ? "json" : "legacy");
    if (decoded === null) return invalid;
    const values = decoded.map(x => x.trim());
    if (values.length > 200 || values.some(x => x.length === 0 || x.length > 512 || /[\u0000-\u001f\u007f]/.test(x))) return invalid;
    if (new Set(values).size !== values.length || (ENUMS[key] && values.some(x => !ENUMS[key]!.includes(x)))) return invalid;
    if (key === "cidade" && values.some(x => !/^[1-9][0-9]{6}$/.test(x))) return invalid;
    filters[key] = values;
  }
  filters.q = sp.get("q") ?? "";
  if (filters.q.length > 80 || /[\u0000-\u001f\u007f]/.test(filters.q)) return invalid;
  for (const key of ["de", "ate"] as const) {
    filters[key] = sp.get(key) ?? "";
    if (filters[key] && !validSignatureExplorerDate(filters[key])) return invalid;
  }
  if (filters.de && filters.ate && filters.de > filters.ate) return invalid;
  const int = (key: string, fallback: number): number | null => {
    const raw = sp.get(key);
    if (raw === null) return fallback;
    if (!/^[1-9][0-9]{0,15}$/.test(raw)) return null;
    const n = Number(raw); return Number.isSafeInteger(n) ? n : null;
  };
  const page = int("pagina", 1), limit = int("limite", 50);
  const order = sp.get("ordem") ?? "criada", direction = sp.get("dir") ?? "desc", format = sp.get("formato") ?? "json";
  if (page === null || limit === null || limit < 10 || limit > 200 || !Number.isSafeInteger((page - 1) * limit)) return invalid;
  if (!SIGNATURE_EXPLORER_ORDER.includes(order as SignatureExplorerOrder) || !["asc", "desc"].includes(direction) || !["json", "csv"].includes(format)) return invalid;
  return { ok: true, options: { filters, page, limit, order: order as SignatureExplorerOrder, direction: direction as "asc" | "desc", format: format as "json" | "csv" } };
}

/** Server-derived capability only; no client/query field grants access to contact. */
export function signatureExplorerCapabilities(level: string): SignatureExplorerCapabilities {
  return { contacts: ["edicao", "exclusao", "total"].includes(level) };
}
export function signatureExplorerSafeCount(raw: unknown): number | null {
  if (typeof raw !== "number" && (typeof raw !== "string" || !/^(0|[1-9][0-9]*)$/.test(raw))) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function validSignatureExplorerActor(actor: SignatureExplorerActor): boolean {
  const id = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 2147483647;
  return !!actor && id(actor.userId) && id(actor.sessaoId) && typeof actor.email === "string" && actor.email.length > 0 && actor.email.length <= 254;
}
