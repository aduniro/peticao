import { sessaoAdmin } from "@/lib/admin";
import { nivelOk, stepupValido } from "@/lib/admin-users";
import { presidentDocuments, documentActions } from "@/lib/president-document";
import { inspectBatchAcceptance } from "@/lib/batch-reconciliation";
import { batchId } from "@/lib/batch-http-input";
import { config } from "@/lib/config";
import { brasilia } from "@/lib/time";
import { redirect, notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Presidente da ADUNIR", robots: { index: false } };

const STATUS: Record<string, string> = { preparing: "PDF pendente", prepared: "PDF pronto", failed: "Conferência necessária", sent: "Aceite registrado", cancelled: "Cancelado" };
const RECEIPT: Record<string, string> = { accepted: "Aceito pelo transporte", rejected: "Rejeitado", indeterminate: "Resultado incerto", sending: "Tentativa em andamento", prepared: "Preparado", queued: "Na fila", unavailable: "Sem comprovante" };

export default async function Presidente({ searchParams }: { searchParams: { lote?: string; antes?: string; msg?: string } }) {
  const actor = await sessaoAdmin(); if (!actor) redirect("/admin");
  if (!nivelOk(actor.nivel, "total")) redirect("/admin?erro=nivel");
  if (!stepupValido(actor)) redirect("/admin/confirmar?volta=/admin/presidente");
  const selectedId = searchParams.lote === undefined ? null : batchId(searchParams.lote);
  const before = searchParams.antes === undefined ? null : batchId(searchParams.antes);
  if (searchParams.lote !== undefined && selectedId === null) notFound();
  if (searchParams.antes !== undefined && before === null) notFound();
  const result = await presidentDocuments(actor, { ...(selectedId === null ? {} : { id: selectedId }), ...(before === null ? {} : { before }) });
  if (!result.ok) { if (result.error === "parameters") notFound(); redirect("/admin?erro=nivel"); }
  const document = result.selected;
  if (selectedId !== null && !document) notFound();
  const actions = document && documentActions(document);
  let inspected: Awaited<ReturnType<typeof inspectBatchAcceptance>> | null = null;
  if (document?.approved_at) { try { inspected = await inspectBatchAcceptance(document.id, actor); } catch { /* Unavailable evidence must not enable approval. */ } }
  if (inspected && !inspected.ok && inspected.error === "forbidden") redirect("/admin?erro=nivel");
  const proof = inspected?.ok ? inspected : null;
  const retrySafe = proof && proof.recipients.some(r => r.state !== "accepted") && proof.recipients.every(r => ["accepted", "rejected", "prepared", "unavailable"].includes(r.state));
  const canApprove = !!(document && actions?.approval && (!document.approved_at || retrySafe));
  return <main className="v2-pagina"><div className="v2-secao">
    <h1>Presidente da ADUNIR</h1>
    <p>Documento final e lotes para revisão, assinatura e aprovação.</p>
    <p><a className="v2-btn v2-btn-sec" href="/admin/lotes">Lotes e envios</a></p>
    {searchParams.msg && <p className="box" role="status">{searchParams.msg}</p>}
    <p>Aprovador: {config.approverEmail() || <em>não configurado</em>}</p>
    <form method="post" action="/api/admin/lotes/criar?portal=presidente"><button disabled={result.finalId !== null}>Fechar lote final agora</button></form>
    {document && actions ? <>
      <h2>Lote {document.seq} · {document.kind === "final" ? "final" : "parcial"}</h2>
      <h3>1. Documento</h3>
      <dl style={{ overflowWrap: "anywhere" }}>
        <dt>Status</dt><dd>{STATUS[document.status] ?? document.status}</dd>
        <dt>Assinatura</dt><dd>{document.signature_kind === "icp-brasil" ? "ICP-Brasil" : document.signature_kind === "externa-nao-validada" ? "Assinado, NÃO validado" : "NÃO ASSINADO (teste)"}{document.signed_note && <p className="small">{document.signed_note}</p>}</dd>
        <dt>Servidores</dt><dd>{document.n_servidor}</dd><dt>Apoiadores</dt><dd>{document.n_apoiador}</dd><dt>Estrangeiros</dt><dd>{document.n_estrangeiro}</dd>
        <dt>Lista sha256</dt><dd style={{ overflowWrap: "anywhere" }}><code>{document.list_hash}</code></dd>
        <dt>sha256 do PDF</dt><dd style={{ overflowWrap: "anywhere" }}><code>{document.pdf_sha256 ?? "—"}</code></dd>
        {document.signed_pdf_sha256 && <><dt>sha256 do PDF assinado</dt><dd style={{ overflowWrap: "anywhere" }}><code>{document.signed_pdf_sha256}</code></dd></>}
        <dt>Criado</dt><dd>{brasilia(document.created_at)}</dd>
        {document.approved_at && <><dt>Aprovador</dt><dd>{document.approved_by} · {brasilia(document.approved_at)}</dd></>}
        {document.sent_at && <><dt>Envios</dt><dd>{brasilia(document.sent_at)}</dd></>}
      </dl>
      <p>{document.has_pdf && <a className="v2-btn v2-btn-sec" href={`/api/admin/lotes/${document.id}/pdf`}>Baixar PDF original</a>} {document.has_signed_pdf && <a className="v2-btn v2-btn-sec" href={`/api/admin/lotes/${document.id}/pdf?assinado=1`}>Baixar PDF assinado</a>}</p>
      {document.has_pdf ? <details><summary>Prévia do PDF das assinaturas</summary><iframe title={`PDF do lote ${document.seq}`} src={`/api/admin/lotes/${document.id}/pdf?previa=1`} style={{ width: "100%", height: "65vh", minHeight: 360, border: "1px solid var(--adm-line)" }} loading="lazy" /></details> : <p>PDF não disponível neste lote.</p>}
      <h3>2. Assinatura</h3>
      <div className="box"><strong>Upload de PDF assinado</strong><p>O upload confere o arquivo e registra o resultado. Ele não envia o lote.</p><p>Validador ICP-Brasil: {process.env.ICP_VALIDATOR_URL ? "configurado" : "não configurado"}.</p></div>
      {actions.upload && <form method="post" action={`/api/admin/lotes/${document.id}/assinado?portal=presidente`} encType="multipart/form-data"><input type="file" name="file" accept="application/pdf" aria-label="PDF assinado" required /><button>Enviar PDF assinado</button></form>}
      <p><button type="button" disabled>Assinatura própria do app</button> <button type="button" disabled>gov.br</button></p>
      <p className="small">Esses dois métodos não estão ativos neste candidato. A aprovação por código não altera a validação da assinatura.</p>
      <h3>3. Aprovação e resultado</h3>
      <p>O código é solicitado para o e-mail do aprovador configurado. A autoria das ações é registrada pela conta conectada.</p>
      {document.status !== "sent" && document.status !== "cancelled" && <>
        <form method="post" action={`/api/admin/lotes/${document.id}/codigo?portal=presidente`}><button disabled={!canApprove}>Enviar código ao aprovador</button></form>
        <form method="post" action={`/api/admin/lotes/${document.id}/aprovar?portal=presidente`}><input name="code" aria-label="Código" inputMode="numeric" maxLength={6} placeholder="código" size={7} required disabled={!canApprove} /><button disabled={!canApprove}>Aprovar e enviar</button></form>
      </>}
      {document.signature_kind !== "icp-brasil" && <p className="small">O envio depende de um PDF com validação ICP-Brasil concluída.</p>}
      {document.approved_at && <section aria-label="Comprovantes do lote"><h4>Comprovantes</h4>
        {proof ? <>
          <div className="table-scroll"><table><thead><tr><th>Destinatário</th><th>Resultado</th><th>Primeiro aceite</th></tr></thead><tbody>{proof.recipients.map(r => <tr key={r.recipient}><td>{r.recipient}</td><td>{RECEIPT[r.state] ?? r.state}</td><td>{r.acceptedAt ? brasilia(r.acceptedAt) : "—"}</td></tr>)}</tbody></table></div>
          {proof.recipients.some(r => r.state === "accepted") && <form method="post" action={`/api/admin/lotes/${document.id}/conciliar?portal=presidente`}><input type="hidden" name="proof" value={proof.proof} /><button>Conferir aceites sem reenviar</button></form>}
          <p className="small">Aceite do transporte não comprova entrega. Resultado incerto continua bloqueado para reenvio.</p>
        </> : <p className="box">Não há comprovante compatível disponível para conferência. Nenhum envio é liberado por esta tela.</p>}
      </section>}
      {actions.cancel && <form method="post" action={`/api/admin/lotes/${document.id}/cancelar?portal=presidente`}><button>Cancelar</button></form>}
      <p className="small">Fluxo: baixe o PDF do lote, assine com o e-CNPJ da ADUNIR (Adobe, LibreOffice ou Assinador do ITI) e envie o PDF assinado. O site confere a estrutura da assinatura; a validação da cadeia ICP-Brasil usa um validador configurável (ICP_VALIDATOR_URL). Em produção, só lote validado como ICP-Brasil pode ser enviado.</p>
    </> : <p>Nenhum lote ainda.</p>}
    {result.documents.length > 0 && <><h2>Documentos</h2><div className="table-scroll"><table><thead><tr><th>#</th><th>Tipo</th><th>Status</th><th>Ações</th></tr></thead><tbody>{result.documents.map(d => <tr key={d.id}><td>{d.seq}</td><td>{d.kind === "final" ? "final" : "parcial"}</td><td>{STATUS[d.status] ?? d.status}</td><td><a href={`/admin/presidente?lote=${d.id}`}>Abrir documento</a></td></tr>)}</tbody></table></div></>}
    <p>{before !== null && <a className="v2-btn v2-btn-sec" href="/admin/presidente">Mais recentes</a>} {result.nextBefore !== null && <a className="v2-btn v2-btn-sec" href={`/admin/presidente?antes=${result.nextBefore}`}>Mais antigos</a>}</p>
  </div></main>;
}
