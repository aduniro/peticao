"use client";
import { useEffect, useId, useRef, useState } from "react";
import { AI_INSTRUCTIONS_MAX_LENGTH } from "@/lib/ai/limits";
import { AiError, aiRequest, downloadText, errorText, validSources, type ContextInput, type Draft, type Prepared, type Purpose, type Source } from "./client";

export default function AiTools({ purpose, canGenerate, scope, contactId, compact = false, onUseDraft }: { purpose: Purpose; canGenerate: boolean; scope: string; contactId?: number; compact?: boolean; onUseDraft?: (text: string) => void }) {
  const id = useId(), busyRef = useRef(false), storageKey = `admin-ai-request-v1:${scope}:${purpose}:${contactId ?? "general"}`;
  const [query, setQuery] = useState("petição Amazônia"), [instructions, setInstructions] = useState("");
  const [audience, setAudience] = useState("Comunidade universitária"), [channel, setChannel] = useState("WhatsApp"), [objective, setObjective] = useState("Convidar para assinar a petição");
  const [contact, setContact] = useState(contactId ? String(contactId) : "");
  const [prepared, setPrepared] = useState<Prepared | null>(null), [preparedInput, setPreparedInput] = useState<ContextInput | null>(null), [sources, setSources] = useState<Source[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null), [draftSources, setDraftSources] = useState<Source[]>([]), [reviewed, setReviewed] = useState(false), [requestId, setRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { setQuery("petição Amazônia"); setInstructions(""); setPrepared(null); setPreparedInput(null); setSources([]); setDraft(null); setDraftSources([]); setReviewed(false); setRequestId(null); try { const stored = sessionStorage.getItem(storageKey); if (stored && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(stored)) setRequestId(stored); } catch { /* No request text is persisted in browser storage. */ } }, [storageKey]);
  const invalidate = () => { setPrepared(null); setPreparedInput(null); setSources([]); setReviewed(false); setNotice(null); };
  const input = (): ContextInput => {
    const extra = purpose === "divulgacao" ? [`Público: ${audience}.`, `Canal: ${channel}.`, `Objetivo: ${objective}.`, instructions].filter(Boolean).join("\n") : instructions;
    if (extra.length > AI_INSTRUCTIONS_MAX_LENGTH) throw new AiError("context_too_large");
    const value: ContextInput = { uso: purpose, consulta: query.trim(), ...(extra.trim() ? { instrucoes: extra } : {}) };
    if (purpose === "atendimento") { const selected = contactId ?? Number(contact); if (!Number.isSafeInteger(selected) || selected <= 0) throw new AiError("parameters"); value.contato = selected; }
    return value;
  };
  const action = async (run: () => Promise<void>) => {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(null); setNotice(null);
    try { await run(); } catch (failure) { setError(errorText(failure)); } finally { busyRef.current = false; setBusy(false); }
  };
  const prepare = () => action(async () => {
    setPrepared(null); setPreparedInput(null);
    const selected = input(), result = await aiRequest("/api/admin/ia/contexto", { modo: "preparar", input: selected });
    if (!/^[a-f0-9]{64}$/.test(result.proof) || !validSources(result.sources) || typeof result.executionAvailable !== "boolean" || typeof result.requestedEnabled !== "boolean") throw new AiError("unavailable");
    const documents: Source[] = [];
    for (const ref of result.sources) {
      const found = await aiRequest("/api/admin/conhecimento", { uso: purpose, fonte: ref.id, versao: ref.version });
      if (found.document?.id !== ref.id || found.document?.source?.version !== ref.version || typeof found.document.title !== "string" || typeof found.document.text !== "string") throw new AiError("source_stale");
      documents.push(found.document);
    }
    setSources(documents); setPrepared(result); setPreparedInput(selected);
    setNotice(result.executionAvailable ? "Contexto preparado. Confira as fontes antes de gerar." : "Contexto preparado. A geração está desabilitada neste ambiente; as fontes podem ser consultadas.");
  });
  const generate = () => action(async () => {
    if (!canGenerate || !prepared?.executionAvailable || !preparedInput || requestId) return;
    const selectedId = crypto.randomUUID(); setRequestId(selectedId); try { sessionStorage.setItem(storageKey, selectedId); } catch { /* In-memory identity still prevents repetition in this component. */ }
    let result;
    try { result = await aiRequest("/api/admin/ia/gerar", { input: preparedInput, proof: prepared.proof, requestId: selectedId }, 60_000); }
    catch (failure) { if (failure instanceof AiError) throw failure; throw new AiError("result_uncertain"); }
    if (result.persisted !== false || result.sent !== false || result.requiresHumanReview !== true || typeof result.draft?.text !== "string" || !result.draft.text.trim() || result.draft.text.length > 12000 || !validSources(result.draft.citations) || result.draft.citations.some((ref: { id: string; version: string }) => !prepared.sources.some(source => source.id === ref.id && source.version === ref.version))) throw new AiError("result_uncertain");
    setDraft(result.draft); setDraftSources(sources); setReviewed(false); setNotice("Minuta gerada para revisão. Nada foi enviado ou publicado. Baixe ou copie o texto antes de sair desta tela.");
  });
  const check = () => action(async () => {
    if (!requestId) return; const result = await aiRequest(`/api/admin/ia/gerar?requestId=${encodeURIComponent(requestId)}`);
    const states: Record<string, string> = { reserved: "A tentativa está reservada; o resultado não foi confirmado.", uncertain: "O resultado da tentativa permanece incerto. Ela não será repetida automaticamente.", completed: "A tentativa foi concluída. O texto não é recuperável pelo histórico; ele só foi devolvido à tela que fez o pedido.", rejected: "O provedor recusou a tentativa.", discarded: "A resposta foi descartada na validação." };
    setNotice(states[result.request?.state] ?? "Confira a situação da tentativa antes de iniciar outra solicitação.");
  });
  return <section className={compact ? "" : "box"} data-testid={`ai-tools-${purpose}`} aria-busy={busy}>
    <div className="form" style={{ maxWidth: 900 }}>
      {purpose === "atendimento" && !contactId ? <label htmlFor={`${id}-contact`}>Número do contato<input id={`${id}-contact`} type="number" min={1} value={contact} disabled={busy} onChange={event => { setContact(event.target.value); invalidate(); }} /></label> : null}
      {purpose === "divulgacao" ? <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <label>Público<input value={audience} disabled={busy} maxLength={200} onChange={event => { setAudience(event.target.value); invalidate(); }} /></label>
        <label>Canal<select value={channel} disabled={busy} onChange={event => { setChannel(event.target.value); invalidate(); }}>{["WhatsApp", "E-mail", "Rede social", "Cartaz"].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Objetivo<input value={objective} disabled={busy} maxLength={200} onChange={event => { setObjective(event.target.value); invalidate(); }} /></label>
      </div> : null}
      <label htmlFor={`${id}-query`}>Tema para buscar fontes<input id={`${id}-query`} value={query} disabled={busy} maxLength={240} onChange={event => { setQuery(event.target.value); invalidate(); }} /></label>
      <label htmlFor={`${id}-instructions`}>{purpose === "painel" ? "Sua pergunta ou pedido" : "Orientações para a minuta"}<textarea id={`${id}-instructions`} value={instructions} disabled={busy} maxLength={AI_INSTRUCTIONS_MAX_LENGTH} rows={compact ? 4 : 6} onChange={event => { setInstructions(event.target.value); invalidate(); }} /></label>
      <p className="small">Não inclua dados pessoais, senhas ou códigos. As respostas usam as fontes exibidas e precisam de revisão humana.</p>
      <p><button type="button" className="adm-btn" disabled={busy} onClick={prepare}>Buscar fontes e preparar</button>{canGenerate ? <> <button type="button" className="adm-btn pri" disabled={busy || !prepared?.executionAvailable || !!requestId} onClick={generate}>Gerar minuta</button></> : null}</p>
      {requestId ? <p><button type="button" className="adm-btn" disabled={busy} onClick={check}>Conferir tentativa</button>{" "}<button type="button" className="adm-btn" disabled={busy} onClick={() => { setRequestId(null); try { sessionStorage.removeItem(storageKey); } catch {} setNotice("Nova solicitação liberada. A próxima geração poderá consumir nova cota."); }}>Nova solicitação</button></p> : null}
    </div>
    {error ? <p className="err" role="alert">{error}</p> : null}{notice ? <p className="box" role="status">{notice}</p> : null}
    {sources.length ? <details><summary>Fontes do contexto ({sources.length})</summary>{sources.map(source => <article key={source.id} className="box"><h3>{source.title}</h3><p style={{ whiteSpace: "pre-wrap" }}>{source.text}</p><p className="small">Origem: {source.source.ref}<br />Versão: <code style={{ overflowWrap: "anywhere" }}>{source.source.version}</code></p></article>)}</details> : null}
    {draft ? <div className="form" style={{ maxWidth: 900 }}><label>Minuta editável<textarea rows={compact ? 7 : 12} maxLength={12000} value={draft.text} onChange={event => { setDraft({ ...draft, text: event.target.value }); setReviewed(false); }} /></label><details><summary>Fontes citadas nesta minuta</summary>{draft.citations.map(citation => <p key={citation.id}>{draftSources.find(source => source.id === citation.id)?.title ?? citation.id}<br /><code style={{ overflowWrap: "anywhere" }}>{citation.version}</code></p>)}</details><label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> Revisei o conteúdo e as fontes</label><p><button type="button" className="adm-btn" disabled={!reviewed || !draft.text.trim()} onClick={() => downloadText(draft.text, `minuta-${purpose}.txt`)}>Baixar texto</button>{onUseDraft ? <> <button type="button" className="adm-btn pri" disabled={!reviewed || !draft.text.trim()} onClick={() => onUseDraft(draft.text)}>Usar no rascunho</button></> : null}</p></div> : null}
  </section>;
}
