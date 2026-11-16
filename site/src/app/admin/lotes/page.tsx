import LoteAcoes from "@/components/admin/LoteAcoes";
import LotesLista from "@/components/admin/LotesLista";
import { sessaoAdmin } from "@/lib/admin";
import { nivelOk, stepupValido } from "@/lib/admin-users";
import { listBatches } from "@/lib/batches";
import { selectedBatch } from "@/lib/admin-lotes-view";
import { batchSendingControl } from "@/lib/batch-sending-control";
import { config } from "@/lib/config";
import { redirect } from "next/navigation";
import { brasilia } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lotes", robots: { index: false } };

export default async function Lotes({ searchParams }: { searchParams: { msg?: string; lote?: string | string[] } }) {
  const sessao = await sessaoAdmin();
  if (!sessao) redirect("/admin");
  if (!nivelOk(sessao.nivel, "total")) redirect("/admin?erro=nivel");
  if (!stepupValido(sessao)) redirect("/admin/confirmar?volta=/admin/lotes");
  const batches = await listBatches(), selected = selectedBatch(batches, searchParams.lote);
  const control = await batchSendingControl(sessao), enabled = control.enabled;
  return <main className="v2-pagina v2-lotes"><div className="v2-secao">
    <h1>Lotes</h1>
    <p><a className="v2-btn v2-btn-sec" href="/admin/presidente">Presidente da ADUNIR</a></p>
    {searchParams.msg && <p className="box v2-lotes-feedback" role="status">{searchParams.msg}</p>}
    <p>Meta por lote: {config.batchSize()} · Fechamento final: {brasilia(config.finalAt())} (horário de Brasília) · Aprovador: {config.approverEmail() || <em>não configurado</em>} · Destinatários: {config.recipients().length}</p>
    <div className="box v2-lotes-previa"><strong>Prévia do PDF das assinaturas</strong> (abre no navegador; não cria lote nem envia nada):{" "}
      <a href="/api/admin/pdf-previa?tipo=modelo" target="_blank" rel="noopener">Modelo com dados fictícios</a> ·{" "}
      <a href="/api/admin/pdf-previa?tipo=real" target="_blank" rel="noopener">Documento real com as assinaturas confirmadas até agora</a>
    </div>
    <div className="v2-lotes-globais"><span>Envios: <strong>{enabled ? "ativos" : "PAUSADOS"}</strong></span>
      <form method="post" action="/api/admin/lotes/pausa"><input type="hidden" name="version" value={control.version} /><input type="hidden" name="enabled" value={String(!enabled)} /><button>{enabled ? "Pausar todos os envios" : "Retomar envios"}</button></form>
      <form method="post" action="/api/admin/lotes/criar"><button>Fechar lote final agora</button></form>
    </div>
    {searchParams.lote !== undefined && !selected && <p className="v2-aviso" role="alert">Esse lote não está disponível. Escolha um lote da lista.</p>}
    <LotesLista batches={batches} selectedId={selected?.id} />
    {selected ? <LoteAcoes key={selected.id} batch={selected} actorScope={`${sessao.userId}:${sessao.sessaoId}`} /> : batches.length > 0 && <p className="v2-aviso">Abra as ações de um lote para consultar o histórico, assinar e gerenciar o envio.</p>}
    <p className="small">No upload manual, envie o PDF original do lote (link “PDF”) após assiná-lo. Para aplicar A1 ao documento com confirmação própria, abra “Presidente da ADUNIR”.</p>
    <p className="small">Fluxo: baixe o PDF do lote, assine com o e-CNPJ da ADUNIR (Adobe, LibreOffice ou Assinador do ITI) e envie o PDF assinado. O site confere a estrutura da assinatura; a validação da cadeia ICP-Brasil usa um validador configurável. Em produção, só lote validado como ICP-Brasil pode ser enviado.</p>
  </div></main>;
}
