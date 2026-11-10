"use client";
import React, { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { a1JobView, createA1JobViewState, updateA1JobView, type A1JobViewState } from "@/lib/a1-job-view";
import { readA1Reconciliation, applyA1Reconciliation } from "@/lib/a1-reconciliation";
import { submitA1Intent } from "@/lib/a1-request";

// Textos aprovados expressamente em 09/11/2026; não alterar sem revisão do responsável.
const COPY = {
  action: "Assinar com certificado A1", queued: "Aguardando assinatura", running: "Assinatura em andamento",
  check: "Conferir assinatura", failure: "Falha na assinatura",
  uncertain: "Não foi possível confirmar o resultado. Atualize o documento antes de tentar novamente.",
};
/** Existing admin classes, no certificate fields and no automatic mutation. */
export default function A1Assinatura({ batchId, currentSignedSha256 }: { batchId: number; currentSignedSha256?: string | null }) {
  const router = useRouter();
  return <A1PorLote key={batchId} batchId={batchId} onPublished={sha256 => { if (sha256 !== currentSignedSha256) router.refresh(); }} />;
}

export function A1PorLote({ batchId, onPublished }: { batchId: number; onPublished?: (sha256: string) => void }) {
  const [state, setState] = useState(() => createA1JobViewState(batchId));
  const [open, setOpen] = useState(false);
  const remainingReads = useRef(12);
  const refreshedOutput = useRef<string | null>(null);
  const current = useRef(state), alive = useRef(true), trigger = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const publish = (next: A1JobViewState) => { current.current = next; if (alive.current) setState(next); };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const check = async () => {
    const captured = current.current;
    if (captured.readPending) return;
    publish(updateA1JobView(captured, { type: "read_started" }));
    const result = await readA1Reconciliation(captured);
    if (alive.current) publish(applyA1Reconciliation(current.current, result));
  };
  const submit = async () => {
    const before = current.current, available = before.availability;
    if (!a1JobView(before).controls.canRequest || !available?.ok || !available.documentVersion || !available.policyRevision) return;
    const intent = { batchId: before.batchId, requestId: crypto.randomUUID(), expectedDocumentVersion: available.documentVersion, expectedPolicyRevision: available.policyRevision };
    const pending = updateA1JobView(before, { type: "request_started", intent });
    if (pending === before) return;
    remainingReads.current = 12;
    publish(pending);
    const result = await submitA1Intent(intent);
    if (!alive.current || current.current.batchId !== intent.batchId) return;
    publish(updateA1JobView(current.current, result.kind === "success"
      ? { type: "request_admitted", requestId: intent.requestId, job: result.value }
      : result.kind === "rejected" ? { type: "request_rejected", requestId: intent.requestId, error: result.error }
      : { type: "request_transport_failed", requestId: intent.requestId }));
  };
  const close = () => { setOpen(false); dialog.current?.close(); requestAnimationFrame(() => trigger.current?.focus()); };
  const view = a1JobView(state);
  useEffect(() => {
    const denied = ["authentication_required", "stepup_required", "forbidden", "rate_limited"].includes(state.errorCode ?? "");
    const inProgress = state.postPending || state.resultUncertain || !!state.job && ["queued", "running", "validating"].includes(state.job.state);
    if (!open || state.readPending || denied || !inProgress || remainingReads.current <= 0) return;
    const timer = setTimeout(() => { remainingReads.current--; void check(); }, 3_000);
    return () => clearTimeout(timer);
  }, [open, state]);
  useEffect(() => {
    const sha256 = state.job?.outputSha256;
    if (view.signaturePublished && sha256 && refreshedOutput.current !== sha256) {
      refreshedOutput.current = sha256;
      onPublished?.(sha256);
    }
  }, [view.signaturePublished, state.job?.outputSha256, onPublished]);
  const status = view.phase === "queued" ? COPY.queued : view.phase === "running" ? COPY.running : view.signaturePublished ? "ICP-Brasil" : view.phase === "failed" ? COPY.failure : "—";
  return <>
    <button ref={trigger} type="button" className="v2-btn v2-btn-sec" onClick={() => { remainingReads.current = 12; setOpen(true); dialog.current?.showModal(); void check(); }}>{COPY.action}</button>
    <dialog ref={dialog} className="adm-modal" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close(); }}>
      <div className="in" aria-busy={state.readPending || state.postPending}>
        <div className="adm-bar"><h3 id={titleId}>{COPY.action} · {batchId}</h3><button type="button" className="adm-btn" onClick={close}>Fechar</button></div>
        <p role="status">{status}</p>
        {(state.resultUncertain || state.errorCode || view.completionUnproven) && <p className="v2-aviso erro" role="alert">{COPY.uncertain}</p>}
        <div className="fim">
          <button type="button" className="adm-btn" disabled={!view.controls.canRequest} onClick={() => void submit()}>{COPY.action}</button>
          <button type="button" className="adm-btn" disabled={!view.controls.canCheckResult} onClick={() => void check()}>{COPY.check}</button>
          {view.controls.canReadSignedVersion && state.job?.outputVersionId && <a className="adm-btn" href={`/api/admin/lotes/${batchId}/versoes/${encodeURIComponent(state.job.outputVersionId)}`}>Baixar PDF assinado</a>}
        </div>
      </div>
    </dialog>
  </>;
}
