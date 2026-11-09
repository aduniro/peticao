"use client";
/** OFFLINE DRAFT: not imported by any app route. Copy requires owner's text approval. */
import { useEffect, useRef, useState } from "react";
import { confirmationState, postPresidentConfirmation, presidentFieldErrors, type ConfirmationState, type PresidentFields } from "../../site/src/lib/president-confirmation-view";
import { showCpfError } from "../../site/src/lib/cpf-feedback";
import { maskCpf } from "../../site/src/lib/cpf-mask";
import type { PresidentPdfResult } from "../../site/src/lib/president-confirmation-access";
import type { PresidentDraftCopy } from "./copy-proposed";
import styles from "./president-confirmation-draft.module.css";

type Credentials = { token: string; password: string };
export type DocumentView = PresidentPdfResult;
export type ReceiptView = { kind: "pending" | "verifying"; documentVersion: string; canConfirm: boolean } | { kind: "confirmed"; documentVersion: string; receiptId: string } | { kind: "rejected" | "uncertain" };
type Props = {
  token: string; copy: PresidentDraftCopy; transport: typeof fetch;
  readDocument: (credentials: Credentials) => Promise<DocumentView>;
  readState: (credentials: Credentials) => Promise<ReceiptView>;
};
const initialFields = (): PresidentFields => ({ password: "", cpf: "", birthDate: "" });
const idle = (): ConfirmationState => ({ phase: "idle", requestId: 0 });

export default function PresidentConfirmationDraft({ token, copy, transport, readDocument, readState }: Props) {
  const [fields, setFields] = useState(initialFields), [state, setState] = useState(idle);
  const [document, setDocument] = useState<{ url: string; version: string; canConfirm: boolean } | null>(null);
  const [busy, setBusy] = useState(false), [loadError, setLoadError] = useState(false), [fieldError, setFieldError] = useState(false), [cpfBlurred, setCpfBlurred] = useState(false);
  const operation = useRef(false), generation = useRef(0), currentToken = useRef(token), objectUrl = useRef<string | null>(null), mounted = useRef(true);
  const inputs = useRef<Partial<Record<keyof PresidentFields, HTMLInputElement>>>({});
  const releaseDocument = () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; setDocument(null); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }; }, []);
  useEffect(() => {
    if (currentToken.current === token) return;
    currentToken.current = token; generation.current++; operation.current = false; setBusy(false);
    releaseDocument(); setFields(initialFields()); setState(idle()); setLoadError(false); setFieldError(false);
  }, [token]);
  const change = (key: keyof PresidentFields, value: string) => {
    if (operation.current) return;
    if (key === "password" && document) { releaseDocument(); setState(idle()); setFields({ password: value, cpf: "", birthDate: "" }); }
    else setFields(previous => ({ ...previous, [key]: value }));
    setFieldError(false); setLoadError(false);
  };
  const load = async () => {
    if (operation.current || state.phase === "confirmed" || state.phase === "uncertain") return;
    if (!/^[A-Za-z0-9_-]{12}$/.test(fields.password)) { setFieldError(true); inputs.current.password?.focus(); return; }
    operation.current = true; setBusy(true); setLoadError(false); const revision = ++generation.current;
    try {
      const result = await readDocument({ token, password: fields.password });
      if (!mounted.current || revision !== generation.current) return;
      if (result.kind === "confirmed") { releaseDocument(); setState({ phase: "confirmed", requestId: state.requestId, receiptId: result.receiptId }); setFields(initialFields()); return; }
      if (result.kind !== "available" || result.pdf.type !== "application/pdf" || !result.pdf.size || !/^[a-f0-9]{64}$/.test(result.documentVersion)) { setLoadError(true); return; }
      releaseDocument(); const url = URL.createObjectURL(result.pdf); objectUrl.current = url; setDocument({ url, version: result.documentVersion, canConfirm: result.canConfirm }); setState(result.canConfirm ? idle() : { phase: "uncertain", requestId: state.requestId });
    } catch { if (mounted.current && revision === generation.current) setLoadError(true); }
    finally { if (mounted.current && revision === generation.current) { operation.current = false; setBusy(false); } }
  };
  const confirm = async () => {
    if (!document?.canConfirm || operation.current || !["idle", "rejected"].includes(state.phase)) return;
    const errors = presidentFieldErrors(fields);
    if (Object.keys(errors).length) { setFieldError(true); if (errors.cpf) setCpfBlurred(true); const first = (["password", "cpf", "birthDate"] as const).find(key => errors[key]); if (first) inputs.current[first]?.focus(); return; }
    operation.current = true; setBusy(true); setFieldError(false); const requestId = state.requestId + 1, revision = ++generation.current;
    setState(previous => confirmationState(previous, { type: "begin", requestId }));
    try {
      const result = await postPresidentConfirmation({ token, ...fields }, transport);
      if (!mounted.current || revision !== generation.current) return;
      setState(previous => confirmationState(previous, { type: "result", requestId, result }));
      if (result.kind === "confirmed") { releaseDocument(); setFields(initialFields()); } // Only success clears sensitive inputs.
    } finally { if (mounted.current && revision === generation.current) { operation.current = false; setBusy(false); } }
  };
  const reconcile = async () => {
    if (!document || operation.current || state.phase !== "uncertain") return;
    operation.current = true; setBusy(true); const revision = ++generation.current;
    try {
      const result = await readState({ token, password: fields.password });
      if (!mounted.current || revision !== generation.current || !("documentVersion" in result) || result.documentVersion !== document.version) return;
      if (result.kind === "confirmed" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(result.receiptId)) { setState({ phase: "confirmed", requestId: state.requestId, receiptId: result.receiptId }); releaseDocument(); setFields(initialFields()); }
      else if ((result.kind === "pending" || result.kind === "verifying") && result.canConfirm) { setDocument(previous => previous && { ...previous, canConfirm: true }); setState({ phase: "idle", requestId: state.requestId }); }
    } catch { /* Remain uncertain, preserving entered values. Never repeat confirmation. */ }
    finally { if (mounted.current && revision === generation.current) { operation.current = false; setBusy(false); } }
  };
  const invalid = fieldError ? presidentFieldErrors(fields) : {};
  const cpfError = showCpfError(fields.cpf, cpfBlurred);
  return <main className={styles.page} aria-busy={busy}>
    <section className={styles.panel}>
      <h1>{copy.title}</h1>
      {state.phase === "confirmed" ? <p role="status">{copy.confirmed}<br /><code>{state.receiptId}</code></p> : <>
        <label>{copy.password}<input ref={element => { if (element) inputs.current.password = element; else delete inputs.current.password; }} type="password" autoComplete="one-time-code" value={fields.password} disabled={busy || state.phase === "uncertain"} onChange={event => change("password", event.target.value)} aria-invalid={!!invalid.password} /></label>
        <button type="button" onClick={() => void load()} disabled={busy || state.phase === "uncertain"}>{copy.viewDocument}</button>
        {loadError && <p role="alert" className={styles.error}>{copy.unavailable}</p>}
        {document && <>
          <iframe src={document.url} title={copy.document} className={styles.document} referrerPolicy="no-referrer" />
          <p><a href={document.url} download={"documento-" + document.version.slice(0, 12) + ".pdf"}>{copy.downloadDocument}</a></p>
          <form noValidate onSubmit={event => { event.preventDefault(); void confirm(); }}>
            <label>{copy.cpf}<input ref={element => { if (element) inputs.current.cpf = element; else delete inputs.current.cpf; }} inputMode="numeric" autoComplete="off" value={fields.cpf} disabled={busy || state.phase === "uncertain"} onChange={event => change("cpf", maskCpf(event.target.value))} onBlur={() => setCpfBlurred(true)} onFocus={() => setCpfBlurred(false)} aria-invalid={cpfError} /></label>
            {cpfError && <p className={styles.error}>{copy.invalidCpf}</p>}
            <label>{copy.birthDate}<input ref={element => { if (element) inputs.current.birthDate = element; else delete inputs.current.birthDate; }} type="date" autoComplete="off" value={fields.birthDate} disabled={busy || state.phase === "uncertain"} onChange={event => change("birthDate", event.target.value)} aria-invalid={!!invalid.birthDate} /></label>
            {fieldError && <p role="alert" className={styles.error}>{copy.invalidFields}</p>}
            {state.phase === "rejected" && <p role="alert" className={styles.error}>{copy.unavailable}</p>}
            {state.phase === "uncertain" && <p role="alert">{copy.uncertain}</p>}
            <button type="submit" disabled={busy || state.phase === "uncertain"}>{copy.confirm}</button>
            {state.phase === "uncertain" && <button type="button" onClick={() => void reconcile()} disabled={busy}>{copy.checkState}</button>}
          </form>
        </>}
      </>}
    </section>
  </main>;
}
