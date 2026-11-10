import { query } from "./db";
import type { PoolClient, QueryResultRow } from "pg";

/** Server-only context: routes derive contact access from the current account, never query params. */
export type ExplorerReadContext = { client?: PoolClient; contacts?: boolean; checkpoint?: () => void };
async function explorerQuery<T extends QueryResultRow>(sql: string, params: unknown[], context: ExplorerReadContext) {
  context.checkpoint?.();
  const result = await query<T>(sql, params, context.client);
  context.checkpoint?.();
  return result;
}
function safeCount(value: unknown): number {
  if (typeof value !== "number" && (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value))) throw new Error("invalid_explorer_count");
  const n = Number(value); if (!Number.isSafeInteger(n) || n < 0) throw new Error("invalid_explorer_count"); return n;
}
import { IFES } from "./ifes-data";
import { CODIGO_POR_UF, UF_POR_CODIGO, coordMunicipio, nomeMunicipio, paisInfo } from "./geo-server";

/** Filtros centrais do painel: os MESMOS valem para o mapa, a tabela, as facetas (listas dos filtros) e o dashboard. */
import { decifrar } from "./crypto-dados";
import { formatarTelefone } from "./whatsapp/telefone";
import { type Filtros, type ChaveFiltro, filtrosVazios, parseFiltros, filtrosParaQuery } from "./assinaturas-filtros";
export { type Filtros, type ChaveFiltro, filtrosVazios, parseFiltros, filtrosParaQuery };

/** Município do local do cadastro: campus (servidor com lotação), cidade (apoiador) ou, sem isso, a sede da instituição federal. */
const aspas = (s: string) => `'${s.replace(/'/g, "''")}'`;
const SEDES = IFES.filter((i) => /^[A-Za-z0-9 ._()-]+$/.test(i.s)).map((i) => `WHEN ${aspas(i.s)} THEN ${Number(i.m)}`).join(" ");
export const LOCAL_SQL = `COALESCE(s.campus_ibge, s.city_ibge, CASE s.ifes_acronym ${SEDES} END)`;

export function onde(f: Filtros, ignorar?: ChaveFiltro): { sql: string; params: unknown[] } {
  const w: string[] = []; const p: unknown[] = [];
  const add = (cond: string, v: unknown) => { p.push(v); w.push(cond.replace("$$", `$${p.length}`)); };
  const lista = (k: ChaveFiltro, cond: string, mapa?: (x: string) => string) => { if (k !== ignorar && f[k].length) add(cond, mapa ? f[k].map(mapa) : f[k]); };
  lista("categoria", "s.category = ANY($$::text[])"); lista("instituicao", "s.institution = ANY($$::text[])"); lista("cargo", "s.role = ANY($$::text[])");
  lista("campus", "s.campus = ANY($$::text[])"); lista("pais", "s.country = ANY($$::text[])"); lista("universidade", "s.university = ANY($$::text[])"); lista("status", "s.status = ANY($$::text[])");
  if (ignorar !== "uf" && f.uf.length) add(`LEFT(${LOCAL_SQL}::text, 2) = ANY($$::text[])`, f.uf.map((u) => CODIGO_POR_UF[u]).filter(Boolean));
  if (ignorar !== "cidade" && f.cidade.length) add(`${LOCAL_SQL} = ANY($$::int[])`, f.cidade.map(Number).filter(Number.isInteger));
  if (ignorar !== "regiao" && f.regiao.length) {
    // Aceita os dois vocabulários: o da tela (amazonia_legal / faixa_fronteira / ambos / fora) e o curto (al / ff / fora).
    const tem = (...v: string[]) => v.some((x) => f.regiao.includes(x));
    const c: string[] = [];
    if (tem("al", "amazonia_legal")) c.push("s.region_criteria IN ('amazonia_legal','ambos')");
    if (tem("ff", "faixa_fronteira")) c.push("s.region_criteria IN ('faixa_fronteira','ambos')");
    if (tem("ambos")) c.push("s.region_criteria = 'ambos'");
    if (tem("fora")) c.push("(s.category = 'servidor' AND s.region_validated IS NOT TRUE)");
    if (c.length) w.push(`(${c.join(" OR ")})`);
  }
  if (ignorar !== "whatsapp" && f.whatsapp.length === 1) w.push(f.whatsapp[0] === "sim" ? "s.wa_cipher IS NOT NULL" : "s.wa_cipher IS NULL");
  if (ignorar !== "cpf" && f.cpf.length === 1) w.push(f.cpf[0] === "sim" ? "s.cpf_name_check = 'match'" : "s.cpf_name_check IS DISTINCT FROM 'match'");
  if (f.q) { p.push(`%${f.q.replace(/[%_\\]/g, (m) => "\\" + m)}%`); w.push(`(s.name ILIKE $${p.length})`); }
  if (f.de) add("s.created_at::timestamptz >= $$::date", f.de);
  if (f.ate) add("s.created_at::timestamptz < ($$::date + 1)", f.ate);
  return { sql: w.length ? `WHERE ${w.join(" AND ")}` : "", params: p };
}

export type Linha = { id: number; nome: string; categoria: string; instituicao: string; cargo: string; regiao: string; campus: string; cidadeUf: string; pais: string; status: string; criada: string; confirmada: string | null; cpf: boolean; whatsapp: string; waConfirmado: boolean };
export type Ponto = { chave: string; lat: number; lon: number; nome: string; uf: string; conf: number; pend: number; por: Record<string, { conf: number; pend: number }> };
export type Faceta = { v: string; n: number; rotulo?: string };
export type Resultado = { total: number; linhas: Linha[]; pontos: Ponto[]; facetas: Record<string, Faceta[]>; totais: { confirmadas: number; pendentes: number; servidores: number; apoiadores: number; estrangeiros: number; cpfConferido: number }; semLocal: number };

const ORDEM: Record<string, string> = { nome: "s.name", categoria: "s.category", instituicao: "COALESCE(s.institution, s.university)", cargo: "s.role", campus: "s.campus", status: "s.status", criada: "s.created_at", confirmada: "s.confirmed_at" };
const REGIAO_ROTULO: Record<string, string> = { amazonia_legal: "Amazônia Legal", faixa_fronteira: "Faixa de Fronteira", ambos: "Amazônia Legal e Faixa de Fronteira" };

export async function linhas(f: Filtros, o: { pagina?: number; limite?: number; ordem?: string; dir?: string; todas?: boolean } = {}, context: ExplorerReadContext = {}): Promise<{ total: number; linhas: Linha[] }> {
  const w = onde(f); const lim = o.limite ?? 50, page = o.pagina ?? 1, off = (page - 1) * lim;
  if (!Number.isSafeInteger(lim) || lim < 1 || !Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(off)) throw new Error("invalid_explorer_page");
  const ord = `${ORDEM[o.ordem ?? "criada"] ?? ORDEM.criada} ${o.dir === "asc" ? "ASC" : "DESC"} NULLS LAST, s.id DESC`;
  const total = safeCount((await explorerQuery<{ n: string }>(`SELECT COUNT(*)::text n FROM signatures s ${w.sql}`, w.params, context)).rows[0].n);
  const r = await explorerQuery<any>(`SELECT s.id, s.name, s.category, s.institution, s.role, s.region_criteria, s.region_validated, s.campus, s.city, s.uf, s.country, s.university, s.status, s.created_at, s.confirmed_at, s.cpf_name_check, ${context.contacts ? "s.wa_cipher," : ""} s.wa_confirmed_at, ${LOCAL_SQL} AS local
    FROM signatures s ${w.sql} ORDER BY ${ord}${o.todas ? "" : ` LIMIT $${w.params.length + 1} OFFSET $${w.params.length + 2}`}`, o.todas ? w.params : [...w.params, lim, off], context);
  return { total, linhas: r.rows.map((x) => {
    if (context.contacts && x.wa_cipher && (typeof x.wa_cipher !== "string" || x.wa_cipher.length > 4096)) throw new Error("explorer_contact_budget");
    const m = nomeMunicipio(x.local);
    return { id: x.id, nome: x.name, categoria: x.category, instituicao: x.category === "estrangeiro" ? x.university ?? "" : x.category === "servidor" ? x.institution ?? "" : "", cargo: x.role === "docente" ? "Docente" : x.role === "tae" ? "Técnico-administrativo" : "",
      regiao: x.category === "servidor" ? (x.region_validated ? REGIAO_ROTULO[x.region_criteria] ?? "Sim" : "Fora da região") : "", campus: x.campus ?? "",
      cidadeUf: x.category === "apoiador" ? [x.city ?? m?.n, x.uf ?? m?.uf].filter(Boolean).join("/") : "", pais: x.category === "estrangeiro" ? paisInfo(x.country)?.n ?? x.country ?? "" : "", status: x.status, criada: x.created_at, confirmada: x.confirmed_at, cpf: x.cpf_name_check === "match", whatsapp: context.contacts && x.wa_cipher ? formatarTelefone(decifrar(x.wa_cipher, `wa:${x.id}`) ?? "") : "", waConfirmado: !!x.wa_confirmed_at };
  }) };
}

export async function pontos(f: Filtros, context: ExplorerReadContext = {}): Promise<{ pontos: Ponto[]; semLocal: number }> {
  const w = onde(f);
  const r = await explorerQuery<{ category: string; ibge: number | null; pais: string | null; conf: number; pend: number }>(`SELECT s.category, CASE WHEN s.category='estrangeiro' THEN NULL ELSE ${LOCAL_SQL} END AS ibge, CASE WHEN s.category='estrangeiro' THEN s.country END AS pais,
      COUNT(*) FILTER (WHERE s.status='confirmed')::text conf, COUNT(*) FILTER (WHERE s.status='pending')::text pend FROM signatures s ${w.sql} GROUP BY 1,2,3`, w.params, context);
  const mapa = new Map<string, Ponto>(); let semLocal = 0;
  for (const raw of r.rows) {
    const x = { ...raw, conf: safeCount(raw.conf), pend: safeCount(raw.pend) };
    let chave: string, c: [number, number] | null, nome: string, uf = "";
    if (x.category === "estrangeiro") { const p = paisInfo(x.pais); chave = `p:${x.pais}`; c = p?.c ?? null; nome = p?.n ?? x.pais ?? "?"; }
    else { const m = nomeMunicipio(x.ibge); chave = `m:${x.ibge}`; c = coordMunicipio(x.ibge); nome = m ? `${m.n}/${m.uf}` : "?"; uf = m?.uf ?? ""; }
    if (!c) { semLocal += x.conf + x.pend; continue; }
    const pt = mapa.get(chave) ?? { chave, lat: c[1], lon: c[0], nome, uf, conf: 0, pend: 0, por: {} };
    pt.conf += x.conf; pt.pend += x.pend; pt.por[x.category] = { conf: x.conf, pend: x.pend }; mapa.set(chave, pt);
  }
  return { pontos: [...mapa.values()].sort((a, b) => b.conf + b.pend - (a.conf + a.pend)), semLocal };
}

async function faceta(f: Filtros, k: ChaveFiltro, expr: string, extra = "", context: ExplorerReadContext = {}): Promise<Faceta[]> {
  const w = onde(f, k);
  const r = await explorerQuery<{ v: string; n: number }>(`SELECT ${expr} AS v, COUNT(*)::text n FROM signatures s ${w.sql ? w.sql + " AND" : "WHERE"} ${expr} IS NOT NULL ${extra} GROUP BY 1 ORDER BY COUNT(*) DESC, v`, w.params, context);
  return r.rows.map((x) => ({ v: String(x.v), n: safeCount(x.n) }));
}

export async function facetas(f: Filtros, context: ExplorerReadContext = {}): Promise<Record<string, Faceta[]>> {
  const reads = [
    () => faceta(f, "instituicao", "s.institution", "AND s.category='servidor'", context), () => faceta(f, "cargo", "s.role", "AND s.role IS NOT NULL", context), () => faceta(f, "campus", "s.campus", "AND s.campus <> ''", context),
    () => faceta(f, "pais", "s.country", "AND s.category='estrangeiro'", context), () => faceta(f, "universidade", "s.university", "AND s.category='estrangeiro'", context),
    () => faceta(f, "uf", `LEFT(${LOCAL_SQL}::text, 2)`, "AND s.category <> 'estrangeiro'", context), () => faceta(f, "cidade", LOCAL_SQL, "AND s.category <> 'estrangeiro'", context),
  ];
  const results: Faceta[][] = [];
  if (context.client) { for (const read of reads) results.push(await read()); }
  else results.push(...await Promise.all(reads.map(read => read())));
  const [instituicao, cargo, campus, pais, universidade, uf, cidade] = results;
  return {
    instituicao, cargo: cargo.map((x) => ({ ...x, rotulo: x.v === "docente" ? "Docente" : x.v === "tae" ? "Técnico-administrativo (TAE)" : x.v })), campus,
    pais: pais.map((x) => ({ ...x, rotulo: paisInfo(x.v)?.n ?? x.v })), universidade,
    uf: uf.map((x) => ({ v: UF_POR_CODIGO[x.v] ?? x.v, n: safeCount(x.n) })).filter((x) => x.v.length === 2),
    cidade: cidade.map((x) => { const m = nomeMunicipio(Number(x.v)); return { v: x.v, n: x.n, rotulo: m ? `${m.n}/${m.uf}` : x.v }; }),
  };
}

export async function totais(f: Filtros, context: ExplorerReadContext = {}) {
  const w = onde(f);
  const raw = (await explorerQuery<any>(`SELECT COUNT(*) FILTER (WHERE s.status='confirmed')::text AS confirmadas, COUNT(*) FILTER (WHERE s.status='pending')::text AS pendentes, COUNT(*) FILTER (WHERE s.category='servidor')::text AS servidores,
      COUNT(*) FILTER (WHERE s.category='apoiador')::text AS apoiadores, COUNT(*) FILTER (WHERE s.category='estrangeiro')::text AS estrangeiros, COUNT(*) FILTER (WHERE s.cpf_name_check='match')::text AS "cpfConferido" FROM signatures s ${w.sql}`, w.params, context)).rows[0];
  return { confirmadas: safeCount(raw.confirmadas), pendentes: safeCount(raw.pendentes), servidores: safeCount(raw.servidores), apoiadores: safeCount(raw.apoiadores), estrangeiros: safeCount(raw.estrangeiros), cpfConferido: safeCount(raw.cpfConferido) };
}

export async function explorar(f: Filtros, o: { pagina?: number; limite?: number; ordem?: string; dir?: string } = {}, context: ExplorerReadContext = {}): Promise<Resultado> {
  if (context.client) {
    const l = await linhas(f, o, context), p = await pontos(f, context), fa = await facetas(f, context), t = await totais(f, context);
    return { total: l.total, linhas: l.linhas, pontos: p.pontos, semLocal: p.semLocal, facetas: fa, totais: t };
  }
  const [l, p, fa, t] = await Promise.all([linhas(f, o, context), pontos(f, context), facetas(f, context), totais(f, context)]);
  return { total: l.total, linhas: l.linhas, pontos: p.pontos, semLocal: p.semLocal, facetas: fa, totais: t };
}

export type DiaSerie = { d: string; iniciadas: number; confirmadas: number };
/** Série por dia (horário de Brasília): cadastros iniciados (created_at) e confirmações (confirmed_at), com os mesmos filtros. */
export async function serieDiaria(f: Filtros, context: ExplorerReadContext = {}): Promise<DiaSerie[]> {
  const w = onde(f);
  const ini = await explorerQuery<{ d: string; n: number }>(`SELECT to_char((s.created_at::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') d, COUNT(*)::text n FROM signatures s ${w.sql} GROUP BY 1`, w.params, context);
  const conf = await explorerQuery<{ d: string; n: number }>(`SELECT to_char((s.confirmed_at::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') d, COUNT(*)::text n FROM signatures s ${w.sql ? w.sql + " AND" : "WHERE"} s.status='confirmed' AND s.confirmed_at IS NOT NULL GROUP BY 1`, w.params, context);
  const m = new Map<string, DiaSerie>();
  const get = (d: string) => { let x = m.get(d); if (!x) { x = { d, iniciadas: 0, confirmadas: 0 }; m.set(d, x); } return x; };
  for (const r of ini.rows) get(r.d).iniciadas = safeCount(r.n);
  for (const r of conf.rows) get(r.d).confirmadas = safeCount(r.n);
  return [...m.values()].sort((a, b) => a.d.localeCompare(b.d));
}
