"use client";
import React, { useEffect, useId, useRef, useState } from "react";
import { brasilia } from "@/lib/time";
import { appendInboxPage, inboxAccount, inboxGet, InboxRequestError, parseInboxMessages, parseInboxPreview, parseInboxThreads, type InboxMessage, type InboxPage, type InboxPreview, type InboxThread } from "@/lib/inbox-view";
const LIST_ERROR = "Não foi possível carregar a lista. Tente novamente.";
const PREVIEW_ERROR = "Não foi possível carregar a prévia. Tente novamente.";
const UNAVAILABLE = "Prévia indisponível para esta mensagem.";
const STATUS = { available: "Disponível", expired: "Expirado", unavailable: "Indisponível" };

export default function Inbox() {
  const [input, setInput] = useState(""), [account, setAccount] = useState(""), [threads, setThreads] = useState<InboxPage<InboxThread> | null>(null), [thread, setThread] = useState<string | null>(null), [messages, setMessages] = useState<InboxPage<InboxMessage> | null>(null);
  const [preview, setPreview] = useState<InboxPreview | null>(null), [message, setMessage] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [previewError, setPreviewError] = useState<string | null>(null), [auth, setAuth] = useState<401 | 403 | null>(null);
  const active = useRef<AbortController | null>(null), dialog = useRef<HTMLDialogElement>(null), returnFocus = useRef<HTMLButtonElement | null>(null), title = useId();
  useEffect(() => () => active.current?.abort(), []);
  const close = () => { active.current?.abort(); active.current = null; dialog.current?.close(); setBusy(false); setPreview(null); setPreviewError(null); setMessage(null); requestAnimationFrame(() => returnFocus.current?.focus()); };
  const perform = async (work: (signal: AbortSignal) => Promise<void>, forPreview = false) => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setAuth(null); if (forPreview) setPreviewError(null); else setError(null);
    const timer = setTimeout(() => controller.abort(), 15_000);
    try { await work(controller.signal); }
    catch (failure) {
      if (active.current !== controller) return;
      if (failure instanceof InboxRequestError && (failure.status === 401 || failure.status === 403)) setAuth(failure.status);
      const note = failure instanceof InboxRequestError && (failure.status === 404 || failure.status === 409 || failure.status === 410) && forPreview ? UNAVAILABLE : forPreview ? PREVIEW_ERROR : LIST_ERROR;
      if (forPreview) setPreviewError(note); else setError(note);
    } finally { clearTimeout(timer); if (active.current === controller) { active.current = null; setBusy(false); } }
  };
  const loadThreads = (selected: string, more = false) => {
    if (!inboxAccount(selected) || active.current) return;
    const changed = selected !== account;
    if (changed) { setAccount(selected); setThreads(null); setThread(null); setMessages(null); setPreview(null); }
    return perform(async signal => {
      const cursor = more ? threads?.nextCursor : null;
      const url = `/api/admin/inbox/conversas?account=${encodeURIComponent(selected)}&limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const page = parseInboxThreads(await inboxGet(fetch, url, signal));
      if (signal.aborted) return;
      const next = page && more && threads ? appendInboxPage(threads, page, row => row.thread_root) : page;
      if (!next) throw new Error("invalid_threads");
      setThreads(next);
    });
  };
  const loadMessages = (selected: string, more = false) => {
    if (active.current) return;
    if (selected !== thread) { setThread(selected); setMessages(null); setPreview(null); }
    return perform(async signal => {
      const cursor = more ? messages?.nextCursor : null;
      const url = `/api/admin/inbox/conversas/${encodeURIComponent(selected)}?account=${encodeURIComponent(account)}&limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const page = parseInboxMessages(await inboxGet(fetch, url, signal));
      if (signal.aborted) return;
      const next = page && more && messages ? appendInboxPage(messages, page, row => row.id) : page;
      if (!next) throw new Error("invalid_messages");
      setMessages(next);
    });
  };
  const visualize = (id: string, button: HTMLButtonElement) => {
    if (active.current) return;
    returnFocus.current = button; setPreview(null); setMessage(id); setPreviewError(null); dialog.current?.showModal();
    return perform(async signal => {
      const result = parseInboxPreview(await inboxGet(fetch, `/api/admin/inbox/mensagens/${encodeURIComponent(id)}/previa`, signal));
      if (signal.aborted) return;
      if (!result) throw new Error("invalid_preview");
      if (result.state === "limited") setPreviewError(UNAVAILABLE); else setPreview(result);
    }, true);
  };
  return <section data-testid="inbox" aria-busy={busy}>
    <form className="v2-filtros" onSubmit={event => { event.preventDefault(); void loadThreads(input.trim()); }}>
      <label>Conta<input value={input} onChange={event => setInput(event.target.value)} maxLength={80} autoComplete="off" spellCheck={false} disabled={busy} /></label>
      <button className="adm-btn" type="submit" disabled={busy || !inboxAccount(input.trim())}>Atualizar</button>
    </form>
    {account && <p>Conta: <code style={{ overflowWrap: "anywhere" }}>{account}</code></p>}
    {error && <p role="alert" className="v2-aviso erro">{error}</p>}
    {auth && <p><a className="adm-btn" href={auth === 401 ? "/admin" : "/admin/confirmar?volta=%2Fadmin%2Finbox"}>{auth === 401 ? "Entrar" : "Confirmar"}</a></p>}
    {threads && <section data-testid="inbox-threads"><h2>Conversas</h2><div className="table-scroll"><table style={{ minWidth: 680 }}><thead><tr><th>ID</th><th>Mensagens</th><th>Disponíveis</th><th>Data</th><th>Ações</th></tr></thead><tbody>
      {threads.rows.map(row => <tr key={row.thread_root}><td><code>{row.thread_root}</code></td><td>{row.messages}</td><td>{row.available}</td><td>{brasilia(row.last_at)}</td><td><button type="button" className="adm-btn sm" disabled={busy} onClick={() => void loadMessages(row.thread_root)}>Visualizar</button></td></tr>)}
      {!threads.rows.length && <tr><td colSpan={5}>—</td></tr>}
    </tbody></table></div>{threads.nextCursor && <button type="button" className="adm-btn sm" disabled={busy} onClick={() => void loadThreads(account, true)}>Carregar mais</button>}</section>}
    {thread && <section data-testid="inbox-messages"><h2>Mensagens</h2><p>ID: <code style={{ overflowWrap: "anywhere" }}>{thread}</code></p><button type="button" className="adm-btn sm" disabled={busy} onClick={() => void loadMessages(thread)}>Atualizar</button>
      {messages && <><div className="table-scroll"><table style={{ minWidth: 680 }}><thead><tr><th>ID</th><th>Data</th><th>Status</th><th>Ações</th></tr></thead><tbody>
        {messages.rows.map(row => <tr key={row.id}><td><code>{row.id}</code></td><td>{brasilia(row.received_at)}</td><td>{STATUS[row.state]}</td><td><button type="button" className="adm-btn sm" disabled={busy || row.state !== "available"} onClick={event => void visualize(row.id, event.currentTarget)}>Visualizar</button></td></tr>)}
        {!messages.rows.length && <tr><td colSpan={4}>—</td></tr>}
      </tbody></table></div>{messages.nextCursor && <button type="button" className="adm-btn sm" disabled={busy} onClick={() => void loadMessages(thread, true)}>Carregar mais</button>}</>}
    </section>}
    <dialog ref={dialog} className="adm-modal" aria-labelledby={title} data-testid="inbox-preview" onCancel={event => { event.preventDefault(); close(); }}>
      <div className="in"><div className="adm-bar"><h3 id={title}>Caixa de entrada</h3><button type="button" className="adm-btn" onClick={close}>Fechar</button></div>
        {busy && <p role="status">Carregando…</p>}{previewError && <p role="alert" className="v2-aviso erro">{previewError}</p>}
        {auth && <p><a className="adm-btn" href={auth === 401 ? "/admin" : "/admin/confirmar?volta=%2Fadmin%2Finbox"}>{auth === 401 ? "Entrar" : "Confirmar"}</a></p>}
        {preview?.state === "ready" && <><p>{preview.subject}</p><iframe title="Caixa de entrada" sandbox="" referrerPolicy="no-referrer" srcDoc={preview.html} style={{ width: "100%", height: "60vh", border: 0 }} />
          {preview.attachments.length > 0 && <div className="table-scroll"><table><thead><tr><th>Anexos</th><th>Bytes</th><th>Ações</th></tr></thead><tbody>{preview.attachments.map((attachment, index) => <tr key={index}><td style={{ overflowWrap: "anywhere" }}>{attachment.filename || "—"}</td><td>{attachment.bytes}</td><td><a className="adm-btn sm" href={`/api/admin/inbox/mensagens/${encodeURIComponent(message!)}/anexos/${index}`}>Baixar</a></td></tr>)}</tbody></table></div>}
        </>}
      </div>
    </dialog>
  </section>;
}
