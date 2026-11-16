import type { Batch } from "@/lib/batches";
import { batchDetailsHref, batchSignatureLabel, batchStatusLabel, batchCountLabel } from "@/lib/admin-lotes-view";
import { brasilia } from "@/lib/time";

function OpenBatch({ batch, selected }: { batch: Batch; selected: boolean }) {
  return <a className="v2-btn v2-btn-sec v2-lotes-abrir" href={batchDetailsHref(batch.id)} aria-current={selected ? "true" : undefined} aria-label={`Abrir ações do lote ${batch.seq}`}>{selected ? "Lote selecionado" : "Abrir ações"}</a>;
}

export default function LotesLista({ batches, selectedId }: { batches: readonly Batch[]; selectedId?: number }) {
  return <section id="lotes-lista" className="v2-lotes-lista" aria-labelledby="lotes-lista-titulo" tabIndex={-1}>
    <h2 id="lotes-lista-titulo">Lotes disponíveis</h2>
    <p className="small">Selecione um lote para abrir suas ações. Os documentos continuam disponíveis pelo link PDF.</p>
    {batches.length === 0 ? <p className="box" role="status">Nenhum lote ainda.</p> : <>
      <div className="table-scroll v2-lotes-desktop"><table className="v2-lotes-tabela">
        <caption className="v2-lotes-so-leitor">Lotes e documentos da campanha. Abra as ações do lote desejado.</caption>
        <thead><tr><th scope="col">Lote</th><th scope="col">Tipo</th><th scope="col">Servidores</th><th scope="col">Apoiadores</th><th scope="col">Estrangeiros</th><th scope="col">Assinatura</th><th scope="col">Status</th><th scope="col">Ações</th></tr></thead>
        <tbody>{batches.map(batch => <tr key={batch.id} data-selected={batch.id === selectedId ? "true" : undefined}>
          <th scope="row">#{batch.seq}</th><td>{batch.kind === "final" ? "Final" : "Parcial"}</td>
          <td>{batchCountLabel(batch.n_servidor)}</td><td>{batchCountLabel(batch.n_apoiador)}</td><td>{batchCountLabel(batch.n_estrangeiro)}</td>
          <td>{batchSignatureLabel(batch.signature_kind)}</td><td><span className="v2-lotes-status" data-status={batch.status}>{batchStatusLabel(batch.status)}</span>{batch.sent_at && <div className="small">em {brasilia(batch.sent_at)}</div>}</td>
          <td><div className="v2-lotes-links"><OpenBatch batch={batch} selected={batch.id === selectedId} /><a href={`/api/admin/lotes/${batch.id}/pdf`} aria-label={`PDF original do lote ${batch.seq}`}>PDF</a></div></td>
        </tr>)}</tbody>
      </table></div>
      <ol className="v2-lotes-cartoes">{batches.map(batch => <li className="v2-lotes-cartao" key={batch.id} data-selected={batch.id === selectedId ? "true" : undefined}>
        <div className="v2-lotes-cartao-topo"><h3>Lote #{batch.seq}</h3><span className="v2-lotes-status" data-status={batch.status}>{batchStatusLabel(batch.status)}</span></div>
        <dl><div><dt>Tipo</dt><dd>{batch.kind === "final" ? "Final" : "Parcial"}</dd></div><div><dt>Assinatura</dt><dd>{batchSignatureLabel(batch.signature_kind)}</dd></div>
          <div><dt>Servidores</dt><dd>{batchCountLabel(batch.n_servidor)}</dd></div><div><dt>Apoiadores</dt><dd>{batchCountLabel(batch.n_apoiador)}</dd></div><div><dt>Estrangeiros</dt><dd>{batchCountLabel(batch.n_estrangeiro)}</dd></div>
          {batch.sent_at && <div><dt>Enviado em</dt><dd>{brasilia(batch.sent_at)}</dd></div>}
        </dl><div className="v2-lotes-links"><OpenBatch batch={batch} selected={batch.id === selectedId} /><a href={`/api/admin/lotes/${batch.id}/pdf`} aria-label={`PDF original do lote ${batch.seq}`}>PDF</a></div>
      </li>)}</ol>
    </>}
  </section>;
}
