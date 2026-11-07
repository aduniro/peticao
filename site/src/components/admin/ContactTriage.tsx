"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { adminJsonRequest } from "@/lib/admin-request";
import { triageViewHistory, triageViewSuggestion, type TriageView } from "@/lib/contact-triage-display";
import { brasilia } from "@/lib/time";

/** AV-8 approved. Read/queue only: this component cannot send a reply. */
export default function ContactTriage({ contactId }: { contactId: number }) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [writing, setWriting] = useState(false);
  const [history, setHistory] = useState<TriageView[]>([]), [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<{ subject: string; body: string } | null>(null);
  const opened = useRef(false), mounted = useRef(true), mutation = useRef(false), read = useRef<AbortController | null>(null);
  const cancelRead = useCallback(() => { const controller = read.current; read.current = null; controller?.abort(); }, []);
  const load = useCallback(async () => {
    if (!opened.current || read.current) return;
    const controller = new AbortController(); read.current = controller; setLoading(true); setError(null); setSuggestion(null);
    const transport: typeof fetch = (url, options) => fetch(url, { ...options, signal: controller.signal });
    try {
      const result = await adminJsonRequest(`/api/admin/contato/triagem?contato=${contactId}`, "GET", undefined, transport);
      if (!mounted.current || read.current !== controller) return;
      const parsed = result.ok ? triageViewHistory(result.history, contactId) : null;
      if (!parsed) { setError(result.ok ? "invalid_response" : "request_failed"); return; }
      setHistory(parsed);
      if (parsed[0]?.status === "complete") {
        const draft = await adminJsonRequest(`/api/admin/contato/minuta?contato=${contactId}`, "GET", undefined, transport);
        if (!mounted.current || read.current !== controller) return;
        const view = triageViewSuggestion(draft, contactId, parsed[0]);
        if (view) setSuggestion(view);
        else setError(typeof draft.error === "string" && /^[a-z_]{1,60}$/.test(draft.error) ? draft.error : "request_failed");
      }
    } finally {
      if (read.current === controller) { read.current = null; if (mounted.current) setLoading(false); }
    }
  }, [contactId]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancelRead(); };
  }, [cancelRead]);
  useEffect(() => {
    if (!open || error) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, history[0]?.status === "queued" || history[0]?.status === "running" ? 10000 : 30000);
    return () => clearInterval(timer);
  }, [open, error, history, load]);
  const toggle = (value: boolean) => {
    opened.current = value; setOpen(value);
    if (value) void load();
    else { cancelRead(); setLoading(false); setSuggestion(null); }
  };
  const reanalyze = async () => {
    if (mutation.current) return;
    mutation.current = true; setWriting(true); setSuggestion(null); cancelRead();
    try {
      const result = await adminJsonRequest("/api/admin/contato/triagem", "POST", { contato: contactId });
      if (!mounted.current) return;
      // Lost responses are reconciled by reading; never repeat a POST automatically.
      cancelRead();
      await load();
      if (!result.ok && mounted.current) setError("request_failed");
    } finally { mutation.current = false; if (mounted.current) setWriting(false); }
  };
  return <details className="v2-expansor" data-testid={`contact-triage-${contactId}`} onToggle={event => { if (event.target === event.currentTarget) toggle(event.currentTarget.open); }}>
    <summary>Análise automática</summary>
    <div className="v2-expansor-corpo" aria-busy={loading || writing}>
      <p className="small">Revise a análise antes de responder. Nenhuma resposta é enviada automaticamente.</p>
      <button type="button" className="adm-btn sm" disabled={writing || loading} onClick={() => void reanalyze()}>Reanalisar</button>
      {(loading || writing) && <progress aria-label="Análise automática" />}
      {error && <p className="err" role="alert"><code>{error}</code></p>}
      {history.map((job, index) => <section key={job.id}>
        <p className="small">#{job.revision} · {job.status} · {brasilia(job.finishedAt ?? job.createdAt, true)}{job.error ? ` · ${job.error}` : ""}</p>
        {job.analysis && <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(job.analysis, null, 2)}</pre>}
        {job.evidence && <details className="v2-expansor"><summary>Evidências</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(job.evidence, null, 2)}</pre></details>}
        {index === 0 && suggestion && <details className="v2-expansor"><summary>Sugestão de resposta</summary><p>{suggestion.subject}</p><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{suggestion.body}</pre></details>}
      </section>)}
    </div>
  </details>;
}
