"use client";
import type { MaterialsState } from "@/lib/materials-client";
import { MATERIAL_CLIENT_ASSETS, MATERIAL_CLIENT_TEMPLATES, parseMaterialsContent } from "@/lib/materials-client";
import type { MaterialUiDraft } from "@/lib/materials-ui";
import { materialUiBusy, materialUiDirty } from "@/lib/materials-ui";
import { MATERIALS_UI_DRAFT_COPY as C } from "@/lib/materials-ui-copy";
export type MateriaisFormularioProps = {
  value: MaterialUiDraft; state: MaterialsState | null; canWrite: boolean;
  onChange: (value: MaterialUiDraft) => void; onSave: (operation: "create" | "revise" | "archive") => void;
  onRecover: () => void; onReadHistory: () => void; onReview: () => void; onDiscard: () => void;
};
const templates = { "poster-a4-v1": "Cartaz A4", "flyer-mono-cut-v1": "Panfleto em preto e branco", "social-square-v1": "Imagem quadrada" };
const assets = { adunir: "ADUNIR", "adunir-andes": "ADUNIR e ANDES-SN", andes: "ANDES-SN" };
// MUDAR AQUI — RASCUNHO: os rótulos de modelos/identidades acima também aguardam aprovação.
export default function MateriaisFormulario(p: MateriaisFormularioProps) {
  const busy = materialUiBusy(p.state), blocked = busy || !p.canWrite || !!p.state?.head?.archived || !!p.state?.context.materialId && !p.state.head;
  const invalid = !parseMaterialsContent(p.value), pending = !!p.state?.pending, review = !!p.state?.needsReview;
  const disabledSave = blocked || pending || review || invalid;
  const field = (name: keyof MaterialUiDraft, value: string) => p.onChange({ ...p.value, [name]: value });
  return <section className="v2-secao" aria-busy={busy} aria-label={C.selected}>
    {!p.canWrite && <p>{C.readOnly}</p>}
    <fieldset disabled={blocked}>
      <label>{C.template}<select value={p.value.template} onChange={e => field("template", e.target.value)}>{MATERIAL_CLIENT_TEMPLATES.map(v => <option key={v} value={v}>{templates[v]}</option>)}</select></label>
      <label>{C.asset}<select value={p.value.assetKey} onChange={e => field("assetKey", e.target.value)}>{MATERIAL_CLIENT_ASSETS.map(v => <option key={v} value={v}>{assets[v]}</option>)}</select></label>
      <label>{C.titleField}<input value={p.value.title} onChange={e => field("title", e.target.value)} /></label>
      <label>{C.body}<textarea value={p.value.body} onChange={e => field("body", e.target.value)} /></label>
      <label>{C.callToAction}<input value={p.value.callToAction} onChange={e => field("callToAction", e.target.value)} /></label>
      <label>{C.footer}<textarea value={p.value.footer} onChange={e => field("footer", e.target.value)} /></label>
    </fieldset>
    {p.canWrite && <div className="fim">
      <button type="button" className="adm-btn" disabled={disabledSave} onClick={() => p.onSave(p.state?.context.materialId ? "revise" : "create")}>{p.state?.context.materialId ? C.revise : C.create}</button>
      <button type="button" className="adm-btn" disabled={blocked || pending || review || !p.state?.head || materialUiDirty(p.value, p.state)} onClick={() => p.onSave("archive")}>{C.archive}</button>
      <button type="button" className="adm-btn" disabled={busy || pending} onClick={p.onDiscard}>{C.discard}</button>
    </div>}
    {p.canWrite && invalid && <p className="small">{C.invalid}</p>}
    {pending && <p role="status" className="v2-aviso">{C.pending}</p>}
    {pending && <button type="button" className="adm-btn" disabled={busy} onClick={p.onRecover}>{C.recover}</button>}
    {review && <div className="v2-aviso"><p>{p.state?.phase === "confirmed" ? C.confirmedReview : C.conflict}</p><div className="fim">
      {p.state?.context.materialId && <button type="button" className="adm-btn" disabled={busy || p.state.loadingHistory} onClick={p.onReadHistory}>{C.history}</button>}
      <button type="button" className="adm-btn" disabled={busy || p.state?.phase === "uncertain"} onClick={p.onReview}>{C.review}</button>
    </div></div>}
    <p className="small">{C.transient}</p>
  </section>;
}
