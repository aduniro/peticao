import { query } from "../db";
import { decifrar } from "../crypto-dados";
import { brasilia } from "../time";
import { esc } from "../csv";

/**
 * Lista por pessoa dos e-mails enviados: situação (entregue / aberto / clicado / devolvido) junto com o nome e os dados cadastrais,
 * para a ADUNIR poder contatar quem não recebeu. Só leitura. Os dados cadastrais vêm de um JOIN pelo e-mail (nada é copiado para as
 * tabelas de rastreio). Colunas escolhidas uma a uma: CPF (nem o hash), IP, navegador e tokens NUNCA entram aqui.
 */
export type Situacao = "clicou" | "abriu" | "entregue" | "devolvido" | "sem_registro";
export type FiltrosEntregas = { busca?: string; situacao?: string; cadastro?: string; categoria?: string; provedor?: string; pagina?: number; limite?: number };
export type LinhaEntrega = {
  email: string; nome: string; categoria: string; instituicao: string; cargo: string; campus: string; universidade: string; cidadeUf: string; pais: string;
  cadastro: "" | "aguardando" | "confirmado"; cadastradoEm: string; confirmadoEm: string; whatsapp: string;
  envios: number; ultimoEnvio: string; ultimoTipo: string; provedores: string; situacao: Situacao;
  entregueEm: string; abertoEm: string; clicouEm: string; devolucao: string; devolucaoMotivo: string; devolucaoEm: string;
};

const SITUACOES = ["clicou", "abriu", "entregue", "devolvido", "sem_registro"];
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : "");

function montar(f: FiltrosEntregas, limite: number, offset: number) {
  const p: unknown[] = [];
  const add = (v: unknown) => (p.push(v), `$${p.length}`);
  const w: string[] = [];
  const b = (f.busca ?? "").trim().slice(0, 80);
  if (b) { const x = add(`%${b.replace(/[\\%_]/g, "\\$&")}%`); w.push(`(t.e ILIKE ${x} OR t.nome ILIKE ${x})`); }
  if (f.situacao && SITUACOES.includes(f.situacao)) w.push(`t.situacao = ${add(f.situacao)}`);
  if (f.cadastro === "aguardando") w.push("t.cad_status = 'pending'");
  else if (f.cadastro === "confirmado") w.push("t.cad_status = 'confirmed'");
  else if (f.cadastro === "sem") w.push("t.sig_id IS NULL");
  if (f.categoria && ["servidor", "apoiador", "estrangeiro"].includes(f.categoria)) w.push(`t.categoria = ${add(f.categoria)}`);
  if (f.provedor) w.push(`${add(f.provedor.slice(0, 40))} = ANY(t.provs)`);
  const lim = add(limite), off = add(offset);
  const sql = `
    WITH emails AS (
      SELECT lower(to_addr) e FROM mail_log WHERE status='sent'
      UNION SELECT lower(email) FROM mail_engagement
      UNION SELECT lower(email) FROM mail_events),
    env AS (
      SELECT lower(to_addr) e, COUNT(*)::int envios, MAX(ts) ultimo_ts,
             (array_agg(kind ORDER BY ts DESC))[1] ultimo_tipo, array_agg(DISTINCT provider) provs
      FROM mail_log WHERE status='sent' GROUP BY 1),
    eng AS (SELECT lower(email) e, MIN(delivered_at) entregue, MIN(opened_at) aberto, MIN(clicked_at) clicou FROM mail_engagement GROUP BY 1),
    ev AS (SELECT DISTINCT ON (lower(email)) lower(email) e, type, reason, ts FROM mail_events ORDER BY lower(email), ts DESC),
    t AS (
      SELECT m.e, COALESCE(env.envios, 0) envios, env.ultimo_ts, env.ultimo_tipo,
             COALESCE(env.provs, '{}') provs, eng.entregue, eng.aberto, eng.clicou, ev.type ev_tipo, ev.reason ev_motivo, ev.ts ev_ts,
             CASE WHEN eng.clicou IS NOT NULL THEN 'clicou' WHEN eng.aberto IS NOT NULL THEN 'abriu' WHEN eng.entregue IS NOT NULL THEN 'entregue'
                  WHEN ev.e IS NOT NULL THEN 'devolvido' ELSE 'sem_registro' END situacao,
             s.id sig_id, COALESCE(s.name, '') nome, COALESCE(s.category, '') categoria, s.institution, s.role, s.campus, s.university, s.city, s.uf, s.country,
             s.status cad_status, s.created_at cad_criado, s.confirmed_at cad_confirmado, s.wa_cipher, s.wa_optin_at
      FROM emails m
      LEFT JOIN env ON env.e = m.e LEFT JOIN eng ON eng.e = m.e LEFT JOIN ev ON ev.e = m.e
      LEFT JOIN LATERAL (SELECT id, name, category, institution, role, campus, university, city, uf, country, status, created_at, confirmed_at, wa_cipher, wa_optin_at
                         FROM signatures WHERE lower(email) = m.e ORDER BY id DESC LIMIT 1) s ON true)
    SELECT t.*, COUNT(*) OVER()::int total FROM t ${w.length ? "WHERE " + w.join(" AND ") : ""}
    ORDER BY t.ultimo_ts DESC NULLS LAST, t.e LIMIT ${lim} OFFSET ${off}`;
  return { sql, p };
}

export async function listarEntregas(f: FiltrosEntregas = {}): Promise<{ total: number; pagina: number; limite: number; linhas: LinhaEntrega[] }> {
  const limite = Math.min(50_000, Math.max(1, f.limite ?? 50));
  const pagina = Math.max(1, Math.floor(f.pagina ?? 1));
  const { sql, p } = montar(f, limite, (pagina - 1) * limite);
  const r = await query<any>(sql, p);
  const linhas = r.rows.map((x): LinhaEntrega => ({
    email: x.e, nome: x.nome ?? "", categoria: x.categoria ?? "", instituicao: x.institution ?? "", cargo: x.role ?? "", campus: x.campus ?? "", universidade: x.university ?? "",
    cidadeUf: [x.city, x.uf].filter(Boolean).join("/"), pais: x.country ?? "",
    cadastro: x.cad_status === "confirmed" ? "confirmado" : x.cad_status === "pending" ? "aguardando" : "",
    cadastradoEm: x.cad_criado ?? "", confirmadoEm: x.cad_confirmado ?? "",
    whatsapp: x.wa_cipher && x.wa_optin_at ? decifrar(x.wa_cipher, `wa:${x.sig_id}`) ?? "" : "",
    envios: x.envios, ultimoEnvio: iso(x.ultimo_ts), ultimoTipo: x.ultimo_tipo ?? "", provedores: (x.provs ?? []).join(", "), situacao: x.situacao,
    entregueEm: iso(x.entregue), abertoEm: iso(x.aberto), clicouEm: iso(x.clicou),
    devolucao: x.ev_tipo ?? "", devolucaoMotivo: x.ev_motivo ?? "", devolucaoEm: iso(x.ev_ts),
  }));
  return { total: r.rows[0]?.total ?? 0, pagina, limite, linhas };
}

export const CSV_CABECALHO = ["email", "nome", "categoria", "instituicao", "cargo", "campus", "universidade", "cidade_uf", "pais", "cadastro", "cadastrado_em", "confirmado_em", "whatsapp",
  "situacao_do_email", "envios", "ultimo_envio", "ultimo_tipo", "provedores", "entregue_em", "aberto_em", "clicou_em", "devolucao", "motivo_da_devolucao", "devolucao_em"];

export async function entregasCsv(f: FiltrosEntregas = {}): Promise<{ csv: string; total: number }> {
  const { linhas, total } = await listarEntregas({ ...f, pagina: 1, limite: 50_000 });
  const t = (v: string) => (v ? brasilia(v) : "");
  const corpo = linhas.map((l) => [l.email, l.nome, l.categoria, l.instituicao, l.cargo, l.campus, l.universidade, l.cidadeUf, l.pais, l.cadastro, t(l.cadastradoEm), t(l.confirmadoEm), l.whatsapp,
    l.situacao, l.envios, t(l.ultimoEnvio), l.ultimoTipo, l.provedores, t(l.entregueEm), t(l.abertoEm), t(l.clicouEm), l.devolucao, l.devolucaoMotivo, t(l.devolucaoEm)].map(esc).join(","));
  return { csv: "﻿" + [CSV_CABECALHO.join(","), ...corpo].join("\n"), total };
}
