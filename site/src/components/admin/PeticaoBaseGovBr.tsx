"use client";
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readBaseInventory, readBaseSelection, readBasePacketReview, uploadBase, validateBase, selectBase, prepareBasePacket, readBaseIntent, type BaseHttpResult, type BaseArtifactView, type BaseReviewView, type BaseSelectionView } from "@/lib/petition-base-request";
import { parseBasePending, matchBaseRecovery, basePendingRequestId, type BasePending } from "@/lib/petition-base-view";

// MUDAR AQUI: controles aprovados pelo proprietário; preservar os estilos existentes.
const COPY = { title: "Petição-base gov.br", upload: "Carregar PDF assinado", validate: "Conferir assinatura", select: "Selecionar esta versão", prepare: "Preparar pacote para revisão", prepared: "Pacote preparado", separate: "Os PDFs do lote e da petição-base serão mantidos como arquivos separados.", uncertain: "Não foi possível confirmar o resultado. Atualize o documento antes de tentar novamente." };
type Props = { batchId: number; actorId: number; petitionTextVersion: string };
export default function PeticaoBaseGovBr(props: Props) {
  const router = useRouter(), refresh = useCallback(() => router.refresh(), [router]);
  return <PeticaoBaseGovBrControl {...props} onPrepared={refresh} />;
}
export function PeticaoBaseGovBrControl({ batchId, actorId, petitionTextVersion, onPrepared }: Props & { onPrepared?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null), fileInput = useRef<HTMLInputElement>(null), title = useId();
  const mounted = useRef(false), generation = useRef(0), busy = useRef(false), pendingRef = useRef<BasePending | null>(null), notified = useRef<string | null>(null);
  const [artifacts, setArtifacts] = useState<BaseArtifactView[]>([]), [selected, setSelected] = useState<BaseSelectionView | null>(null), [bindingMatches, setBindingMatches] = useState(false), [review, setReview] = useState<BaseReviewView | null>(null);
  const [pending, setPending] = useState<BasePending | null>(null), [loading, setLoading] = useState(false), [posting, setPosting] = useState(false), [uncertain, setUncertain] = useState(false), [ready, setReady] = useState(false);
  const storageKey = `petition-base:v1:${actorId}:${batchId}`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  function save(value: BasePending | null) {
    try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); return true; } catch { return false; }
  }
  function restore() {
    try { const raw = sessionStorage.getItem(storageKey); if (!raw) return null; if (raw.length > 2048) { setUncertain(true); return null; } const value = parseBasePending(JSON.parse(raw), batchId); if (!value) setUncertain(true); return value; } catch { setUncertain(true); return null; }
  }
  function setIntent(value: BasePending | null) { pendingRef.current = value; setPending(value); }
  async function refresh() {
    const token = ++generation.current; setLoading(true); setReady(false);
    const intent = pendingRef.current;
    const [inventory, selection, snapshot, outcome] = await Promise.all([readBaseInventory(), readBaseSelection(), readBasePacketReview(batchId), intent ? readBaseIntent(intent.kind, basePendingRequestId(intent), batchId) : Promise.resolve(null)]);
    if (!mounted.current || token !== generation.current) return;
    setLoading(false);
    if (inventory.kind === "success") { setArtifacts(inventory.value.artifacts); }
    if (selection.kind === "success") { setSelected(selection.value.selection); setBindingMatches(selection.value.currentBindingMatches); }
    if (snapshot.kind === "success") setReview(snapshot.value);
    const readsOk = inventory.kind === "success" && selection.kind === "success" && snapshot.kind === "success";
    setReady(readsOk); if (!readsOk) setUncertain(true);
    if (intent && outcome?.kind === "success") {
      const match = matchBaseRecovery(intent, outcome.value);
      if (match !== "mismatch") {
        if (!save(null)) { setUncertain(true); return; }
        setIntent(null); setUncertain(match !== "current" || !readsOk);
        if (intent.kind === "package" && outcome.value.kind === "package" && match === "current" && snapshot.kind === "success" && snapshot.value.latestPackage?.packageId === outcome.value.package.packageId && notified.current !== outcome.value.package.packageId) { notified.current = outcome.value.package.packageId; onPrepared?.(); }
      } else setUncertain(true);
    }
    // 404 may race an in-flight POST. It never authorizes a new automatic submission.
    if (intent && outcome?.kind !== "success") setUncertain(true);
  }
  async function mutate(intent: BasePending, operation: () => Promise<BaseHttpResult<unknown>>) {
    if (busy.current || pendingRef.current || !ready) return;
    if (!save(intent)) { setUncertain(true); return; }
    setIntent(intent); busy.current = true; setPosting(true); setUncertain(false);
    // The authoritative result is recovered by exact GET, even after a rejected/lost response.
    try {
      const result = await operation();
      if (mounted.current && result.kind === "rejected" && result.error !== "request_conflict") {
        // A conclusive protocol refusal creates no intent. Release only this local intent; no retry.
        if (save(null)) setIntent(null);
        setUncertain(true);
      }
    } catch { /* Persisted identity remains for readback. */ }
    busy.current = false; if (!mounted.current) return; setPosting(false); await refresh();
  }
  async function upload() {
    const file = fileInput.current?.files?.[0]; if (!file || busy.current || pendingRef.current || !ready) return;
    if (file.size < 16 || file.size > 25 * 1024 * 1024) { setUncertain(true); return; }
    busy.current = true; setPosting(true);
    try {
      const bytes = await file.arrayBuffer(), digest = await crypto.subtle.digest("SHA-256", bytes), sha256 = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
      if (!mounted.current) return; busy.current = false; setPosting(false);
      const requestId = crypto.randomUUID(); await mutate({ kind: "upload", requestId, sha256 }, () => uploadBase(requestId, file, sha256));
    } catch { if (mounted.current) { busy.current = false; setPosting(false); setUncertain(true); } }
  }
  async function validate(item: BaseArtifactView) {
    if (busy.current || pendingRef.current || !ready) return; busy.current = true; setPosting(true); setUncertain(false);
    const result = await validateBase(item.artifactId, item.sha256);
    busy.current = false; if (!mounted.current) return; setPosting(false); setUncertain(result.kind !== "success"); await refresh(); if (result.kind === "success") onPrepared?.();
  }
  function newRequestId() { try { return crypto.randomUUID(); } catch { setUncertain(true); return null; } }
  function choose(item: BaseArtifactView) {
    if (!item.lastValidationId) return; const requestId = newRequestId(); if (!requestId) return;
    const input = { requestId, expectedRevision: selected?.revision ?? 0, validationId: item.lastValidationId, reviewedSha256: item.sha256, expectedTextVersion: petitionTextVersion };
    void mutate({ kind: "selection", input }, () => selectBase(input));
  }
  function prepare() {
    if (!review || !selected || !bindingMatches || review.selectionId !== selected.selectionId || !review.canPrepare) return;
    const requestId = newRequestId(); if (!requestId) return;
    const input = { requestId, batchId, expectedDocumentVersion: review.documentVersion, expectedSelectionId: selected.selectionId, expectedPackageRevision: review.latestPackage?.ordinal ?? 0 };
    void mutate({ kind: "package", input }, () => prepareBasePacket(input));
  }
  function close() { dialog.current?.close(); trigger.current?.focus(); }
  const disabled = loading || posting || !ready || pending !== null;
  const prepared = review?.latestPackage && review.latestPackage.documentVersion === review.documentVersion && review.latestPackage.selectionId === selected?.selectionId && review.latestPackage.baseSha256 === selected?.sha256 && bindingMatches;
  return <>
    <button ref={trigger} type="button" className="v2-btn v2-btn-sec" onClick={() => { setIntent(restore()); dialog.current?.showModal(); void refresh(); }}>{COPY.title}</button>
    <dialog ref={dialog} className="adm-modal" aria-labelledby={title} onCancel={event => { event.preventDefault(); close(); }}>
      <div className="in" aria-busy={loading || posting}>
        <div className="adm-bar"><h3 id={title}>{COPY.title}</h3><button type="button" className="adm-btn" onClick={close}>Fechar</button></div>
        <p>{COPY.separate}</p>
        {uncertain && <p className="v2-aviso erro" role="alert">{COPY.uncertain}</p>}
        <p><input ref={fileInput} type="file" accept="application/pdf" aria-label="PDF assinado" disabled={disabled} /> <button type="button" className="adm-btn" disabled={disabled} onClick={() => void upload()}>{COPY.upload}</button></p>
        <button type="button" className="adm-btn" disabled={loading || posting} onClick={() => void refresh()}>Atualizar</button>
        {selected && <p style={{ overflowWrap: "anywhere" }}><a href={`/api/admin/documentos/base/${selected.artifactId}`} target="_blank" rel="noopener">{COPY.title}</a> · <code>{selected.sha256}</code></p>}
        <div className="table-scroll"><table style={{ minWidth: 600 }}><thead><tr><th>Documento</th><th>sha256</th><th>Ações</th></tr></thead><tbody>{artifacts.map(item => <tr key={item.artifactId}>
          <td><a href={`/api/admin/documentos/base/${item.artifactId}`} target="_blank" rel="noopener">PDF</a></td><td style={{ overflowWrap: "anywhere", maxWidth: 240 }}><code>{item.sha256}</code></td>
          <td><button type="button" className="adm-btn" disabled={disabled} onClick={() => void validate(item)}>{COPY.validate}</button> <button type="button" className="adm-btn" disabled={disabled || !item.lastValidationId || selected?.artifactId === item.artifactId && bindingMatches} onClick={() => choose(item)}>{COPY.select}</button></td>
        </tr>)}</tbody></table></div>
        <p><button type="button" className="adm-btn" disabled={disabled || !!prepared || !bindingMatches || !selected || !review?.canPrepare || review.selectionId !== selected.selectionId} onClick={prepare}>{COPY.prepare}</button></p>
        {prepared && <p role="status" style={{ overflowWrap: "anywhere" }}>{COPY.prepared} · <code>{review?.latestPackage?.packageDigest}</code></p>}
      </div>
    </dialog>
  </>;
}
