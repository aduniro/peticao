import { randomUUID } from "node:crypto";
import type { Batch } from "@/lib/batches";
import { batchWritableHere, LEGACY_BATCH_NOTICE } from "@/lib/batches";
import { batchSignatureLabel, batchStatusLabel, hasSignedBatchPdf, batchCountLabel } from "@/lib/admin-lotes-view";
import { config } from "@/lib/config";
import A1Assinatura from "./A1Assinatura";
import HistoricoDocumento from "./HistoricoDocumento";

export default function LoteAcoes({ batch, actorScope }: { batch: Batch; actorScope: string }) {
  const writable = batchWritableHere(batch), actionable = writable && (batch.status === "prepared" || batch.status === "failed");
  return <section id="lote-acoes" className="v2-lotes-painel" aria-labelledby="lote-acoes-titulo" tabIndex={-1} data-batch-id={batch.id}>
    <div className="v2-lotes-painel-topo"><div><p className="small">Lote selecionado</p><h2 id="lote-acoes-titulo">Ações do lote #{batch.seq}</h2></div><a className="v2-btn v2-btn-sec" href="/admin/lotes#lotes-lista">Fechar ações</a></div>
    <p><strong>{batch.kind === "final" ? "Final" : "Parcial"}</strong> · {batchStatusLabel(batch.status)} · {batchSignatureLabel(batch.signature_kind)}</p>
    <p>Servidores: {batchCountLabel(batch.n_servidor)} · Apoiadores: {batchCountLabel(batch.n_apoiador)} · Estrangeiros: {batchCountLabel(batch.n_estrangeiro)}</p>
    {batch.signed_note && <p className="small">{batch.signed_note}</p>}
    <div className="v2-lotes-links"><a className="v2-btn v2-btn-sec" href={`/api/admin/lotes/${batch.id}/pdf`}>PDF original do lote #{batch.seq}</a>{hasSignedBatchPdf(batch) && <a className="v2-btn v2-btn-sec" href={`/api/admin/lotes/${batch.id}/pdf?assinado=1`}>PDF assinado</a>}{writable && <HistoricoDocumento key={batch.id} batchId={batch.id} />}</div>
    {!writable && <p className="v2-aviso" role="status">{LEGACY_BATCH_NOTICE} <a href={`${config.appUrl()}/admin/lotes`}>Abrir painel legado</a></p>}
    {actionable && <>
      <div className="v2-lotes-acao"><h3>Assinatura A1</h3><A1Assinatura key={batch.id} actorScope={actorScope} documentRevision={batch.pdf_sha256} batchId={batch.id} /></div>
      <form className="v2-lotes-acao" method="post" action={`/api/admin/lotes/${batch.id}/assinado`} encType="multipart/form-data">
        <h3>Enviar PDF assinado</h3><label htmlFor="lote-pdf-assinado">PDF original do lote #{batch.seq}, após a assinatura</label><input id="lote-pdf-assinado" type="file" name="file" accept="application/pdf" required /><button>Enviar PDF assinado</button>
      </form>
      <div className="v2-lotes-acao"><h3>Aprovação e envio</h3>{process.env.BATCH_PACKAGE_ENABLED === "1" ? <a className="v2-btn v2-btn-sec" href={`/admin/presidente?lote=${batch.id}`}>Presidente da ADUNIR</a> : <>
        <form method="post" action={`/api/admin/lotes/${batch.id}/codigo`}><input type="hidden" name="requestId" value={randomUUID()} /><button>Enviar código ao aprovador</button></form>
        <form method="post" action={`/api/admin/lotes/${batch.id}/aprovar`}><label htmlFor="lote-codigo-aprovacao">Código do aprovador</label><div className="v2-lotes-codigo"><input id="lote-codigo-aprovacao" name="code" inputMode="numeric" maxLength={6} placeholder="Código de 6 dígitos" size={7} required /><button>Aprovar e enviar</button></div></form>
      </>}</div>
      <div className="v2-lotes-acao"><h3>Cancelar este lote</h3><form method="post" action={`/api/admin/lotes/${batch.id}/cancelar`}><button>Cancelar lote #{batch.seq}</button></form></div>
    </>}
  </section>;
}
