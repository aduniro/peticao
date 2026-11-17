"use client";
import { useEffect, useRef, useState } from "react";
import type { MaterialVersion } from "@/lib/materials-contract";
import { parseMaterialsContent, type MaterialsLibraryPage, type MaterialsState } from "@/lib/materials-client";
import { nivelOk, type Nivel } from "@/lib/admin-levels";
import { createMaterialUiSession, emptyMaterialUiDraft, materialUiBusy, materialUiCanSwitch, materialUiDirty, materialUiIntent, type MaterialUiDraft, type MaterialUiSession } from "@/lib/materials-ui";
import { MATERIALS_UI_DRAFT_COPY as C } from "@/lib/materials-ui-copy";
import MateriaisFormulario from "./MateriaisFormulario";
import MateriaisHistorico from "./MateriaisHistorico";
import MateriaisPrevia from "./MateriaisPrevia";
export type MateriaisBibliotecaProps = { actorId: number; actorScope: string; nivel: Nivel };
/** Session-scoped library; the server page controls availability and each API rechecks authority. */
export default function MateriaisBiblioteca(p: MateriaisBibliotecaProps) {
  return <Biblioteca key={`${p.actorId}:${p.actorScope}:${p.nivel}`} {...p} />;
}
function Biblioteca({ actorId, actorScope, nivel }: MateriaisBibliotecaProps) {
  const session = useRef<MaterialUiSession | null>(null);
  const [state, setState] = useState<MaterialsState | null>(null), [draft, setDraft] = useState<MaterialUiDraft>(emptyMaterialUiDraft);
  const [library, setLibrary] = useState<MaterialsLibraryPage | null>(null), [archived, setArchived] = useState(false);
  const [cursors, setCursors] = useState<(string | null)[]>([null]), [preview, setPreview] = useState<MaterialVersion | null>(null), [message, setMessage] = useState("");
  const canRead = nivelOk(nivel, "leitura"), canWrite = nivelOk(nivel, "edicao"), busy = materialUiBusy(state);
  useEffect(() => {
    let owned: MaterialUiSession;
    if (!nivelOk(nivel, "leitura")) return;
    try { owned = createMaterialUiSession({ actorId, actorScope, materialId: null }, setState); } catch { setMessage(C.error); return; }
    session.current = owned; owned.refresh();
    return () => { owned.dispose(); if (session.current === owned) session.current = null; };
  }, [actorId, actorScope, nivel]);
  useEffect(() => {
    if (!state?.pending && !materialUiDirty(draft, state)) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent);
  }, [draft, state]);
  async function loadLibrary(before: string | null = null, nextCursors: (string | null)[] = [null], filter = archived) {
    const owned = session.current; if (!owned || !canRead) return;
    setMessage(""); const result = await owned.run(c => c.loadLibrary(filter, before));
    if (result?.ok) { setLibrary(result.value); setCursors(nextCursors); setArchived(filter); }
  }
  async function readHistory(before: number | null = null) {
    const owned = session.current; if (!owned) return;
    setMessage(""); await owned.run(c => c.loadHistory(before));
  }
  async function select(materialId: string | null) {
    const owned = session.current; if (!owned) return;
    if (!materialUiCanSwitch(draft, owned.client.getState())) { setMessage(C.switchBlocked); return; }
    if (materialId === null ? !owned.newDraft() : !owned.setContext({ actorId, actorScope, materialId })) return;
    setDraft(emptyMaterialUiDraft()); setPreview(null); setMessage("");
    if (materialId) {
      const result = await owned.run(c => c.loadHistory());
      if (result?.ok) setDraft({ ...result.value.current.content });
    }
  }
  function change(next: MaterialUiDraft) {
    setDraft(next); const owned = session.current; if (!owned) return;
    if (parseMaterialsContent(next)) owned.client.setDraft(next); owned.refresh();
  }
  async function save(operation: "create" | "revise" | "archive") {
    const owned = session.current; if (!owned || !canWrite || materialUiBusy(owned.client.getState()) || owned.client.getState().pending) return;
    const content = parseMaterialsContent(draft); if (content) owned.client.setDraft(content);
    const intent = materialUiIntent(operation, crypto.randomUUID(), owned.client.getState(), draft);
    if (!intent) { setMessage(C.invalid); return; }
    setMessage(""); await owned.run(c => c.save(intent));
  }
  async function recover() { const owned = session.current; if (owned) { setMessage(""); await owned.run(c => c.recoverPending()); } }
  function review() {
    const owned = session.current; if (!owned) return;
    if (!owned.client.reviewHead()) setMessage(C.rejectedReview); else setMessage(""); owned.refresh();
  }
  function discard() {
    const owned = session.current; if (!owned || owned.client.getState().pending || materialUiBusy(owned.client.getState())) return;
    if (owned.client.getState().context.materialId === null) { owned.newDraft(); setDraft(emptyMaterialUiDraft()); setPreview(null); setMessage(""); return; }
    const value = owned.client.getState().head?.content ?? emptyMaterialUiDraft(); setDraft({ ...value });
    if (parseMaterialsContent(value)) owned.client.setDraft(value); owned.refresh(); setMessage("");
  }
  if (!canRead) return null;
  return <section className="v2-pagina" aria-label={C.title}>
    <h1>{C.title}</h1><p className="v2-aviso">{C.draftNotice}</p>
    <section className="v2-secao" aria-label={C.library} aria-busy={state?.loadingLibrary ?? false}>
      <h2>{C.library}</h2><div className="fim">
        <label><input type="checkbox" checked={archived} disabled={state?.loadingLibrary || !state} onChange={e => { void loadLibrary(null, [null], e.target.checked); }} />{C.archived}</label>
        <button type="button" className="adm-btn" disabled={!state || state.loadingLibrary} onClick={() => void loadLibrary()}>{C.consult}</button>
        {canWrite && <button type="button" className="adm-btn" disabled={!materialUiCanSwitch(draft, state)} onClick={() => void select(null)}>{C.new}</button>}
      </div>
      <div className="table-scroll"><table><thead><tr><th>{C.titleField}</th><th>{C.revision}</th><th>{C.select}</th></tr></thead><tbody>
        {library?.versions.map(v => <tr key={v.materialId}><td>{v.content.title}</td><td>{v.revision}</td><td><button type="button" className="adm-btn" disabled={!materialUiCanSwitch(draft, state)} aria-pressed={state?.context.materialId === v.materialId} onClick={() => void select(v.materialId)}>{C.select}</button></td></tr>)}
        {library?.versions.length === 0 && <tr><td colSpan={3}>{C.empty}</td></tr>}
      </tbody></table></div>
      <div className="fim">
        {cursors.length > 1 && <button type="button" className="adm-btn" disabled={state?.loadingLibrary} onClick={() => { const previous = cursors.slice(0, -1); void loadLibrary(previous.at(-1) ?? null, previous); }}>{C.previous}</button>}
        {library?.nextBefore && <button type="button" className="adm-btn" disabled={state?.loadingLibrary} onClick={() => void loadLibrary(library.nextBefore, [...cursors, library.nextBefore])}>{C.next}</button>}
      </div>
    </section>
    {message && <p role="status" className="v2-aviso">{message}</p>}
    {(state?.error || state?.libraryError || state?.historyError) && <p role="status" className="v2-aviso">{C.error}</p>}
    {state?.receipt && <section className="v2-secao" aria-label={C.saved}><p>{C.saved}: {C.revision} {state.receipt.version.revision}</p><p className="small">{C.receiptNote}</p>
      <button type="button" className="adm-btn" disabled={!materialUiCanSwitch(draft, state)} onClick={() => void select(state.receipt!.version.materialId)}>{C.openReceipt}</button></section>}
    <MateriaisFormulario value={draft} state={state} canWrite={canWrite} onChange={change} onSave={operation => void save(operation)} onRecover={() => void recover()} onReadHistory={() => void readHistory()} onReview={review} onDiscard={discard} />
    {state?.context.materialId && <MateriaisHistorico history={state.history} loading={state.loadingHistory || busy} selected={preview?.id ?? null} onConsult={() => void readHistory()} onMore={before => void readHistory(before)} onPreview={setPreview} />}
    <MateriaisPrevia version={preview} />
  </section>;
}
