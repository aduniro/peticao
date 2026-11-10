"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { parsePresidentConfirmation, parsePresidentState, presidentJsonRequest, presidentPdfRequest, samePresidentDocument, validPresidentCredentials, type PresidentCredentials, type PresidentState } from "@/lib/president-client";

/** Credentials, identity fields and PDF URLs remain in this page's memory only. */
export default function PresidentePortal() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [credentials, setCredentials] = useState<PresidentCredentials | null>(null);
  const [state, setState] = useState<PresidentState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [cpf, setCpf] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const epoch = useRef(0);
  const operation = useRef(false);
  const url = useRef<string | null>(null);
  const finished = !!receiptId || state?.state === "consumed";
  const expire = !!state && Date.parse(state.expiresAt) <= Date.now();

  function forgetPdf() {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    setPdfUrl(null);
    setReviewed(false);
  }
  useEffect(() => () => { epoch.current++; if (url.current) URL.revokeObjectURL(url.current); }, []);
  async function run(label: string, work: (current: () => boolean) => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    const generation = epoch.current;
    setBusy(label);
    const current = () => epoch.current === generation;
    try { await work(current); } catch { if (current()) setMessage("Não foi possível concluir a consulta. Confira a situação antes de continuar."); }
    finally { if (current()) { operation.current = false; setBusy(null); } }
  }
  function close() {
    epoch.current++;
    operation.current = false;
    forgetPdf();
    setCredentials(null); setState(null); setToken(""); setPassword(""); setCpf(""); setBirthDate(""); setReceiptId(null); setUncertain(false); setMessage(""); setBusy(null);
  }
  async function enter(event: FormEvent) {
    event.preventDefault();
    const candidate = { token: token.trim(), password: password.trim() };
    if (!validPresidentCredentials(candidate)) { setMessage("Confira o código de acesso e a senha informados."); return; }
    await run("Consultando acesso…", async current => {
      const result = await presidentJsonRequest("/api/presidente/estado", candidate);
      if (!current()) return;
      const next = result.ok ? parsePresidentState(result.data) : null;
      if (!next) { setMessage("O acesso não está disponível. Confira os dados e a validade com o administrador."); return; }
      setCredentials(candidate); setToken(""); setPassword(""); setState(next); setReceiptId(next.receipt?.receiptId ?? null); setMessage("");
    });
  }
  async function consult() {
    if (!credentials) return;
    await run("Conferindo situação…", async current => {
      const result = await presidentJsonRequest("/api/presidente/estado", credentials);
      if (!current()) return;
      const next = result.ok ? parsePresidentState(result.data) : null;
      if (!next) { setUncertain(true); forgetPdf(); setMessage("Não foi possível conferir a situação. Nenhuma confirmação será repetida automaticamente."); return; }
      const changed = !state || !samePresidentDocument(state.document, next.document);
      if (changed) forgetPdf();
      setState(next); setReceiptId(next.receipt?.receiptId ?? null);
      // Only an authoritative issued state explicitly permits a fresh user action.
      setUncertain(next.state === "verifying" || !next.canConfirm && next.state !== "consumed");
      setMessage(next.state === "consumed" ? "Confirmação registrada." : next.state === "verifying" ? "A conferência está em andamento. Consulte novamente antes de outra ação." : changed ? "O documento foi atualizado. Abra e revise a versão atual." : "Situação conferida.");
    });
  }
  async function loadPdf() {
    if (!credentials || !state || uncertain || finished || expire) return;
    const expected = state.document;
    await run("Conferindo documento…", async current => {
      forgetPdf();
      const result = await presidentPdfRequest(credentials, expected);
      if (!current()) return;
      if (!result.ok) { setMessage("Não foi possível conferir o documento. Consulte a situação e abra novamente antes de confirmar."); return; }
      const next = URL.createObjectURL(new Blob([new Uint8Array(result.data).buffer], { type: "application/pdf" }));
      url.current = next; setPdfUrl(next); setMessage("Documento conferido. Revise o PDF antes de confirmar.");
    });
  }
  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!credentials || !state || !state.canConfirm || !pdfUrl || !reviewed || uncertain || finished || expire) return;
    const digits = cpf.replace(/\D/g, "");
    if (digits.length !== 11 || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) { setMessage("Informe seu CPF e sua data de nascimento."); return; }
    const body = { ...credentials, cpf: digits, birthDate };
    await run("Registrando confirmação…", async current => {
      // No automatic retry, including a timeout, malformed success, or HTTP refusal.
      setUncertain(true); setCpf(""); setBirthDate("");
      const result = await presidentJsonRequest("/api/presidente/confirmar", body);
      if (!current()) return;
      const receipt = result.ok ? parsePresidentConfirmation(result.data) : null;
      if (!receipt) { setMessage("Não foi possível confirmar o resultado. Consulte a situação antes de outra ação. A confirmação não será repetida automaticamente."); return; }
      setReceiptId(receipt.receiptId); setUncertain(false); forgetPdf(); setMessage("Confirmação registrada.");
    });
  }
  return <main className="narrow">
    <h1>Presidente da ADUNIR</h1>
    <p>Revisão e confirmação do documento.</p>
    <section className="box" aria-label="Acesso ao documento">
      {!credentials ? <form className="form" onSubmit={enter} autoComplete="off">
        <label htmlFor="president-token">Código de acesso<input id="president-token" name="president-access" type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={64} required disabled={!!busy} /></label>
        <label htmlFor="president-password">Senha do acesso<input id="president-password" name="president-password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="off" maxLength={32} required disabled={!!busy} /></label>
        <button type="submit" className="primary" disabled={!!busy}>Abrir documento</button>
        <p className="small">Use o código e a senha fornecidos pelo administrador. Ao fechar ou recarregar esta página, será necessário informá-los novamente.</p>
      </form> : state && <>
        <h2>Lote {state.document.seq} · {state.document.kind === "final" ? "final" : "parcial"}</h2>
        <dl style={{ overflowWrap: "anywhere" }}><dt>Documento</dt><dd><code>{state.document.sha256}</code></dd><dt>Validade do acesso</dt><dd>{new Date(state.expiresAt).toLocaleString("pt-BR")}</dd></dl>
        {finished ? <div className="box ok"><strong>Confirmação registrada</strong><p style={{ overflowWrap: "anywhere" }}>Recibo: <code>{receiptId ?? state.receipt?.receiptId}</code></p>{state.receipt && <p>{new Date(state.receipt.confirmedAt).toLocaleString("pt-BR")}</p>}</div> : <>
          {expire && <p role="status">Este acesso expirou. Solicite um novo acesso ao administrador.</p>}
          <p><button type="button" onClick={loadPdf} disabled={!!busy || uncertain || expire}>Abrir PDF para revisão</button></p>
          {pdfUrl && <>
            <p><a className="btn" href={pdfUrl} download={`documento-lote-${state.document.seq}.pdf`} referrerPolicy="no-referrer">Baixar PDF conferido</a></p>
            <iframe title={`Documento do lote ${state.document.seq}`} src={pdfUrl} sandbox="" referrerPolicy="no-referrer" style={{ width: "100%", height: "60vh", minHeight: 300, border: "1px solid var(--line)" }} />
            <form className="form" onSubmit={confirm} autoComplete="off">
              <label className="consent"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} disabled={!!busy || uncertain || expire} />Li o documento e confirmo minha assinatura nesta versão.</label>
              <label htmlFor="president-cpf">CPF<input id="president-cpf" name="president-cpf" type="text" inputMode="numeric" autoComplete="off" value={cpf} onChange={e => setCpf(e.target.value)} maxLength={14} required disabled={!!busy || uncertain || expire} /></label>
              <label htmlFor="president-birth">Data de nascimento<input id="president-birth" name="president-birth" type="date" autoComplete="off" value={birthDate} onChange={e => setBirthDate(e.target.value)} required disabled={!!busy || uncertain || expire} /></label>
              <button type="submit" className="primary" disabled={!!busy || !reviewed || !state.canConfirm || uncertain || expire}>Confirmar assinatura</button>
            </form>
          </>}
        </>}
        <div className="seg-row"><button type="button" onClick={consult} disabled={!!busy}>Conferir situação</button><button type="button" onClick={close}>Encerrar acesso</button></div>
      </>}
      <p role="status" aria-live="polite" aria-busy={!!busy}>{busy || message}</p>
    </section>
  </main>;
}
