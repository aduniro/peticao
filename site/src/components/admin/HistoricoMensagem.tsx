"use client";
import { useEffect, useId, useRef, useState } from "react";
import { brasilia } from "@/lib/time";

type Attempt = { id: string; provider: string; from_addr: string; state: string; started_at: string; finished_at: string | null; provider_id: string | null; error_code: string | null };
type Event = { id: string; provider: string; event_type: string; occurred_at: string; received_at: string; attempt_id: string | null };
type Detail = { source: "message" | "legacy_attempt"; record: { kind: string; to_addr: string; created_at: string; status: string }; attempts: Attempt[]; events?: Event[]; attempts_truncated: boolean; events_truncated?: boolean };
const STATUS: Record<string, string> = { prepared: "Aguardando envio", queued: "Aguardando envio", sending: "Envio em andamento", accepted: "Aceita pelo provedor", rejected: "Recusada", indeterminate: "Resultado a conferir" };
const EVENTS: Record<string, string> = { delivered: "Entrega informada pelo provedor", delivery: "Entrega informada pelo provedor", opened: "Abertura registrada", open: "Abertura registrada", clicked: "Clique registrado", click: "Clique registrado", bounce: "Devolução", complaint: "Reclamação" };
const time = (v: string | null) => v ? brasilia(v, true) : "—";

function detail(raw: any): Detail | null {
  if (raw?.ok !== true || !["message", "legacy_attempt"].includes(raw.source) || !raw.record || typeof raw.record.kind !== "string" || typeof raw.record.to_addr !== "string" || typeof raw.record.created_at !== "string" || typeof raw.record.status !== "string" || !Array.isArray(raw.attempts) || raw.attempts.length > 100 || typeof raw.attempts_truncated !== "boolean") return null;
  if (raw.attempts.some((r: any) => !r || typeof r.id !== "string" || typeof r.provider !== "string" || typeof r.from_addr !== "string" || typeof r.state !== "string" || typeof r.started_at !== "string" || r.finished_at !== null && typeof r.finished_at !== "string" || r.provider_id !== null && typeof r.provider_id !== "string" || r.error_code !== null && typeof r.error_code !== "string")) return null;
  if (raw.events !== undefined && (!Array.isArray(raw.events) || raw.events.length > 100 || raw.events.some((r: any) => !r || typeof r.id !== "string" || typeof r.provider !== "string" || typeof r.event_type !== "string" || typeof r.occurred_at !== "string" || typeof r.received_at !== "string" || r.attempt_id !== null && typeof r.attempt_id !== "string"))) return null;
  return raw;
}

/** Metadata only: no decrypt, resend, delivery inference or automatic mutation. */
export default function HistoricoMensagem({ recordKey }: { recordKey: string }) {
  const titleId = useId(), dialog = useRef<HTMLDialogElement>(null), pending = useRef<AbortController | null>(null);
  const [data, setData] = useState<Detail | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => () => pending.current?.abort(), []);
  const close = () => { pending.current?.abort(); pending.current = null; dialog.current?.close(); setBusy(false); setData(null); setError(null); };
  const load = async () => {
    if (pending.current) return;
    const active = new AbortController(); pending.current = active; setBusy(true); setData(null); setError(null); dialog.current?.showModal();
    const timer = setTimeout(() => active.abort(), 15_000);
    try {
      const response = await fetch(`/api/admin/emails/mensagens?id=${encodeURIComponent(recordKey)}`, { credentials: "same-origin", cache: "no-store", signal: active.signal });
      const raw = await response.json(); if (pending.current !== active) return;
      if (response.status === 401) { window.location.assign("/admin"); return; }
      const value = detail(raw); if (!response.ok || !value) throw new Error("metadata_unavailable"); setData(value);
    } catch { if (pending.current === active) setError("Não foi possível carregar o histórico. Feche e tente novamente."); }
    finally { clearTimeout(timer); if (pending.current === active) { pending.current = null; setBusy(false); } }
  };
  return <>
    <button type="button" className="adm-btn sm" disabled={busy} onClick={load}>Histórico</button>
    <dialog ref={dialog} className="adm-modal" aria-labelledby={titleId} onCancel={close} data-testid="mail-message-detail">
      <div className="in" aria-busy={busy}>
        <div className="adm-bar"><h3 id={titleId}>Histórico da mensagem</h3><button type="button" className="adm-btn" onClick={close}>Fechar</button></div>
        {error ? <p className="v2-aviso erro" role="alert">{error}</p> : null}
        {data ? <>
          <p><strong>{data.record.to_addr}</strong><br />{data.record.kind} · {time(data.record.created_at)}</p>
          {data.source === "legacy_attempt" ? <p>Registro anterior: uma tentativa antiga, sem mensagem original arquivada.</p> : <p>{STATUS[data.record.status] ?? data.record.status}. O aceite pelo provedor não comprova entrega ao destinatário.</p>}
          <h4>Tentativas</h4>
          {data.attempts.length ? <div className="table-scroll"><table style={{ minWidth: 680 }}><thead><tr><th>Início</th><th>Provedor</th><th>Remetente</th><th>Resultado</th><th>Fim</th><th>ID no provedor</th><th>Erro</th></tr></thead>
            <tbody>{data.attempts.map(a => <tr key={a.id}><td>{time(a.started_at)}</td><td>{a.provider}</td><td>{a.from_addr}</td><td>{STATUS[a.state] ?? a.state}</td><td>{time(a.finished_at)}</td><td>{a.provider_id ?? "—"}</td><td>{a.error_code ?? "—"}</td></tr>)}</tbody>
          </table></div> : <p>Nenhuma tentativa vinculada.</p>}
          {data.attempts_truncated ? <p>Exibindo as 100 tentativas mais recentes.</p> : null}
          <h4>Eventos vinculados</h4>
          {data.events?.length ? <ol>{data.events.map(e => <li key={e.id}>{time(e.occurred_at)} · {EVENTS[e.event_type] ?? e.event_type} · {e.provider}</li>)}</ol> : <p>Nenhum evento vinculado. A ausência de registro não comprova que a mensagem deixou de ser entregue.</p>}
          {data.events_truncated ? <p>Exibindo os 100 eventos mais recentes.</p> : null}
        </> : null}
      </div>
    </dialog>
  </>;
}
