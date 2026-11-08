import { query } from "../db";

/** Consultas do painel de e-mails (somente leitura). */
export type ProviderRow = { provider: string; sent24: number; failed24: number; sent7: number; failed7: number; last: string | null };
export async function porProvedor(): Promise<ProviderRow[]> {
  return (await query<ProviderRow>(`SELECT provider,
      COUNT(*) FILTER (WHERE status='sent' AND ts > now()-interval '24 hours')::int sent24, COUNT(*) FILTER (WHERE status='failed' AND ts > now()-interval '24 hours')::int failed24,
      COUNT(*) FILTER (WHERE status='sent' AND ts > now()-interval '7 days')::int sent7, COUNT(*) FILTER (WHERE status='failed' AND ts > now()-interval '7 days')::int failed7,
      MAX(ts)::text last FROM mail_log WHERE ts > now()-interval '7 days' AND status<>'queued' GROUP BY provider ORDER BY sent7 DESC`)).rows;
}

export type KindRow = { kind: string; channel: string; sent24: number; failed24: number; sent7: number; failed7: number };
export async function porTipo(): Promise<KindRow[]> {
  return (await query<KindRow>(`SELECT kind, channel,
      COUNT(*) FILTER (WHERE status='sent' AND ts > now()-interval '24 hours')::int sent24, COUNT(*) FILTER (WHERE status='failed' AND ts > now()-interval '24 hours')::int failed24,
      COUNT(*) FILTER (WHERE status='sent' AND ts > now()-interval '7 days')::int sent7, COUNT(*) FILTER (WHERE status='failed' AND ts > now()-interval '7 days')::int failed7
      FROM mail_log WHERE ts > now()-interval '7 days' AND status<>'queued' GROUP BY kind, channel ORDER BY sent7 DESC`)).rows;
}

export type DomainRow = { dominio: string; provider: string; enviados: number };
/** Por subdomínio do remetente (o que aparece no "De"), e o provedor que entregou. */
export async function porSubdominio(): Promise<DomainRow[]> {
  return (await query<DomainRow>(`SELECT lower(split_part(regexp_replace(COALESCE(from_addr,''), '^.*<|>$', '', 'g'), '@', 2)) dominio, provider, COUNT(*)::int enviados
      FROM mail_log WHERE status='sent' AND ts > now()-interval '7 days' AND from_addr IS NOT NULL GROUP BY 1,2 ORDER BY enviados DESC`)).rows;
}

export type SesHealth = { enviados7: number; hard7: number; soft7: number; reclamacoes7: number; taxaDevolucao: number; taxaReclamacao: number; nivel: "ok" | "atencao" | "risco" | "sem_dados" };
/** Saúde do SES pelos nossos próprios registros: a Amazon revisa a conta a 5% de devolução e 0,1% de reclamação. */
export async function sesSaude(): Promise<SesHealth> {
  const r = (await query<{ env: number; hard: number; soft: number; comp: number }>(`SELECT
      (SELECT COUNT(*)::int FROM mail_log WHERE provider='ses' AND status='sent' AND ts > now()-interval '7 days') env,
      (SELECT COUNT(*)::int FROM mail_events WHERE provider='ses' AND type='hard_bounce' AND ts > now()-interval '7 days') hard,
      (SELECT COUNT(*)::int FROM mail_events WHERE provider='ses' AND type='soft_bounce' AND ts > now()-interval '7 days') soft,
      (SELECT COUNT(*)::int FROM mail_events WHERE provider='ses' AND type='complaint' AND ts > now()-interval '7 days') comp`)).rows[0];
  const taxa = r.env ? (r.hard / r.env) * 100 : 0, tc = r.env ? (r.comp / r.env) * 100 : 0;
  const nivel = r.env < 20 ? "sem_dados" : taxa >= 5 || tc >= 0.1 ? "risco" : taxa >= 2 || tc >= 0.05 ? "atencao" : "ok";
  return { enviados7: r.env, hard7: r.hard, soft7: r.soft, reclamacoes7: r.comp, taxaDevolucao: Math.round(taxa * 100) / 100, taxaReclamacao: Math.round(tc * 1000) / 1000, nivel };
}

export type EventSummary = { provider: string; type: string; n24: number; n7: number; total: number };
export async function eventosResumo(): Promise<EventSummary[]> {
  return (await query<EventSummary>(`SELECT provider, type, COUNT(*) FILTER (WHERE ts > now()-interval '24 hours')::int n24, COUNT(*) FILTER (WHERE ts > now()-interval '7 days')::int n7, COUNT(*)::int total
      FROM mail_events GROUP BY provider, type ORDER BY provider, type`)).rows;
}

export type SemEmail = { id: number; version: string; name: string; email: string; category: string; instituicao: string; criada: string; motivo: string; detalhe: string; provedor: string; dominio: string };
/**
 * Cadastros ainda pendentes cujo e-mail de confirmação provavelmente NÃO chegou: o endereço devolveu/foi bloqueado/está suprimido,
 * está parado na fila de reenvio, ou (depois que o registro de envios começou) nenhum provedor chegou a aceitar a mensagem.
 */
export async function semEmailEntregue(limit = 500): Promise<SemEmail[]> {
  const rows = (await query<any>(`SELECT s.id, s.xmin::text AS version, s.name, s.email, s.category, COALESCE(s.institution, s.university, '') inst, s.created_at,
      (SELECT e.type || ' (' || e.provider || '): ' || COALESCE(e.reason,'') FROM mail_events e WHERE lower(e.email)=lower(s.email) AND e.type IN ('hard_bounce','soft_bounce','blocked','complaint') ORDER BY e.ts DESC LIMIT 1) AS evento,
      (SELECT e.provider FROM mail_events e WHERE lower(e.email)=lower(s.email) AND e.type IN ('hard_bounce','soft_bounce','blocked','complaint') ORDER BY e.ts DESC LIMIT 1) AS provedor,
      (SELECT x.reason FROM email_suppressions x WHERE lower(x.email)=lower(s.email) LIMIT 1) AS supressao,
      EXISTS(SELECT 1 FROM mail_outbox o WHERE lower(o.to_addr)=lower(s.email) AND o.status='pending') AS na_fila,
      EXISTS(SELECT 1 FROM mail_log l WHERE lower(l.to_addr)=lower(s.email) AND l.status='sent' AND l.kind='confirmacao') AS enviado,
      s.created_at::timestamptz >= COALESCE((SELECT MIN(ts) FROM mail_log), now()) AS depois_do_registro
    FROM signatures s WHERE s.status='pending' ORDER BY s.created_at DESC`)).rows;
  const out: SemEmail[] = [];
  for (const r of rows) {
    let motivo = "", detalhe = "";
    if (r.evento) { motivo = "devolvido"; detalhe = r.evento; }
    else if (r.supressao) { motivo = "suprimido"; detalhe = `lista de supressão (${r.supressao})`; }
    else if (r.na_fila) { motivo = "na fila"; detalhe = "parado na fila de reenvio"; }
    else if (r.depois_do_registro && !r.enviado) { motivo = "sem envio"; detalhe = "nenhum provedor aceitou a mensagem"; }
    if (motivo) out.push({ id: r.id, version: r.version, name: r.name, email: r.email, category: r.category, instituicao: r.inst, criada: r.created_at, motivo, detalhe, provedor: r.provedor ?? "", dominio: String(r.email).split("@")[1]?.toLowerCase() ?? "" });
    if (out.length >= limit) break;
  }
  return out;
}

export type CheckRow = { via: string; verdict: string; n24: number; n7: number; ms: number | null };
export async function verificacoes(): Promise<CheckRow[]> {
  return (await query<CheckRow>(`SELECT via, verdict, COUNT(*) FILTER (WHERE ts > now()-interval '24 hours')::int n24, COUNT(*) FILTER (WHERE ts > now()-interval '7 days')::int n7, ROUND(AVG(ms))::int ms
      FROM email_checks WHERE ts > now()-interval '7 days' GROUP BY via, verdict ORDER BY via, n7 DESC`)).rows;
}
export async function dominiosLentos(): Promise<{ dominio: string; n: number }[]> {
  return (await query<{ dominio: string; n: number }>(`SELECT domain dominio, COUNT(*)::int n FROM email_checks WHERE via='reacher' AND verdict='indisponivel' AND ts > now()-interval '7 days' GROUP BY domain ORDER BY n DESC LIMIT 10`)).rows;
}

export async function statusProvedores(): Promise<Record<string, { data: any; at: string }>> {
  const r = await query<{ provider: string; data: any; at: string }>("SELECT provider, data, at::text FROM provider_status");
  return Object.fromEntries(r.rows.map((x) => [x.provider, { data: x.data, at: x.at }]));
}
