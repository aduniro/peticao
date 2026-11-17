"use client";
import { useEffect, useId, useRef, useState } from "react";
import PresidenteDocumentoProprio from "@/components/admin/PresidenteDocumentoProprio";
import { appendOwnHistory, ownHistoryRequest, type HistoryArtifact, type HistoryKind, type HistoryPage, type HistoryReceipt } from "@/lib/president-own-history-client";
type Props = { actorScope: string; batchId: number; actionsDisabled: boolean; profileFingerprint: string | null; documentRevision: string | null; alreadyMountedReceiptId?: string | null };
// MUDAR AQUI: inventário protegido, somente leitura até uma ação explícita de preparação.
const COPY = {
  title: "Histórico de confirmações e documentos próprios", read: "Consultar histórico", more: "Carregar mais", refresh: "Atualizar histórico",
  receipts: "Confirmações registradas", artifacts: "Documentos próprios", download: "Baixar PDF", prepare: "Preparar documento desta confirmação",
  unavailable: "Não foi possível consultar o histórico. A lista anterior foi preservada. Tente consultar novamente.",
  changed: "Confirme as alterações do responsável e consulte novamente as confirmações antes de preparar documentos.",
  current: "Compatível com o documento atual", historical: "Registro histórico", empty: "Nenhum registro nesta consulta.",
  mounted: "A preparação desta confirmação já está disponível acima nesta página.",
};
export default function PresidenteHistoricoProprio(props: Props) {
  return <HistoryContext key={JSON.stringify([props.actorScope, props.batchId, props.profileFingerprint, props.documentRevision])} {...props} />;
}
function HistoryContext({ actorScope, batchId, actionsDisabled, profileFingerprint, documentRevision, alreadyMountedReceiptId }: Props) {
  const title = useId(), alive = useRef(true), busy = useRef(false), epoch = useRef(0), blocked = useRef(actionsDisabled);
  // Render updates the guard before effects: a stale request must never enable preparation.
  if (blocked.current !== actionsDisabled) { blocked.current = actionsDisabled;epoch.current += 1; }
  const [receipts, setReceipts] = useState<HistoryPage | null>(null), [artifacts, setArtifacts] = useState<HistoryPage | null>(null);
  const [freshAt, setFreshAt] = useState<number | null>(null), [selected, setSelected] = useState<HistoryReceipt | null>(null);
  const [pending, setPending] = useState(false), [message, setMessage] = useState("");
  useEffect(() => { alive.current = true;return () => { alive.current = false; }; }, []);
  const currentReadable = !actionsDisabled && !!profileFingerprint && !!documentRevision && freshAt === epoch.current;
  const read = async (kind: HistoryKind, more = false) => {
    if (busy.current) return;
    const previous = kind === "receipts" ? receipts : artifacts;
    const cursor = more ? previous?.nextCursor ?? undefined : undefined;
    if (more && !cursor) return;
    const startedAt = epoch.current;
    busy.current = true;setPending(true);setMessage("");
    try {
      const result = await ownHistoryRequest(batchId, kind, cursor);
      if (!alive.current) return;
      const merged = result && (more ? appendOwnHistory(previous, result, cursor) : result);
      if (!merged) { setMessage(COPY.unavailable);return; }
      if (kind === "receipts") {
        setReceipts(merged);setSelected(null);
        setFreshAt(!blocked.current && startedAt === epoch.current ? startedAt : null);
      } else setArtifacts(merged);
    } finally { busy.current = false;if (alive.current) setPending(false); }
  };
  const receiptRows = (receipts?.rows ?? []) as HistoryReceipt[], artifactRows = (artifacts?.rows ?? []) as HistoryArtifact[];
  const usable = (r: HistoryReceipt) => currentReadable && r.isCurrent && r.documentVersion !== null && r.documentVersion === documentRevision;
  return <section className="box" aria-labelledby={title} aria-busy={pending}>
    <h4 id={title}>{COPY.title}</h4>
    <p className="small">Consulte os registros deste lote sem recuperar senhas ou links de acesso. A consulta não gera documentos nem envia o lote.</p>
    {message && <p role="status">{message}</p>}
    {(actionsDisabled || receipts && !currentReadable) && <p role="status">{COPY.changed}</p>}
    <h5>{COPY.receipts}</h5>
    <div className="fim"><button type="button" className="adm-btn" disabled={pending} onClick={() => void read("receipts")}>{receipts ? COPY.refresh : COPY.read}</button>
      {receipts?.hasMore && <button type="button" className="adm-btn" disabled={pending} onClick={() => void read("receipts", true)}>{COPY.more}</button>}</div>
    {receipts && receiptRows.length === 0 && <p>{COPY.empty}</p>}
    <ul style={{ overflowWrap: "anywhere" }}>{receiptRows.map(row => <li key={row.challengeId}>
      <span>{row.confirmedAt} — <code>{row.receiptId}</code> — {usable(row) ? COPY.current : COPY.historical}</span>{" "}
      {row.receiptId === alreadyMountedReceiptId ? <span className="small">{COPY.mounted}</span> : <button type="button" className="adm-btn" disabled={pending || !usable(row)} onClick={() => { if (usable(row)) setSelected(row); }}>{COPY.prepare}</button>}
    </li>)}</ul>
    {selected && selected.receiptId !== alreadyMountedReceiptId && usable(selected) && selected.documentVersion && <PresidenteDocumentoProprio key={`${selected.receiptId}:${selected.documentVersion}:${freshAt}`} actorScope={actorScope} batchId={batchId} receiptId={selected.receiptId} expectedDocumentVersion={selected.documentVersion} />}
    <h5>{COPY.artifacts}</h5>
    <div className="fim"><button type="button" className="adm-btn" disabled={pending} onClick={() => void read("artifacts")}>{artifacts ? COPY.refresh : COPY.read}</button>
      {artifacts?.hasMore && <button type="button" className="adm-btn" disabled={pending} onClick={() => void read("artifacts", true)}>{COPY.more}</button>}</div>
    {artifacts && artifactRows.length === 0 && <p>{COPY.empty}</p>}
    <ul style={{ overflowWrap: "anywhere" }}>{artifactRows.map(row => <li key={row.artifactId}>
      <span>{row.createdAt} — <code>{row.artifactId}</code> — {row.byteLength} bytes</span><br />
      <span className="small">SHA256: <code>{row.sha256}</code></span>{" "}
      <a className="adm-btn" href={`/api/admin/presidente/documentos-proprios/${row.artifactId}`} referrerPolicy="no-referrer">{COPY.download}</a>
    </li>)}</ul>
  </section>;
}
