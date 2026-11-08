"use client";
import { useEffect, useRef, useState } from "react";
import type { MailHistoryRow } from "@/lib/mail/history";

type Preview = { subject: string; html: string };
const LABEL = "Ver prévia protegida";
const NOTICE = "Esta prévia oculta links, imagens e códigos e simplifica a formatação. O e-mail original foi preservado.";

export default function PreviaEmail({ initial, next: firstNext, names }: { initial: MailHistoryRow[]; next: string | null; names: Record<string, string> }) {
  const dialog = useRef<HTMLDialogElement>(null), controller = useRef<AbortController | null>(null);
  const [rows, setRows] = useState(initial), [next, setNext] = useState(firstNext);
  const [preview, setPreview] = useState<Preview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { setRows(initial); setNext(firstNext); }, [initial, firstNext]);
  const auth = (response: Response, data: any) => {
    if (response.status === 401) { window.location.assign("/admin"); return true; }
    if (response.status === 403 && data?.erro === "stepup") { window.location.assign("/admin/confirmar?volta=%2Fadmin%2Femails"); return true; }
    return false;
  };
  const close = () => { controller.current?.abort(); controller.current = null; dialog.current?.close(); setPreview(null); setError(null); setBusy(false); };
  const open = async (id: string) => {
    if (controller.current) return;
    const active = new AbortController(); controller.current = active; setBusy(true); setError(null); setPreview(null); dialog.current?.showModal();
    const timer = setTimeout(() => active.abort(), 15_000);
    try {
      const response = await fetch(`/api/admin/emails/mensagens/previa?id=${encodeURIComponent(id)}`, { credentials: "same-origin", cache: "no-store", signal: active.signal });
      const data = await response.json();
      if (controller.current !== active || auth(response, data)) return;
      if (!response.ok || data?.ok !== true) throw new Error("preview_unavailable");
      if (data.state !== "ready") { setError("Prévia indisponível para esta mensagem."); return; }
      if (data.transformed !== true || typeof data.html !== "string" || data.html.length > 1_000_000 || typeof data.subject !== "string") throw new Error("invalid_preview");
      setPreview({ html: data.html, subject: data.subject });
    } catch { if (controller.current === active) setError("Não foi possível carregar a prévia. Tente novamente."); }
    finally { clearTimeout(timer); if (controller.current === active) { controller.current = null; setBusy(false); } }
  };
  const more = async () => {
    if (!next || controller.current) return;
    const active = new AbortController(); controller.current = active; setBusy(true); setListError(null);
    const timer = setTimeout(() => active.abort(), 15_000);
    try {
      const response = await fetch(`/api/admin/emails/mensagens?limit=10&before=${encodeURIComponent(next)}`, { credentials: "same-origin", cache: "no-store", signal: active.signal });
      const data = await response.json(); if (auth(response, data)) return;
      if (!response.ok || data?.ok !== true || !Array.isArray(data.records) || data.records.length > 10 || data.records.some((r: any) => !r || typeof r.record_key !== "string" || typeof r.kind !== "string" || typeof r.to_addr !== "string" || typeof r.content_state !== "string") || data.next !== null && (typeof data.next !== "string" || data.next.length > 400 || data.next === next)) throw new Error("invalid_page");
      setRows(previous => [...new Map([...previous, ...data.records].map(row => [row.record_key, row])).values()]); setNext(data.next);
    } catch { setListError("Não foi possível carregar a lista. Tente novamente."); }
    finally { clearTimeout(timer); if (controller.current === active) { controller.current = null; setBusy(false); } }
  };
  if (!rows.length && !next) return null;
  return <section data-testid="mail-preview-history" aria-busy={busy}>
    <h3>{LABEL}</h3>
    <div className="table-scroll"><table><thead><tr><th>ID</th><th>Tipo</th><th>E-mail</th><th>{LABEL}</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.record_key}><td>{row.record_key}</td><td>{names[row.kind] ?? row.kind}</td><td>{row.to_addr}</td><td>{row.record_key.startsWith("message:") && row.content_state === "stored" ? <button type="button" className="adm-btn sm" disabled={busy} onClick={() => open(row.record_key.slice(8))}>{LABEL}</button> : "[restrito]"}</td></tr>)}</tbody>
    </table></div>
    {listError ? <p className="v2-aviso erro" role="alert">{listError}</p> : null}
    {next ? <button type="button" className="adm-btn sm" disabled={busy} onClick={more}>Carregar mais</button> : null}
    <dialog ref={dialog} className="adm-modal" aria-labelledby="mail-preview-title" onCancel={close}>
      <div className="in"><div className="adm-bar"><h3 id="mail-preview-title">{LABEL}</h3><button type="button" className="adm-btn" onClick={close}>Fechar</button></div><p>{NOTICE}</p>
        {error ? <p className="v2-aviso erro" role="alert">{error}</p> : null}
        {preview ? <><p>{preview.subject}</p><iframe title={LABEL} sandbox="" referrerPolicy="no-referrer" srcDoc={preview.html} style={{ width: "100%", height: "60vh", border: 0 }} /></> : null}
      </div>
    </dialog>
  </section>;
}
