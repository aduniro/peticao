"use client";
import type { MaterialVersion } from "@/lib/materials-contract";
import type { MaterialsHistoryPage } from "@/lib/materials-client";
import { brasilia } from "@/lib/time";
import { MATERIALS_UI_DRAFT_COPY as C } from "@/lib/materials-ui-copy";
export type MateriaisHistoricoProps = { history: MaterialsHistoryPage | null; loading: boolean; selected: string | null; onConsult: () => void; onMore: (before: number) => void; onPreview: (version: MaterialVersion) => void };
export default function MateriaisHistorico(p: MateriaisHistoricoProps) {
  return <section className="v2-secao" aria-label={C.history} aria-busy={p.loading}>
    <h2>{C.history}</h2><button type="button" className="adm-btn" disabled={p.loading} onClick={p.onConsult}>{C.consult}</button>
    {p.history && <><p>{C.current}: {p.history.current.revision}</p><div className="table-scroll"><table><thead><tr><th>{C.revision}</th><th>{C.titleField}</th><th>{C.author}</th><th>{C.date}</th><th>{C.hash}</th><th>{C.preview}</th></tr></thead>
      <tbody>{p.history.versions.map(v => <tr key={v.id}><td>{v.revision}{v.archived ? ` · ${C.archived}` : ""}</td><td>{v.content.title}</td><td>{v.authorId}</td><td><time dateTime={v.createdAt}>{brasilia(v.createdAt, true)}</time></td><td><code>{v.sha256}</code></td><td><button type="button" className="adm-btn" aria-pressed={p.selected === v.id} onClick={() => p.onPreview(v)}>{C.preview}</button></td></tr>)}</tbody>
    </table></div></>}
    {p.history?.nextBefore !== null && p.history?.nextBefore !== undefined && <button type="button" className="adm-btn" disabled={p.loading} onClick={() => p.onMore(p.history!.nextBefore!)}>{C.next}</button>}
  </section>;
}
