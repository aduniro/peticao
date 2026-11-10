"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ownPdfDownloadPath, ownPdfIntent, ownPdfMetadata, ownPdfRequest, ownPdfUuid, type OwnPdfIntent, type OwnPdfMetadata } from "@/lib/president-own-document-client";

type Props = { actorScope: string; batchId: number; receiptId: string; expectedDocumentVersion: string };
// MUDAR AQUI: textos da geração de PDF próprio; decisões reversíveis no roteiro.
const COPY = {
  title: "Documento da confirmação própria", create: "Gerar PDF da confirmação", check: "Conferir geração do PDF",
  retry: "Repetir esta solicitação", fresh: "Gerar com nova solicitação", download: "Baixar PDF da confirmação",
  uncertain: "Não foi possível confirmar o resultado. Confira a geração antes de tentar outra ação.",
  pending: "Geração pendente. Confira a solicitação para acompanhar o resultado.",
  completed: "PDF da confirmação disponível.", failed: "O PDF não foi concluído. Confira a solicitação antes de tentar novamente.",
};
/** A changed actor/session, receipt or source revision always unmounts the old request state. */
export default function PresidenteDocumentoProprio(props: Props) {
  return <DocumentoPorConfirmacao key={`${props.actorScope}:${props.batchId}:${props.receiptId}:${props.expectedDocumentVersion}`} {...props} />;
}
function DocumentoPorConfirmacao({ actorScope, batchId, receiptId, expectedDocumentVersion }: Props) {
  const title = useId(), busy = useRef(false), alive = useRef(true);
  const [hydrated, setHydrated] = useState(false);
  const [intent, setIntent] = useState<OwnPdfIntent | null>(null);
  const [document, setDocument] = useState<OwnPdfMetadata | null>(null);
  const [pending, setPending] = useState(false), [message, setMessage] = useState("");
  const [notFound, setNotFound] = useState(false), [checked, setChecked] = useState(false), [acknowledged, setAcknowledged] = useState(false);
  const validContext = Number.isInteger(batchId) && batchId > 0 && batchId <= 2147483647 && ownPdfUuid(receiptId) && /^[a-f0-9]{64}$/.test(expectedDocumentVersion);
  const storageKey = `president-own-pdf:${actorScope}:${batchId}:${receiptId}:${expectedDocumentVersion}`;
  const sameContext = (value: OwnPdfIntent) => value.batchId === batchId && value.receiptId === receiptId && value.expectedDocumentVersion === expectedDocumentVersion;
  const remember = (value: OwnPdfIntent) => {
    setIntent(value);
    try { sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* Nonsecret context persistence is optional. */ }
  };
  useEffect(() => {
    alive.current = true;
    try {
      const raw = sessionStorage.getItem(storageKey);
      const recovered = raw && raw.length <= 1024 ? ownPdfIntent(JSON.parse(raw)) : null;
      if (recovered && sameContext(recovered)) setIntent(recovered);
    } catch { /* Storage failures never trigger a mutation. */ }
    setHydrated(true);
    return () => { alive.current = false; };
  }, [storageKey]);
  const run = async (action: () => Promise<void>) => {
    if (busy.current || !hydrated || !validContext) return;
    busy.current = true; setPending(true); setMessage("");
    try { await action(); } finally { busy.current = false; if (alive.current) setPending(false); }
  };
  const accept = (value: OwnPdfMetadata, fromRead: boolean) => {
    setDocument(value); setChecked(fromRead); setNotFound(false); setAcknowledged(false);
    setMessage(value.state === "completed" ? COPY.completed : value.state === "pending" ? COPY.pending : COPY.failed);
  };
  const check = async () => {
    if (!intent || !sameContext(intent)) return;
    setChecked(false); setNotFound(false); setAcknowledged(false);
    const result = await ownPdfRequest("GET", intent.requestId);
    if (!alive.current) return;
    const metadata = result.ok ? ownPdfMetadata(result.data, intent) : null;
    if (metadata) accept(metadata, true);
    else { setNotFound(!result.ok && result.kind === "http" && result.status === 404); setMessage(COPY.uncertain); }
  };
  const create = async (kind: "initial" | "same" | "fresh") => {
    if (kind === "initial" && intent || kind === "same" && (!intent || !notFound) || kind === "fresh" && (!checked || !acknowledged || !document || !["pending", "failed"].includes(document.state))) return;
    const next: OwnPdfIntent = kind === "same" && intent ? intent : { requestId: crypto.randomUUID(), batchId, receiptId, expectedDocumentVersion };
    if (!sameContext(next)) return;
    // Persist context before the network boundary. Never create another intent on transport uncertainty.
    remember(next); setChecked(false); setNotFound(false); setAcknowledged(false); setDocument(null);
    const result = await ownPdfRequest("POST", next);
    if (!alive.current) return;
    const metadata = result.ok ? ownPdfMetadata(result.data, next) : null;
    if (metadata) accept(metadata, false); else setMessage(COPY.uncertain);
  };
  const download = document && ownPdfDownloadPath(document);
  const canFresh = checked && !!document && ["pending", "failed"].includes(document.state);
  return <section className="box" aria-labelledby={title} aria-busy={pending}>
    <h4 id={title}>{COPY.title}</h4>
    <p className="small">Gera um arquivo separado para o mesmo lote e comprovante. Esta ação não envia o lote.</p>
    <div className="fim">
      <button type="button" className="adm-btn" disabled={!validContext || !hydrated || pending || !!intent} onClick={() => void run(() => create("initial"))}>{COPY.create}</button>
      <button type="button" className="adm-btn" disabled={!validContext || !hydrated || pending || !intent} onClick={() => void run(check)}>{COPY.check}</button>
      {notFound && <button type="button" className="adm-btn" disabled={pending} onClick={() => void run(() => create("same"))}>{COPY.retry}</button>}
    </div>
    {!validContext && <p role="alert">Não há um comprovante compatível disponível para este documento.</p>}
    {message && <p role="status">{message}</p>}
    {intent && <p className="small" style={{ overflowWrap: "anywhere" }}>Solicitação: <code>{intent.requestId}</code></p>}
    {document && <>
      <dl style={{ overflowWrap: "anywhere" }}><dt>Comprovante</dt><dd><code>{receiptId}</code></dd><dt>Versão do documento</dt><dd><code>{document.documentVersion}</code></dd>
        {document.sha256 && <><dt>SHA256 do PDF</dt><dd><code>{document.sha256}</code></dd></>}
        {document.sourceSha256 && <><dt>SHA256 do PDF original</dt><dd><code>{document.sourceSha256}</code></dd></>}
      </dl>
      {download && <a className="adm-btn" href={download} referrerPolicy="no-referrer">{COPY.download}</a>}
    </>}
    {canFresh && <div className="box">
      <label className="adm-check"><input type="checkbox" checked={acknowledged} disabled={pending} onChange={event => setAcknowledged(event.target.checked)} />Quero fazer uma nova solicitação para o mesmo lote e comprovante.</label>
      <button type="button" className="adm-btn" disabled={pending || !acknowledged} onClick={() => void run(() => create("fresh"))}>{COPY.fresh}</button>
    </div>}
  </section>;
}
