import { sessaoAdmin } from "@/lib/admin";
import { nivelOk } from "@/lib/admin-users";
import { listBatches, sendingEnabled } from "@/lib/batches";
import { config } from "@/lib/config";
import { redirect } from "next/navigation";
import { brasilia } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lotes", robots: { index: false } };

export default async function Lotes({ searchParams }: { searchParams: { msg?: string } }) {
  const sessao = await sessaoAdmin();
  if (!sessao) redirect("/admin");
  if (!nivelOk(sessao.nivel, "total")) redirect("/admin?erro=nivel");
  const batches = await listBatches();
  const enabled = await sendingEnabled();
  return (
    <main>
      <p><a href="/admin">← Painel</a></p>
      <h1>Lotes</h1>
      {searchParams.msg && <p className="box ok" role="status">{searchParams.msg}</p>}
      <p>
        Meta por lote: {config.batchSize()} · Fechamento final: {brasilia(config.finalAt())} (horário de Brasília) ·
        Aprovador: {config.approverEmail() || <em>não configurado</em>} · Destinatários: {config.recipients().length}
      </p>
      <div className="box" style={{ margin: "12px 0" }}>
        <strong>Prévia do PDF das assinaturas</strong> (abre no navegador; não cria lote nem envia nada):{" "}
        <a href="/api/admin/pdf-previa?tipo=modelo" target="_blank" rel="noopener">Modelo com dados fictícios</a> ·{" "}
        <a href="/api/admin/pdf-previa?tipo=real" target="_blank" rel="noopener">Documento real com as assinaturas confirmadas até agora</a>
      </div>
      <div style={{ margin: "12px 0" }}>
        Envios: <strong>{enabled ? "ativos" : "PAUSADOS"}</strong>{" "}
        <form method="post" action="/api/admin/lotes/pausa" style={{ display: "inline" }}><button>{enabled ? "Pausar todos os envios" : "Retomar envios"}</button></form>{" "}
        <form method="post" action="/api/admin/lotes/criar" style={{ display: "inline" }}><button>Fechar lote final agora</button></form>
      </div>
      <div className="table-scroll"><table>
        <thead><tr><th>#</th><th>Tipo</th><th>Servidores</th><th>Apoiadores</th><th>Estrangeiros</th><th>Assinatura</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.id}>
              <td>{b.seq}</td><td>{b.kind === "final" ? "final" : "parcial"}</td><td>{b.n_servidor}</td><td>{b.n_apoiador}</td><td>{b.n_estrangeiro}</td>
              <td>{b.signature_kind === "icp-brasil" ? "ICP-Brasil" : b.signature_kind === "externa-nao-validada" ? "Assinado, NÃO validado" : "NÃO ASSINADO (teste)"}{b.signed_note ? <div className="small">{b.signed_note}</div> : null}</td>
              <td>{b.status}{b.sent_at ? ` em ${brasilia(b.sent_at)}` : ""}</td>
              <td>
                <a href={`/api/admin/lotes/${b.id}/pdf`}>PDF</a>{b.signature_kind && b.signature_kind !== "none" && b.signature_kind !== "" ? <> · <a href={`/api/admin/lotes/${b.id}/pdf?assinado=1`}>assinado</a></> : null}{" "}
                {(b.status === "prepared" || b.status === "failed") && (
                  <>
                    <form method="post" action={`/api/admin/lotes/${b.id}/assinado`} encType="multipart/form-data" style={{ display: "inline" }}><input type="file" name="file" accept="application/pdf" required /> <button>Enviar PDF assinado</button></form>
                    <form method="post" action={`/api/admin/lotes/${b.id}/codigo`} style={{ display: "inline" }}><button>Enviar código ao aprovador</button></form>
                    <form method="post" action={`/api/admin/lotes/${b.id}/aprovar`} style={{ display: "inline" }}>
                      <input name="code" inputMode="numeric" maxLength={6} placeholder="código" size={7} required /> <button>Aprovar e enviar</button>
                    </form>
                    <form method="post" action={`/api/admin/lotes/${b.id}/cancelar`} style={{ display: "inline" }}><button>Cancelar</button></form>
                  </>
                )}
              </td>
            </tr>
          ))}
          {batches.length === 0 && <tr><td colSpan={8}>Nenhum lote ainda.</td></tr>}
        </tbody>
      </table></div>
      <p className="small">Fluxo: baixe o PDF do lote, assine com o e-CNPJ da ADUNIR (Adobe, LibreOffice ou Assinador do ITI) e envie o PDF assinado. O site confere a estrutura da assinatura; a validação da cadeia ICP-Brasil usa um validador configurável (ICP_VALIDATOR_URL). Em produção, só lote validado como ICP-Brasil pode ser enviado.</p>
    </main>
  );
}
