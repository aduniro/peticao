import { query } from "./db";
import { LOCAL_SQL, onde, type Filtros } from "./assinaturas-explorar";
import { UF_POR_CODIGO, nomeMunicipio, paisInfo } from "./geo-server";

/**
 * Rankings do painel (somente leitura). Regras (ver o plano da Fase 3):
 *  - Servidor = categoria `servidor`; agrupa pela IFES normalizada (`ifes_acronym`; se vazia, o texto digitado em `institution`; senão "Não informada").
 *  - Campus = município do campus (`campus_ibge`; sem campus, a sede da IFES, via LOCAL_SQL). Não existe id de campus individual: dois campi da mesma IFES na mesma cidade se somam.
 *  - Cargo: `role` = docente | tae; "não declarado" = servidor com `role` vazio ou fora dessas duas opções.
 *  - Apoiador (sociedade civil) = categoria `apoiador`; estrangeiro = categoria `estrangeiro`.
 * Todas aceitam os mesmos filtros do explorador (status, período `de`/`ate`, UF, região...).
 */
export const SEM_IFES = "Não informada";
const IFES_SQL = `COALESCE(NULLIF(s.ifes_acronym, ''), NULLIF(s.institution, ''), '${SEM_IFES}')`;
const CONTAGENS = `COUNT(*)::int AS total, COUNT(*) FILTER (WHERE s.status='confirmed')::int AS conf, COUNT(*) FILTER (WHERE s.status='pending')::int AS pend`;
const CARGOS = `COUNT(*) FILTER (WHERE s.role='docente')::int AS docente, COUNT(*) FILTER (WHERE s.role='tae')::int AS tae, COUNT(*) FILTER (WHERE s.role IS NULL OR s.role NOT IN ('docente','tae'))::int AS nd`;

export type Cargos = { docente: number; tae: number; nd: number };
export type Contagem = { total: number; conf: number; pend: number };
export type LinhaIfes = Contagem & Cargos & { ifes: string };
export type LinhaCampus = Contagem & Cargos & { ifes: string; ibge: number; municipio: string; uf: string };
export type LinhaLocal = Contagem & { chave: string; nome: string; uf?: string };

const E = (f: Filtros, cond: string) => { const w = onde(f); return { sql: `${w.sql ? w.sql + " AND" : "WHERE"} ${cond}`, params: w.params }; };
const ordenar = <T extends Contagem>(l: T[], nome: (x: T) => string) => l.sort((a, b) => b.conf - a.conf || b.total - a.total || nome(a).localeCompare(nome(b), "pt"));
const ufDe = (ibge: number) => UF_POR_CODIGO[String(ibge).slice(0, 2)] ?? "";
const nomeDe = (ibge: number) => nomeMunicipio(ibge)?.n ?? String(ibge);

/** Ranking de IFES (servidores), com docentes, técnicos e não declarados. Ordena por confirmadas e depois pelo total. */
export async function rankingIfes(f: Filtros): Promise<LinhaIfes[]> {
  const w = E(f, "s.category = 'servidor'");
  const r = await query<LinhaIfes>(`SELECT ${IFES_SQL} AS ifes, ${CONTAGENS}, ${CARGOS} FROM signatures s ${w.sql} GROUP BY 1`, w.params);
  return ordenar(r.rows, (x) => x.ifes);
}

/** Ranking de campi (município do campus) de servidores; `ifes` restringe a uma IFES. */
export async function rankingCampi(f: Filtros, ifes?: string): Promise<LinhaCampus[]> {
  const w = E(f, `s.category = 'servidor' AND ${LOCAL_SQL} IS NOT NULL${ifes ? ` AND ${IFES_SQL} = $${onde(f).params.length + 1}` : ""}`);
  const r = await query<{ ifes: string; ibge: number } & Contagem & Cargos>(`SELECT ${IFES_SQL} AS ifes, ${LOCAL_SQL} AS ibge, ${CONTAGENS}, ${CARGOS} FROM signatures s ${w.sql} GROUP BY 1, 2`, ifes ? [...w.params, ifes] : w.params);
  return ordenar(r.rows.map((x) => ({ ...x, ibge: Number(x.ibge), municipio: nomeDe(Number(x.ibge)), uf: ufDe(Number(x.ibge)) })), (x) => x.municipio);
}

/** Apoiadores da sociedade civil por estado e por cidade. */
export async function rankingApoiadores(f: Filtros): Promise<{ porUf: LinhaLocal[]; porCidade: LinhaLocal[] }> {
  const w = E(f, `s.category = 'apoiador' AND ${LOCAL_SQL} IS NOT NULL`);
  const [uf, cid] = await Promise.all([
    query<{ c: string } & Contagem>(`SELECT LEFT(${LOCAL_SQL}::text, 2) AS c, ${CONTAGENS} FROM signatures s ${w.sql} GROUP BY 1`, w.params),
    query<{ c: number } & Contagem>(`SELECT ${LOCAL_SQL} AS c, ${CONTAGENS} FROM signatures s ${w.sql} GROUP BY 1`, w.params),
  ]);
  return {
    porUf: ordenar(uf.rows.map((x) => ({ ...x, chave: UF_POR_CODIGO[x.c] ?? x.c, nome: UF_POR_CODIGO[x.c] ?? x.c })), (x) => x.nome),
    porCidade: ordenar(cid.rows.map((x) => ({ ...x, chave: String(x.c), nome: nomeDe(Number(x.c)), uf: ufDe(Number(x.c)) })), (x) => x.nome),
  };
}

/** Estrangeiros por país e por universidade. */
export async function rankingExterior(f: Filtros): Promise<{ porPais: LinhaLocal[]; porUniversidade: (LinhaLocal & { pais: string })[] }> {
  const w = E(f, "s.category = 'estrangeiro'");
  const [pais, uni] = await Promise.all([
    query<{ c: string } & Contagem>(`SELECT COALESCE(s.country, '') AS c, ${CONTAGENS} FROM signatures s ${w.sql} GROUP BY 1`, w.params),
    query<{ c: string; pais: string } & Contagem>(`SELECT COALESCE(NULLIF(s.university, ''), 'Não informada') AS c, COALESCE(s.country, '') AS pais, ${CONTAGENS} FROM signatures s ${w.sql} GROUP BY 1, 2`, w.params),
  ]);
  const nomePais = (iso: string) => paisInfo(iso)?.n ?? (iso || "Não informado");
  return {
    porPais: ordenar(pais.rows.map((x) => ({ ...x, chave: x.c, nome: nomePais(x.c) })), (x) => x.nome),
    porUniversidade: ordenar(uni.rows.map((x) => ({ ...x, chave: `${x.pais}|${x.c}`, nome: x.c })), (x) => x.nome),
  };
}

/* ---------- Resumo geográfico para os popups do mapa (estado e região) ---------- */
export type CatCont = { docente: number; tae: number; nd: number; apoiador: number };
export type Pares = { conf: CatCont; pend: CatCont };
export type TopIfes = { sigla: string; conf: number; pend: number };
export type TopCampus = { nome: string; uf: string; ifes: string; conf: number; pend: number };
export type TopCidade = { nome: string; uf: string; conf: number; pend: number };
export type ResumoUf = { cat: Pares; rankIfes: TopIfes[]; rankCampi: TopCampus[]; rankCidades: TopCidade[] };
const zero = (): CatCont => ({ docente: 0, tae: 0, nd: 0, apoiador: 0 });
export const somaCat = (a: CatCont, b: CatCont): CatCont => ({ docente: a.docente + b.docente, tae: a.tae + b.tae, nd: a.nd + b.nd, apoiador: a.apoiador + b.apoiador });
export const novoResumo = (): ResumoUf => ({ cat: { conf: zero(), pend: zero() }, rankIfes: [], rankCampi: [], rankCidades: [] });

/**
 * Por UF (local do cadastro, sem estrangeiros): categorias dentro de confirmadas e de aguardando, e rankings de IFES, de campi e de cidades dos apoiadores (até `limite` cada).
 * Quatro consultas agregadas no total (não uma por estado).
 */
export async function resumoPorUf(limite = 10): Promise<Record<string, ResumoUf>> {
  const [cat, ifes, campi, cidades] = await Promise.all([
    query<{ uc: string; status: string } & CatCont>(`SELECT LEFT(${LOCAL_SQL}::text, 2) AS uc, s.status,
        COUNT(*) FILTER (WHERE s.category='servidor' AND s.role='docente')::int AS docente, COUNT(*) FILTER (WHERE s.category='servidor' AND s.role='tae')::int AS tae,
        COUNT(*) FILTER (WHERE s.category='servidor' AND (s.role IS NULL OR s.role NOT IN ('docente','tae')))::int AS nd, COUNT(*) FILTER (WHERE s.category='apoiador')::int AS apoiador
      FROM signatures s WHERE s.category <> 'estrangeiro' AND ${LOCAL_SQL} IS NOT NULL GROUP BY 1, 2`),
    query<{ uc: string; ifes: string; conf: number; pend: number }>(`SELECT LEFT(${LOCAL_SQL}::text, 2) AS uc, ${IFES_SQL} AS ifes, COUNT(*) FILTER (WHERE s.status='confirmed')::int AS conf, COUNT(*) FILTER (WHERE s.status='pending')::int AS pend
      FROM signatures s WHERE s.category = 'servidor' AND ${LOCAL_SQL} IS NOT NULL GROUP BY 1, 2`),
    query<{ ibge: number; ifes: string; conf: number; pend: number }>(`SELECT ${LOCAL_SQL} AS ibge, ${IFES_SQL} AS ifes, COUNT(*) FILTER (WHERE s.status='confirmed')::int AS conf, COUNT(*) FILTER (WHERE s.status='pending')::int AS pend
      FROM signatures s WHERE s.category = 'servidor' AND ${LOCAL_SQL} IS NOT NULL GROUP BY 1, 2`),
    query<{ ibge: number; conf: number; pend: number }>(`SELECT ${LOCAL_SQL} AS ibge, COUNT(*) FILTER (WHERE s.status='confirmed')::int AS conf, COUNT(*) FILTER (WHERE s.status='pending')::int AS pend
      FROM signatures s WHERE s.category = 'apoiador' AND ${LOCAL_SQL} IS NOT NULL GROUP BY 1`),
  ]);
  const out: Record<string, ResumoUf> = {};
  const de = (uf: string) => (out[uf] ??= novoResumo());
  for (const x of cat.rows) { const u = UF_POR_CODIGO[x.uc]; if (!u) continue; const c = de(u).cat[x.status === "confirmed" ? "conf" : "pend"]; c.docente += x.docente; c.tae += x.tae; c.nd += x.nd; c.apoiador += x.apoiador; }
  for (const x of ifes.rows) { const u = UF_POR_CODIGO[x.uc]; if (u) de(u).rankIfes.push({ sigla: x.ifes, conf: x.conf, pend: x.pend }); }
  for (const x of campi.rows) { const u = ufDe(Number(x.ibge)); if (u) de(u).rankCampi.push({ nome: nomeDe(Number(x.ibge)), uf: u, ifes: x.ifes, conf: x.conf, pend: x.pend }); }
  for (const x of cidades.rows) { const u = ufDe(Number(x.ibge)); if (u) de(u).rankCidades.push({ nome: nomeDe(Number(x.ibge)), uf: u, conf: x.conf, pend: x.pend }); }
  for (const r of Object.values(out)) { r.rankIfes = topo(r.rankIfes, (x) => x.sigla, limite); r.rankCampi = topo(r.rankCampi, (x) => x.nome, limite); r.rankCidades = topo(r.rankCidades, (x) => x.nome, limite); }
  return out;
}
/** Ordena por confirmadas e depois por aguardando; devolve os `limite` primeiros. */
export const topo = <T extends { conf: number; pend: number }>(l: T[], nome: (x: T) => string, limite: number): T[] =>
  [...l].sort((a, b) => b.conf - a.conf || b.pend - a.pend || nome(a).localeCompare(nome(b), "pt")).slice(0, limite);

/** Junta vários estados numa região: soma as categorias e refaz os rankings (somando a mesma IFES/campus em estados diferentes). */
export function juntarUfs(rs: ResumoUf[], limite = 10): ResumoUf {
  const o = novoResumo();
  const ifes = new Map<string, TopIfes>(), campi = new Map<string, TopCampus>(), cidades = new Map<string, TopCidade>();
  for (const r of rs) {
    o.cat.conf = somaCat(o.cat.conf, r.cat.conf); o.cat.pend = somaCat(o.cat.pend, r.cat.pend);
    for (const x of r.rankIfes) { const a = ifes.get(x.sigla) ?? { sigla: x.sigla, conf: 0, pend: 0 }; a.conf += x.conf; a.pend += x.pend; ifes.set(x.sigla, a); }
    for (const x of r.rankCampi) { const k = `${x.nome}|${x.uf}|${x.ifes}`; const a = campi.get(k) ?? { ...x, conf: 0, pend: 0 }; a.conf += x.conf; a.pend += x.pend; campi.set(k, a); }
    for (const x of r.rankCidades) { const k = `${x.nome}|${x.uf}`; const a = cidades.get(k) ?? { ...x, conf: 0, pend: 0 }; a.conf += x.conf; a.pend += x.pend; cidades.set(k, a); }
  }
  o.rankIfes = topo([...ifes.values()], (x) => x.sigla, limite); o.rankCampi = topo([...campi.values()], (x) => x.nome, limite); o.rankCidades = topo([...cidades.values()], (x) => x.nome, limite);
  return o;
}
