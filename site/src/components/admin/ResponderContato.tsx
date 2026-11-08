"use client";
import { useRef, useState } from "react";
import { parseDraftView, type SharedDraftView } from "@/lib/contact-draft-view";
import { brasilia } from "@/lib/time";

type Previa = { para: string; primeiroNome: string; codigoPessoal: string | null; texto: { assunto: string; texto: string }; card: { assunto: string; html: string; texto: string } | null; selo: string };
const ERROS: Record<string, string> = { assunto: "Escreva o assunto (mínimo 3 letras).", corpo: "Escreva a mensagem (mínimo 10 letras).", ja_respondida: "Esta mensagem já foi respondida. Use \"Responder de novo\" se for mesmo necessário.", selo: "O texto mudou depois da prévia. Veja a prévia de novo.", falhou: "O envio falhou.", nao_existe: "Mensagem não encontrada.", envio_inconclusivo: "Não foi possível confirmar o resultado do envio. Para evitar duplicação, a mensagem não será reenviada automaticamente. Confira o histórico antes de enviar outra resposta." };

/** Editor de resposta: escreve, vê a prévia dos dois e-mails e só então envia. Só aparece para o nível total (a rota confere de novo, com a confirmação extra). */
export default function ResponderContato({ contactId, assuntoInicial, jaRespondida }: { contactId: number; assuntoInicial: string; jaRespondida: boolean }) {
  const [aberto, setAberto] = useState(false), [assunto, setAssunto] = useState(assuntoInicial), [corpo, setCorpo] = useState("");
  const [previa, setPrevia] = useState<Previa | null>(null), [ok, setOk] = useState(false), [erro, setErro] = useState<string | null>(null), [msg, setMsg] = useState<string | null>(null), [ocupado, setOcupado] = useState(false);
  const flight = useRef(false), loaded = useRef(false);
  const [draft, setDraft] = useState<SharedDraftView | null>(null), [remote, setRemote] = useState<SharedDraftView | null>(null), [draftMsg, setDraftMsg] = useState<string | null>(null), [auth, setAuth] = useState(false);
  const authError = (status: number, value: any) => {
    if (status === 401 || status === 403 && value?.erro === "stepup") { setAuth(true); setErro("Confirme o acesso em outra aba e volte para continuar. Seu texto foi mantido."); return true; }
    return false;
  };
  const draftRequest = async (body?: unknown) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const r = await fetch(`/api/admin/contato/rascunho${body === undefined ? `?contato=${contactId}` : ""}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal });
      const value = await r.json().catch(() => null);
      if (authError(r.status, value)) return { draft: null, error: "auth" };
      return { draft: r.ok && value?.ok === true ? parseDraftView(value.draft) : null, error: typeof value?.error === "string" ? value.error : null };
    } finally { clearTimeout(timer); }
  };
  const useDraft = (value: SharedDraftView, replace: boolean) => {
    setDraft(value); setRemote(null); loaded.current = true;
    if (replace) { setAssunto(value.input?.assunto ?? assuntoInicial); setCorpo(value.input?.corpo ?? ""); setPrevia(null); setOk(false); }
  };
  const loadDraft = async () => {
    if (flight.current) return; flight.current = true; setOcupado(true); setErro(null);
    try {
      const result = await draftRequest();
      if (result.draft) { useDraft(result.draft, true); setDraftMsg(result.draft.state === "expired" ? "O rascunho anterior expirou. Você pode iniciar outro." : null); }
      else if (result.error !== "auth") setErro("Não foi possível carregar o rascunho. Tente novamente.");
    } catch { setErro("Não foi possível carregar o rascunho. Tente novamente."); }
    finally { flight.current = false; setOcupado(false); }
  };
  const saveDraft = async (discard = false, revision = draft?.revision) => {
    if (flight.current || revision === undefined) return; flight.current = true; setOcupado(true); setErro(null); setDraftMsg(null);
    const input = discard ? null : { assunto, corpo };
    try {
      let result;
      try { result = await draftRequest({ contactId, revision, input }); }
      catch {
        // A lost response may have committed. Read once; never repeat a POST automatically.
        const check = await draftRequest();
        if (check.draft && check.draft.revision > revision && (discard ? check.draft.state === "discarded" : check.draft.input?.assunto === assunto && check.draft.input?.corpo === corpo)) result = check;
        else { if (check.draft && check.draft.revision !== revision) setRemote(check.draft); throw new Error("unconfirmed"); }
      }
      if (result.draft) { useDraft(result.draft, discard); setDraftMsg(discard ? "Rascunho descartado." : "Rascunho salvo. Nenhum e-mail foi enviado."); }
      else if (result.error === "conflict") {
        const check = await draftRequest(); if (check.draft) setRemote(check.draft);
        setErro("O rascunho foi alterado por outra pessoa. Seu texto foi mantido; compare as versões antes de salvar.");
      } else if (result.error !== "auth") setErro("Não foi possível salvar o rascunho. Seu texto foi mantido.");
    } catch { setErro("Não foi possível confirmar se o rascunho foi salvo. Seu texto foi mantido. Confira a versão salva antes de tentar novamente."); }
    finally { flight.current = false; setOcupado(false); }
  };
  const chamar = async (modo: "previa" | "enviar") => {
    if (flight.current) return null; flight.current = true; setOcupado(true); setErro(null);
    try {
      const r = await fetch("/api/admin/contato/responder", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ contactId, modo, assunto, corpo, selo: previa?.selo, nova: jaRespondida }) });
      const j = await r.json().catch(() => ({}));
      if (authError(r.status, j)) return null;
      if (!r.ok) { setErro((ERROS[j.erro] ?? "Não foi possível.") + (j.detalhe ? ` (${j.detalhe})` : "")); return null; }
      return j;
    } catch { setErro(modo === "enviar" ? ERROS.envio_inconclusivo : ERROS.falhou); return null; } finally { flight.current = false; setOcupado(false); }
  };
  const ver = async () => { const j = await chamar("previa"); if (j) { setPrevia(j.previa); setOk(false); } };
  const enviar = async () => {
    const j = await chamar("enviar");
    if (j) {
      if (j.ok !== true || j.texto !== "enviado" && j.texto !== "na-fila") { setErro(ERROS.envio_inconclusivo); return; }
      setMsg(`${j.texto === "enviado" ? "Aceita pelo provedor" : "Aguardando envio"}: resposta só de texto; ${j.card === "agendado" ? "e-mail com o card agendado para cerca de 1 minuto depois" : "sem card (a pessoa não tem código pessoal)"}. Isso não comprova entrega ao destinatário. Recarregue a página para ver o histórico.`); setAberto(false); setPrevia(null);
    }
  };
  if (msg) return <p className="box ok" role="status">{msg}</p>;
  if (!aberto) return <p><button type="button" onClick={() => { setAberto(true); if (!loaded.current) void loadDraft(); }}>{jaRespondida ? "Responder de novo" : "Responder"}</button></p>;
  return (
    <div className="form" style={{ maxWidth: 720 }} data-testid={`contact-editor-${contactId}`} aria-busy={ocupado}>
      <p className="small">Rascunho compartilhado por contato · retenção de até 30 dias. Salvar não envia e-mail.</p>
      {draft?.author ? <p className="small">Versão {draft.revision} · {draft.author}{draft.updatedAt ? ` · ${brasilia(draft.updatedAt, true)}` : ""}</p> : null}
      {!loaded.current ? <button type="button" disabled={ocupado} onClick={() => void loadDraft()}>Carregar rascunho</button> : null}
      <label>Assunto<input disabled={ocupado || !loaded.current} value={assunto} onChange={(e) => { setAssunto(e.target.value); setPrevia(null); setDraftMsg(null); }} maxLength={150} /></label>
      <label>Mensagem (a saudação "Olá, Nome," e a assinatura "ADUNIR · ANDES-SN" entram sozinhas; separe os parágrafos com uma linha em branco)
        <textarea disabled={ocupado || !loaded.current} value={corpo} onChange={(e) => { setCorpo(e.target.value); setPrevia(null); setDraftMsg(null); }} rows={9} maxLength={5000} /></label>
      <p><button type="button" onClick={() => void saveDraft()} disabled={ocupado || !draft || !(assunto.trim() || corpo.trim())}>Salvar rascunho</button> <button type="button" onClick={() => void saveDraft(true)} disabled={ocupado || !draft || draft.revision === 0}>Descartar rascunho</button></p>
      {draftMsg ? <p role="status" className="small">{draftMsg}</p> : null}
      {remote ? <section className="box" data-testid="draft-conflict"><h3>Versão salva por {remote.author ?? "outro administrador"}</h3><p>{remote.input?.assunto ?? "Rascunho sem conteúdo"}</p><pre style={{ whiteSpace: "pre-wrap" }}>{remote.input?.corpo ?? ""}</pre><button type="button" disabled={ocupado} onClick={() => { useDraft(remote, true); setErro(null); }}>Usar versão salva</button> <button type="button" disabled={ocupado} onClick={() => void saveDraft(false, remote.revision)}>Salvar meu texto sobre a versão exibida</button></section> : null}
      <p><button type="button" onClick={ver} disabled={ocupado || !loaded.current}>Ver a prévia dos e-mails</button> <button type="button" className="link" disabled={ocupado} onClick={() => setAberto(false)}>Cancelar</button></p>
      {previa ? (
        <div className="box">
          <p className="small">Para: <strong>{previa.para}</strong> (cópia oculta para a caixa da ADUNIR)</p>
          <h3>1º e-mail: só texto, enviado agora</h3>
          <p className="small">Assunto: {previa.texto.assunto}</p>
          <pre style={{ whiteSpace: "pre-wrap" }}>{previa.texto.texto}</pre>
          <h3>2º e-mail: com o card de divulgação, cerca de 1 minuto depois</h3>
          {previa.card ? (<><p className="small">Assunto: {previa.card.assunto} · código pessoal {previa.codigoPessoal}</p><iframe title="Prévia do e-mail com o card" sandbox="" srcDoc={previa.card.html} style={{ width: "100%", height: 560, border: "1px solid #d5e0da", borderRadius: 8, background: "#fff" }} /></>) : <p className="small">Não sai: esta pessoa não tem cadastro com código pessoal de divulgação.</p>}
          <p><label><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> Li a prévia e quero enviar {previa.card ? "os dois e-mails" : "o e-mail"} para {previa.para}</label></p>
          <button type="button" onClick={enviar} disabled={!ok || ocupado}>Enviar</button>
        </div>
      ) : null}
      {erro ? <p className="err" role="alert">{erro}</p> : null}
      {auth ? <p><a href="/admin/confirmar?volta=/admin/contato" target="_blank" rel="noreferrer">Confirmar o acesso (código por e-mail) para responder</a></p> : null}
    </div>
  );
}
