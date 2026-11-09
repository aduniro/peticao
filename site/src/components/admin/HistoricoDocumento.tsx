"use client";
import React, { useEffect, useId, useRef, useState } from "react";
import { brasilia } from "@/lib/time";
import { appendDocumentHistory, loadDocumentHistoryPage, type DocumentHistoryPage } from "@/lib/document-history-view";

const SIGNATURE = { none: "NÃO ASSINADO (teste)", "icp-brasil": "ICP-Brasil", "externa-nao-validada": "Assinado, NÃO validado" };
/** Explicit metadata lookup only; bytes are requested solely through the protected download link. */
export default function HistoricoDocumento({ batchId }: { batchId: number }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId(), dialog = useRef<HTMLDialogElement>(null), pending = useRef<AbortController | null>(null);
  const [page, setPage] = useState<DocumentHistoryPage | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [access, setAccess] = useState<"auth" | "stepup" | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const close = () => { pending.current?.abort(); pending.current = null; dialog.current?.close(); setBusy(false); setPage(null); setError(null); setAccess(null); requestAnimationFrame(() => trigger.current?.focus()); };
  const load = async (before?: number) => {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller; setBusy(true); setError(null); setAccess(null);
    if (!dialog.current?.open) dialog.current?.showModal();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const result = await loadDocumentHistoryPage(fetch, batchId, before, controller.signal);
      if (pending.current !== controller) return;
      if (!result.ok) {
        if (result.error === "auth" || result.error === "stepup") setAccess(result.error);
        setError(["auth", "stepup", "forbidden"].includes(result.error) ? "Não autorizado." : "Não foi possível carregar o histórico. Feche e tente novamente."); return;
      }
      const next = before !== undefined && page ? appendDocumentHistory(page, result.page) : result.page;
      if (!next) { setError("Não foi possível carregar o histórico. Feche e tente novamente."); return; }
      setPage(next);
    } catch { if (pending.current === controller) setError("Não foi possível carregar o histórico. Feche e tente novamente."); }
    finally { clearTimeout(timer); if (pending.current === controller) { pending.current = null; setBusy(false); } }
  };
  return <>
    <button ref={trigger} type="button" className="adm-btn sm" onClick={() => void load()} disabled={busy}>Histórico</button>
    <dialog ref={dialog} className="adm-modal" aria-labelledby={titleId} data-testid="document-history" onCancel={event => { event.preventDefault(); close(); }}>
      <div className="in" aria-busy={busy}>
        <div className="adm-bar"><h3 id={titleId}>Documentos · {batchId}</h3><button type="button" className="adm-btn" onClick={close}>Fechar</button></div>
        {busy && <p role="status">Carregando…</p>}
        {error && <p className="v2-aviso erro" role="alert">{error}</p>}
        {access && <p><a className="adm-btn" href={access === "auth" ? "/admin" : `/admin/confirmar?volta=${encodeURIComponent(`/admin/presidente?lote=${batchId}`)}`}>{access === "auth" ? "Entrar" : "Confirmar"}</a></p>}
        {page && <div className="table-scroll"><table style={{ minWidth: 1080 }}>
          <thead><tr><th>Versão</th><th>Tipo</th><th>Assinatura</th><th>sha256 do PDF</th><th>Data</th><th>Autor</th><th>Ações</th></tr></thead>
          <tbody>{page.versions.map(row => <tr key={row.id}>
            <td>{row.ordinal}</td><td>{row.variant === "original" ? "original" : "assinado"}{row.source === "legacy-observed" && <div className="small">Histórico anterior</div>}</td>
            <td>{row.signatureKind ? SIGNATURE[row.signatureKind] : "—"}</td>
            <td style={{ maxWidth: 320, overflowWrap: "anywhere" }}><code>{row.sha256}</code><div className="small">Lista sha256: <code>{row.listHash ?? "—"}</code></div></td>
            <td>{brasilia(row.capturedAt)}</td><td>{row.authorId === null ? "—" : `#${row.authorId}`}<div className="small">Registro: {row.recordedBy === null ? "—" : `#${row.recordedBy}`}</div></td>
            <td><a className="adm-btn sm" href={`/api/admin/lotes/${batchId}/versoes/${encodeURIComponent(row.id)}`}>Baixar</a></td>
          </tr>)}{page.versions.length === 0 && <tr><td colSpan={7}>—</td></tr>}</tbody>
        </table></div>}
        <div className="fim"><button type="button" className="adm-btn" disabled={busy} onClick={() => void load()}>Atualizar</button>{page?.nextBefore !== null && page?.nextBefore !== undefined && <button type="button" className="adm-btn" disabled={busy} onClick={() => void load(page.nextBefore!)}>Mais antigos</button>}</div>
      </div>
    </dialog>
  </>;
}
