"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { brasilia } from "@/lib/time";
import type { EventRow, Point, RequestPoint, RequestRow, Summary, VisitorRow } from "@/lib/monitor";
import { REQ_COLORS } from "./req-colors";

const VisitorMap = dynamic(() => import("./VisitorMap"), { ssr: false, loading: () => <div className="map" /> });
const KIND: Record<string, string> = { sign_pending: "assinatura aguardando e-mail", sign_confirmed: "assinatura confirmada", email_invalid: "e-mail inexistente", email_blocked: "e-mail bloqueado", mail_queued: "e-mail na fila de reenvio", foreign_rejected: "estrangeiro recusado" };
const WINDOWS: [string, string][] = [["1h", "Última hora"], ["24h", "24 horas"], ["7d", "7 dias"], ["30d", "30 dias"], ["all", "Tudo"]];
const SIG: Record<string, string> = { confirmed: "assinou", pending: "aguardando confirmação" };
const fmt = (iso: string) => brasilia(iso);

export default function MonitorClient() {
  const [w, setW] = useState("24h");
  const [data, setData] = useState<{ summary: Summary; points: Point[]; visitors: VisitorRow[]; requestPoints: RequestPoint[]; requests: RequestRow[] } | null>(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<VisitorRow | null>(null);
  const [timeline, setTimeline] = useState<EventRow[]>([]);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/monitor?w=${w}`, { cache: "no-store" });
    if (!r.ok) return setErr("Não foi possível carregar (sessão expirada?).");
    setErr(""); setData(await r.json());
  }, [w]);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);

  async function open(v: VisitorRow) {
    setSel(v); setTimeline([]);
    const r = await fetch(`/api/admin/monitor/visitante/${encodeURIComponent(v.visitor_id)}`, { cache: "no-store" });
    if (r.ok) setTimeline((await r.json()).events);
  }
  const s = data?.summary;
  return (
    <section>
      <div className="seg-row" role="tablist" aria-label="Período">
        {WINDOWS.map(([k, l]) => <button key={k} role="tab" aria-selected={w === k} className={w === k ? "on" : ""} onClick={() => setW(k)}>{l}</button>)}
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      <div className="stats">
        <div><strong>{s?.visitors ?? "…"}</strong><span>visitantes</span></div>
        <div><strong>{s?.pageviews ?? "…"}</strong><span>páginas vistas</span></div>
        <div><strong>{s?.clicks ?? "…"}</strong><span>cliques</span></div>
        <div><strong>{s?.formStarts ?? "…"}</strong><span>começaram o formulário</span></div>
        <div><strong>{s?.signedVisitors ?? "…"}</strong><span>assinaram (inclui pendentes)</span></div>
        <div><strong>{s?.confirmedVisitors ?? "…"}</strong><span>confirmaram o e-mail</span></div>
      </div>
      <VisitorMap points={data?.points ?? []} requests={data?.requestPoints ?? []} />
      <p className="small">Fundo azul/verde: visitantes (verde = local com assinatura). Círculos coloridos: requisições por local ·{" "}
        {([["confirmed", "assinatura confirmada"], ["pending", "aguardando confirmação do e-mail"], ["invalid", "e-mail inexistente"], ["blocked", "e-mail bloqueado"], ["queued", "e-mail na fila"]] as const).map(([k, l]) => <span key={k} className="legend"><i style={{ background: REQ_COLORS[k] }} />{l}</span>)}</p>
      <h2>Requisições de assinatura e segurança ({data?.requests.length ?? 0})</h2>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Quando (Brasília)</th><th>Tipo</th><th>IP</th><th>Local</th><th>Situação da assinatura</th><th>Detalhe</th></tr></thead>
          <tbody>
            {data?.requests.map((r, i) => (
              <tr key={i}><td>{fmt(r.ts)}</td><td><strong>{KIND[r.kind] ?? r.kind}</strong></td><td>{r.ip ?? "—"}</td><td>{[r.city, r.region, r.country].filter(Boolean).join(", ") || "—"}</td>
                <td>{r.sig_status ? SIG[r.sig_status] ?? r.sig_status : "—"}</td><td className="small">{r.detail ?? ""}</td></tr>
            ))}
            {data && data.requests.length === 0 && <tr><td colSpan={6}>Nenhuma requisição neste período.</td></tr>}
          </tbody>
        </table>
      </div>
      <h2>Visitantes ({data?.visitors.length ?? 0})</h2>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Último acesso (Brasília)</th><th>IP</th><th>Local</th><th>Provedor</th><th>Aparelho</th><th>Páginas</th><th>Cliques</th><th>Indicação</th><th>Assinou?</th></tr></thead>
          <tbody>
            {data?.visitors.map((v) => (
              <tr key={v.visitor_id} onClick={() => open(v)} className={sel?.visitor_id === v.visitor_id ? "sel" : "clickable"} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && open(v)}>
                <td>{fmt(v.last_seen)}</td>
                <td>{v.ip ?? "—"}{v.ip_version ? <span className="small"> IPv{v.ip_version}</span> : null}</td>
                <td>{[v.city, v.region, v.country].filter(Boolean).join(", ") || "—"}</td>
                <td>{v.isp ?? "—"}{v.asn ? <span className="small"> AS{v.asn}</span> : null}</td>
                <td>{[v.device, v.os, v.browser].filter(Boolean).join(" · ")}</td>
                <td>{v.pageviews}{v.paths?.length ? <span className="small"> ({v.paths.join(", ")})</span> : null}</td>
                <td>{v.clicks}</td><td>{v.ref_code ?? "—"}</td>
                <td>{v.sig_status ? <strong>{SIG[v.sig_status]}</strong> : "não"}</td>
              </tr>
            ))}
            {data && data.visitors.length === 0 && <tr><td colSpan={9}>Nenhum acesso neste período.</td></tr>}
          </tbody>
        </table>
      </div>
      {sel && (
        <div className="box" role="region" aria-label="Linha do tempo do visitante">
          <h3>Linha do tempo · {[sel.city, sel.region].filter(Boolean).join(", ") || sel.ip || "visitante"} <button className="ghost" onClick={() => setSel(null)}>fechar</button></h3>
          <ol className="timeline">
            {timeline.map((e, i) => <li key={i}><time>{fmt(e.ts)}</time> <strong>{e.type}</strong> {e.path ?? ""} {e.target ? `· ${e.target}` : ""} {e.label ? `“${e.label}”` : ""}</li>)}
            {timeline.length === 0 && <li>Carregando…</li>}
          </ol>
        </div>
      )}
    </section>
  );
}
