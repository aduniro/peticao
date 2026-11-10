"use client";
import React, { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { a1JobView, createA1JobViewState, updateA1JobView, type A1JobViewState } from "@/lib/a1-job-view";
import { readA1Reconciliation, applyA1Reconciliation } from "@/lib/a1-reconciliation";
import { submitA1Intent, readA1Intent, readA1Availability } from "@/lib/a1-request";
import { a1RecoveryIntent, makeA1ResetProof, a1ResetProofCurrent, canCloseA1FromRead, a1LocalResetDecision, rememberA1LocalDecision, type A1ResetProof, type A1LocalDecision } from "@/lib/a1-recovery-control";
import { exchangeA1Close, makeA1CloseIntent, rememberA1CloseIntent, restoreA1CloseIntent, retireA1CloseIntent, type A1CloseIntent } from "@/lib/a1-close-request";
import { makeA1CloseAbandonProof, a1CloseAbandonProofCurrent, rememberA1LocalCloseDecision, type A1CloseAbandonProof, type A1LocalCloseDecision } from "@/lib/a1-close-recovery";
import type { A1JobObservation } from "@/lib/a1-job-view";
import { a1UiJobMatchesMode, a1UiModeValid, rememberA1UiIntent, restoreA1UiIntent, retireA1UiIntent, type A1UiContext } from "@/lib/a1-ui-context";

// MUDAR AQUI: textos A1 já aprovados; contexto do PDF próprio acrescentado por decisão reversível do Goal.
const COPY = {
  action: "Assinar com certificado A1", queued: "Aguardando assinatura", running: "Assinatura em andamento",
  check: "Conferir assinatura", failure: "Falha na assinatura",
  uncertain: "Não foi possível confirmar o resultado. Atualize o documento antes de tentar novamente.",
  recovery: "Conferir possibilidade de nova solicitação", reset: "Preparar nova solicitação",
  resetConsent: "Quero preparar uma nova solicitação sem repetir automaticamente a anterior.",
  resetReady: "Nova solicitação preparada. Para assinar, clique novamente em Assinar com certificado A1.",
  recoveryUnavailable: "Não foi possível preparar uma nova solicitação. Confira a situação novamente.",
  close: "Encerrar solicitação expirada", closeCheck: "Conferir encerramento", closeRetry: "Repetir pedido de encerramento",
  closeConsent: "Quero encerrar somente esta solicitação expirada. Esta ação não assina nem envia documentos.",
  abandon: "Descartar somente este pedido local de encerramento",
  abandonConsent: "Conferi a nova situação e quero descartar somente o pedido local anterior de encerramento.",
  abandoned: "Pedido local descartado. Nenhum encerramento ou assinatura foi executado por esta ação. Confira a situação e use um novo pedido explícito se necessário.",
  terminalObserved: "O documento foi conferido e a solicitação já está finalizada. Isso não comprova que este pedido de encerramento foi executado.",
  closed: "Solicitação expirada encerrada. Confira a possibilidade de uma nova solicitação antes de prosseguir.",
  closeUncertain: "Não foi possível confirmar o encerramento. Confira o resultado antes de tentar outra ação.",

};
type Props = A1UiContext & { currentSignedSha256?: string | null };
/** Mode/source changes unmount state. An ownArtifactId is a binding, never authorization. */
export default function A1Assinatura({ batchId, currentSignedSha256, actorScope, ownArtifactId, documentRevision }: Props) {
  const router = useRouter();
  const key = `${actorScope ?? "memory"}:${batchId}:${ownArtifactId ?? "original"}:${documentRevision ?? "current"}:${currentSignedSha256 ?? "unsigned"}`;
  return <A1PorLote key={key} batchId={batchId} actorScope={actorScope} ownArtifactId={ownArtifactId} documentRevision={documentRevision} onPublished={sha256 => { if (sha256 !== currentSignedSha256) router.refresh(); }} />;
}

export function A1PorLote({ batchId, actorScope, ownArtifactId, documentRevision, onPublished }: A1UiContext & { onPublished?: (sha256: string) => void }) {
  const context: A1UiContext = { batchId, actorScope, ownArtifactId, documentRevision };
  const modeValid = a1UiModeValid(context);
  const [state, setState] = useState(() => createA1JobViewState(batchId));
  const [hydrated, setHydrated] = useState(false), [open, setOpen] = useState(false);
  const remainingReads = useRef(12), refreshedOutput = useRef<string | null>(null);
  const current = useRef(state), alive = useRef(true), trigger = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [recoveryPending, setRecoveryPending] = useState(false), [recoveryMessage, setRecoveryMessage] = useState("");
  const [resetProof, setResetProof] = useState<A1ResetProof | null>(null), [resetConsent, setResetConsent] = useState(false);
  const [lastReadJob, setLastReadJob] = useState<A1JobObservation | null>(null);
  const [closeIntent, setCloseIntent] = useState<A1CloseIntent | null>(null), [closeVerified, setCloseVerified] = useState(false), [closeNotFound, setCloseNotFound] = useState(false), [closeConsent, setCloseConsent] = useState(false);
  const [localDecisions, setLocalDecisions] = useState<A1LocalDecision[]>([]);
  const [abandonProof, setAbandonProof] = useState<A1CloseAbandonProof | null>(null), [abandonConsent, setAbandonConsent] = useState(false);
  const [closeDecisions, setCloseDecisions] = useState<A1LocalCloseDecision[]>([]);
  const recoveryBusy = useRef(false), recoveryEpoch = useRef(0);
  const monotonic = () => performance.now();
  const wallStamp = () => { const at = new Date(); return Number.isFinite(at.getTime()) ? at.toISOString() : null; };
  const storage = () => { try { return sessionStorage; } catch { return undefined; } };

  const publish = (next: A1JobViewState) => { current.current = next; if (alive.current) setState(next); };
  useEffect(() => {
    alive.current = true;
    try {
      const restored = restoreA1UiIntent(sessionStorage, context);
      if (restored) publish({ ...createA1JobViewState(batchId), intent: restored, usedRequestIds: [restored.requestId], resultUncertain: true, refreshRequired: true, errorCode: "request_transport_failed" });
    } catch { /* Storage is optional; old callers without actor/session scope remain memory-only. */ }
    try { const closing = restoreA1CloseIntent(storage(), context); if (closing) { setCloseIntent(closing); setCloseVerified(false); } } catch { /* No automatic closure/retry on hydration. */ }
    setHydrated(true);
    return () => { alive.current = false; };
  }, []);

  const check = async () => {
    const captured = current.current;
    if (!hydrated || !modeValid || recoveryBusy.current || captured.readPending) return;
    setAbandonProof(null); setAbandonConsent(false);
    publish(updateA1JobView(captured, { type: "read_started" }));
    const result = await readA1Reconciliation(captured, undefined, 15_000, ownArtifactId ?? undefined);
    // The original-mode endpoint may expose the latest global job. Never present another source as this mode's result.
    const event = result.event;
    if (event.type === "read_received" && event.availability.ok && event.availability.latestJob && !a1UiJobMatchesMode(event.availability.latestJob, context)) result.event = { type: "read_received", availability: { ...event.availability, latestJob: null } };
    if (alive.current) {
      if (result.event.type === "intent_read_received") setLastReadJob(result.event.job);
      else if (result.event.type === "read_received" && result.event.availability.ok) setLastReadJob(result.event.availability.latestJob ?? null);
      setResetProof(null); setResetConsent(false);
      publish(applyA1Reconciliation(current.current, result));
    }
  };
  const submit = async () => {
    const before = current.current, available = before.availability;
    if (!hydrated || !modeValid || recoveryBusy.current || closeIntent && !closeVerified || !a1JobView(before).controls.canRequest || !available?.ok || !available.documentVersion || !available.policyRevision) return;
    const intent = { batchId: before.batchId, requestId: crypto.randomUUID(), expectedDocumentVersion: available.documentVersion, expectedPolicyRevision: available.policyRevision, ...(ownArtifactId == null ? {} : { expectedOwnArtifactId: ownArtifactId }) };
    const pending = updateA1JobView(before, { type: "request_started", intent });
    if (pending === before) return;
    try { rememberA1UiIntent(sessionStorage, context, intent); } catch { /* Hidden intent remains bound in memory. */ }
    setResetProof(null); setResetConsent(false); setRecoveryMessage("");
    remainingReads.current = 12; publish(pending);
    const result = await submitA1Intent(intent);
    if (!alive.current || current.current.batchId !== intent.batchId) return;
    publish(updateA1JobView(current.current, result.kind === "success"
      ? { type: "request_admitted", requestId: intent.requestId, job: result.value }
      : result.kind === "rejected" ? { type: "request_rejected", requestId: intent.requestId, error: result.error }
      : { type: "request_transport_failed", requestId: intent.requestId }));
  };
  const readRecovery = async () => {
    const captured = current.current, expected = a1RecoveryIntent(captured, context);
    if (!expected || recoveryBusy.current || captured.readPending || captured.postPending) return;
    recoveryBusy.current = true; setRecoveryPending(true); setResetProof(null); setResetConsent(false); setAbandonProof(null); setAbandonConsent(false); setRecoveryMessage("");
    const epoch = ++recoveryEpoch.current;
    publish(updateA1JobView(captured, { type: "read_started" }));
    try {
      const observed = await readA1Intent(expected);
      if (!alive.current || epoch !== recoveryEpoch.current) return;
      if (observed.kind === "success") {
        setLastReadJob(observed.value);
        if (current.current.intent?.requestId === expected.requestId) publish(updateA1JobView(current.current, { type: "intent_read_received", requestId: expected.requestId, job: observed.value }));
        else publish({ ...current.current, job: observed.value, readPending: false });
      } else if (current.current.intent?.requestId === expected.requestId) publish(updateA1JobView(current.current, { type: "intent_read_failed", requestId: expected.requestId, error: observed.kind === "rejected" ? observed.error : "read_transport_failed" }));
      const fresh = await readA1Availability(batchId, undefined, 15_000, ownArtifactId ?? undefined);
      if (!alive.current || epoch !== recoveryEpoch.current) return;
      if (fresh.kind === "success" && fresh.value.ok && fresh.value.latestJob && a1UiJobMatchesMode(fresh.value.latestJob, context)) setLastReadJob(fresh.value.latestJob);
      const proof = makeA1ResetProof(context, expected, observed, fresh, monotonic());
      if (JSON.stringify(a1RecoveryIntent(current.current, context)) !== JSON.stringify(expected)) return;
      setResetProof(proof); setRecoveryMessage(proof ? "A situação foi conferida. A nova solicitação depende da sua confirmação abaixo." : COPY.recoveryUnavailable);
    } finally {
      recoveryBusy.current = false;
      if (alive.current) { publish({ ...current.current, readPending: false }); setRecoveryPending(false); }
    }
  };
  const reset = () => {
    const expected = a1RecoveryIntent(current.current, context);
    if (recoveryBusy.current || !resetConsent || !a1ResetProofCurrent(resetProof, context, expected, monotonic()) || closeIntent && !closeVerified && !closeNotFound) { setResetProof(null); setResetConsent(false); setRecoveryMessage(COPY.recoveryUnavailable); return; }
    const retired = retireA1UiIntent(storage(), context, resetProof.intent);
    if (!retired.ok || closeIntent && !retireA1CloseIntent(storage(), context, closeIntent)) { setRecoveryMessage(COPY.recoveryUnavailable); return; }
    const decision = a1LocalResetDecision(resetProof, wallStamp());
    rememberA1LocalDecision(storage(), context, decision); setLocalDecisions(previous => [...previous.slice(-19), decision]);
    const incoming = resetProof.availability.latestJob;
    const availability = { ...resetProof.availability, latestJob: incoming && a1UiJobMatchesMode(incoming, context) ? incoming : null };
    const next = updateA1JobView({ ...createA1JobViewState(batchId), usedRequestIds: [...new Set([...current.current.usedRequestIds, resetProof.intent.requestId])] }, { type: "read_received", availability });
    setCloseIntent(null); setCloseVerified(false); setCloseNotFound(false); setCloseConsent(false); setResetProof(null); setResetConsent(false); setLastReadJob(null);
    publish(next); setRecoveryMessage(COPY.resetReady);
  };
  const acceptClosed = (job: A1JobObservation) => {
    setCloseVerified(true); setCloseNotFound(false); setCloseConsent(false); setResetProof(null); setResetConsent(false); setLastReadJob(job);
    if (current.current.intent?.requestId === job.requestId) publish(updateA1JobView(current.current, { type: "intent_read_received", requestId: job.requestId!, job }));
    else publish({ ...current.current, job, postPending: false, readPending: false, refreshRequired: true, errorCode: null });
    setRecoveryMessage(COPY.closed);
  };
  const closeExpired = async (repeat: boolean) => {
    const job = lastReadJob;
    if (!job || !closeConsent || !canCloseA1FromRead(job, context, Date.now()) || recoveryBusy.current || current.current.readPending || current.current.postPending) return;
    if (repeat ? !closeIntent || !closeNotFound || closeIntent.jobId !== job.jobId || closeIntent.expectedRevision !== job.revision : !!closeIntent) return;
    const next = repeat && closeIntent ? closeIntent : makeA1CloseIntent(context, job, crypto.randomUUID());
    if (!next) return;
    setAbandonProof(null); setAbandonConsent(false);
    setCloseIntent(next); setCloseVerified(false); setCloseNotFound(false); setResetProof(null); setResetConsent(false); rememberA1CloseIntent(storage(), context, next);
    recoveryBusy.current = true; setRecoveryPending(true); ++recoveryEpoch.current;
    try {
      const result = await exchangeA1Close(next, "POST");
      if (!alive.current) return;
      if (result.kind === "success") acceptClosed(result.value.job); else setRecoveryMessage(COPY.closeUncertain);
    } finally { recoveryBusy.current = false; if (alive.current) setRecoveryPending(false); }
  };
  const checkClosure = async () => {
    const closing = closeIntent;
    if (!closing || recoveryBusy.current || current.current.readPending || current.current.postPending) return;
    recoveryBusy.current = true; setRecoveryPending(true); setResetProof(null); setResetConsent(false); setAbandonProof(null); setAbandonConsent(false); const epoch = ++recoveryEpoch.current;
    try {
      const result = await exchangeA1Close(closing, "GET");
      if (!alive.current || epoch !== recoveryEpoch.current) return;
      if (result.kind === "success") acceptClosed(result.value.job);
      else {
        const missing = result.kind === "rejected" && result.status === 404 && result.error === "not_found";
        setCloseNotFound(missing); setRecoveryMessage(COPY.closeUncertain);
        if (missing) {
          const fresh = await readA1Availability(batchId, undefined, 15_000, ownArtifactId ?? undefined);
          if (!alive.current || epoch !== recoveryEpoch.current) return;
          const proof = makeA1CloseAbandonProof(context, closing, result, fresh, monotonic());
          if (fresh.kind === "success" && fresh.value.ok && fresh.value.latestJob && a1UiJobMatchesMode(fresh.value.latestJob, context)) setLastReadJob(fresh.value.latestJob);
          setAbandonProof(proof);
          if (proof?.reason === "already_terminal") setRecoveryMessage(COPY.terminalObserved);
        }
      }
    } finally { recoveryBusy.current = false; if (alive.current) setRecoveryPending(false); }
  };
  const abandonClosure = () => {
    if (recoveryBusy.current || !abandonConsent || !a1CloseAbandonProofCurrent(abandonProof, context, closeIntent, monotonic())) { setAbandonProof(null); setAbandonConsent(false); setRecoveryMessage(COPY.recoveryUnavailable); return; }
    if (!retireA1CloseIntent(storage(), context, abandonProof.intent)) { setRecoveryMessage(COPY.recoveryUnavailable); return; }
    const record = rememberA1LocalCloseDecision(storage(), context, abandonProof, wallStamp());
    setCloseDecisions(previous => [...previous.slice(-19), record]);
    setLastReadJob(abandonProof.job); setCloseIntent(null); setCloseVerified(false); setCloseNotFound(false); setCloseConsent(false);
    setResetProof(null); setResetConsent(false); setAbandonProof(null); setAbandonConsent(false);
    publish({ ...current.current, job: abandonProof.job, readPending: false, refreshRequired: true });
    setRecoveryMessage(COPY.abandoned);
  };
  const close = () => { setOpen(false); dialog.current?.close(); requestAnimationFrame(() => trigger.current?.focus()); };
  const view = a1JobView(state);
  const matchingJob = a1UiJobMatchesMode(state.job, context);
  useEffect(() => {
    const denied = ["authentication_required", "stepup_required", "forbidden", "rate_limited"].includes(state.errorCode ?? "");
    const inProgress = state.postPending || state.resultUncertain || !!state.job && ["queued", "running", "validating"].includes(state.job.state);
    if (!open || !hydrated || !modeValid || recoveryPending || resetProof || abandonProof || closeIntent && !closeVerified || state.readPending || denied || !inProgress || remainingReads.current <= 0) return;
    const timer = setTimeout(() => { remainingReads.current--; void check(); }, 3_000);
    return () => clearTimeout(timer);
  }, [open, state, hydrated, recoveryPending, resetProof, abandonProof, closeIntent, closeVerified]);
  useEffect(() => {
    const sha256 = state.job?.outputSha256;
    if (view.signaturePublished && matchingJob && sha256 && refreshedOutput.current !== sha256) { refreshedOutput.current = sha256; onPublished?.(sha256); }
  }, [view.signaturePublished, matchingJob, state.job?.outputSha256, onPublished]);
  const status = view.phase === "queued" ? COPY.queued : view.phase === "running" ? COPY.running : view.signaturePublished && matchingJob ? "ICP-Brasil" : view.phase === "failed" ? COPY.failure : "—";
  return <>
    <button ref={trigger} type="button" className="v2-btn v2-btn-sec" disabled={!hydrated || !modeValid} onClick={() => { remainingReads.current = 12; setOpen(true); dialog.current?.showModal(); void check(); }}>{COPY.action}</button>
    <dialog ref={dialog} className="adm-modal" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close(); }}>
      <div className="in" aria-busy={state.readPending || state.postPending}>
        <div className="adm-bar"><h3 id={titleId}>{COPY.action} · {batchId}{ownArtifactId != null ? " · confirmação própria" : ""}</h3><button type="button" className="adm-btn" onClick={close}>Fechar</button></div>
        {ownArtifactId != null && <p className="small" style={{ overflowWrap: "anywhere" }}>PDF da confirmação própria: <code>{ownArtifactId}</code></p>}
        <p role="status">{status}</p>
        {(state.resultUncertain || state.errorCode || view.completionUnproven) && <p className="v2-aviso erro" role="alert">{COPY.uncertain}</p>}
        <div className="fim">
          <button type="button" className="adm-btn" disabled={!hydrated || !modeValid || recoveryPending || !!closeIntent && !closeVerified || !view.controls.canRequest} onClick={() => void submit()}>{COPY.action}</button>
          <button type="button" className="adm-btn" disabled={!hydrated || !modeValid || recoveryPending || !view.controls.canCheckResult} onClick={() => void check()}>{COPY.check}</button>
          {view.controls.canReadSignedVersion && matchingJob && state.job?.outputVersionId && <a className="adm-btn" href={`/api/admin/lotes/${batchId}/versoes/${encodeURIComponent(state.job.outputVersionId)}`}>Baixar PDF assinado</a>}
        </div>
        {(a1RecoveryIntent(state, context) || closeIntent) && <section className="box" aria-label="Recuperação da solicitação A1">
          <button type="button" className="adm-btn" disabled={recoveryPending || state.postPending || state.readPending} onClick={() => void readRecovery()}>{COPY.recovery}</button>
          {recoveryMessage && <p role="status">{recoveryMessage}</p>}
          {resetProof && <>
            <label className="adm-check"><input type="checkbox" checked={resetConsent} disabled={recoveryPending || !!closeIntent && !closeVerified && !closeNotFound} onChange={event => setResetConsent(event.target.checked)} />{COPY.resetConsent}</label>
            <button type="button" className="adm-btn" disabled={recoveryPending || !resetConsent || !!closeIntent && !closeVerified && !closeNotFound} onClick={reset}>{COPY.reset}</button>
          </>}
          {!closeIntent && canCloseA1FromRead(lastReadJob, context, Date.now()) && <>
            <label className="adm-check"><input type="checkbox" checked={closeConsent} disabled={recoveryPending} onChange={event => setCloseConsent(event.target.checked)} />{COPY.closeConsent}</label>
            <button type="button" className="adm-btn" disabled={recoveryPending || !closeConsent} onClick={() => void closeExpired(false)}>{COPY.close}</button>
          </>}
          {closeIntent && <>
            <p className="small" style={{ overflowWrap: "anywhere" }}>Pedido de encerramento: <code>{closeIntent.requestId}</code></p>
            <button type="button" className="adm-btn" disabled={recoveryPending || state.postPending || state.readPending} onClick={() => void checkClosure()}>{COPY.closeCheck}</button>
            {abandonProof && <>
              <label className="adm-check"><input type="checkbox" checked={abandonConsent} disabled={recoveryPending} onChange={event => setAbandonConsent(event.target.checked)} />{COPY.abandonConsent}</label>
              <button type="button" className="adm-btn" disabled={recoveryPending || !abandonConsent} onClick={abandonClosure}>{COPY.abandon}</button>
            </>}
            {closeNotFound && canCloseA1FromRead(lastReadJob, context, Date.now()) && closeIntent.expectedRevision === lastReadJob?.revision && <>
              <label className="adm-check"><input type="checkbox" checked={closeConsent} disabled={recoveryPending} onChange={event => setCloseConsent(event.target.checked)} />{COPY.closeConsent}</label>
              <button type="button" className="adm-btn" disabled={recoveryPending || !closeConsent} onClick={() => void closeExpired(true)}>{COPY.closeRetry}</button>
            </>}
          </>}
          {closeDecisions.length > 0 && <details><summary>Registro local dos pedidos de encerramento</summary><p className="small">Este registro do navegador pode ser alterado e não substitui a auditoria do servidor.</p><ul>{closeDecisions.map((record, i) => <li key={i} style={{ overflowWrap: "anywhere" }}>{record.at ?? "Horário local indisponível"} · {record.oldRequestId} · {record.observedReason} · revisão {record.observedRevision}</li>)}</ul></details>}
          {localDecisions.length > 0 && <details><summary>Registro local de recuperação</summary><p className="small">Este registro do navegador pode ser alterado e não substitui a auditoria do servidor.</p><ul>{localDecisions.map((record, i) => <li key={i} style={{ overflowWrap: "anywhere" }}>{record.at ?? "Horário local indisponível"} · {record.oldRequestId} · {record.observedReason}</li>)}</ul></details>}
        </section>}
      </div>
    </dialog>
  </>;
}
