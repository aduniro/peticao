import { redirect } from "next/navigation";
import { sessaoAdmin } from "@/lib/admin";
import { nivelOk } from "@/lib/admin-users";
import { brasilia } from "@/lib/time";
import { listarEntregas, type Situacao } from "@/lib/mail/entregas";

export const dynamic = "force-dynamic";

const SIT: Record<Situacao, string> = { clicou: "Clicou", abriu: "Abriu", entregue: "Entregue (não abriu)", devolvido: "Devolvido", sem_registro: "Sem registro" };
type SP = { busca?: string; situacao?: string; cadastro?: string; categoria?: string; provedor?: string; pagina?: string };

export default async function Entregas({ searchParams }: { searchParams: SP }) {
  const sessao = await sessaoAdmin();
  if (!sessao) redirect("/admin");
  if (!nivelOk(sessao.nivel, "edicao")) redirect("/admin?erro=nivel");
  const pagina = Math.max(1, Number(searchParams.pagina) || 1);
  const f = { busca: searchParams.busca ?? "", situacao: searchParams.situacao ?? "", cadastro: searchParams.cadastro ?? "", categoria: searchParams.categoria ?? "", provedor: searchParams.provedor ?? "" };
  const r = await listarEntregas({ ...f, pagina, limite: 50 });
  const paginas = Math.max(1, Math.ceil(r.total / r.limite));
  const qs = (extra: Record<string, string>) => new URLSearchParams(Object.entries({ ...f, ...extra }).filter(([, v]) => v)).toString();
  const t = (v: string) => (v ? brasilia(v) : "—");
  return (
    <main>
      <p><a href="/admin/emails">← E-mails</a></p>
      <h1>Entregas por pessoa</h1>
      <p className="small">Cada linha é um endereço que recebeu e-mail, com a situação (entregue, aberto, clicado, devolvido) e os dados do cadastro, para contato pela ADUNIR e pelo sindicato. <strong>O CPF não aparece aqui.</strong> Quem não tem cadastro (contato, avisos) fica sem nome.</p>
      <form method="get" style={{ margin: "10px 0", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input name="busca" defaultValue={f.busca} placeholder="Nome ou e-mail" />
        <select name="situacao" defaultValue={f.situacao}><option value="">Toda situação</option>{Object.entries(SIT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="cadastro" defaultValue={f.cadastro}><option value="">Todo cadastro</option><option value="aguardando">Aguardando confirmação</option><option value="confirmado">Confirmado</option><option value="sem">Sem cadastro</option></select>
        <select name="categoria" defaultValue={f.categoria}><option value="">Toda categoria</option><option value="servidor">Servidor</option><option value="apoiador">Apoiador</option><option value="estrangeiro">Estrangeiro</option></select>
        <input name="provedor" defaultValue={f.provedor} placeholder="Provedor (ex.: ses)" size={14} />
        <button>Filtrar</button> <a href={`/api/admin/emails/entregas?${qs({})}`}>Baixar CSV ({r.total})</a>
      </form>
      <p className="small">{r.total} endereço(s) · página {r.pagina} de {paginas}</p>
      <div style={{ overflowX: "auto" }}>
        <table className="adm-table">
          <thead><tr><th>Nome</th><th>E-mail</th><th>Categoria</th><th>Instituição / cargo</th><th>Local</th><th>Cadastro</th><th>WhatsApp</th><th>Situação do e-mail</th><th>Último envio</th><th>Entregue</th><th>Aberto</th><th>Clicou</th><th>Devolução</th></tr></thead>
          <tbody>
            {r.linhas.map((l) => (
              <tr key={l.email}>
                <td>{l.nome || <em>(sem cadastro)</em>}</td><td>{l.email}</td><td>{l.categoria || "—"}</td>
                <td>{[l.instituicao, l.campus, l.cargo].filter(Boolean).join(" · ") || "—"}</td><td>{[l.cidadeUf, l.pais].filter(Boolean).join(" · ") || "—"}</td>
                <td>{l.cadastro || "—"}{l.cadastradoEm ? <><br /><span className="small">{t(l.cadastradoEm)}</span></> : null}</td>
                <td>{l.whatsapp || "—"}</td>
                <td><strong>{SIT[l.situacao]}</strong></td>
                <td>{l.ultimoEnvio ? <>{t(l.ultimoEnvio)}<br /><span className="small">{l.ultimoTipo} · {l.provedores}</span></> : "—"}</td>
                <td>{t(l.entregueEm)}</td><td>{t(l.abertoEm)}</td><td>{t(l.clicouEm)}</td>
                <td>{l.devolucao ? <>{l.devolucao}<br /><span className="small">{l.devolucaoMotivo}</span></> : "—"}</td>
              </tr>
            ))}
            {!r.linhas.length && <tr><td colSpan={13}>Nenhum resultado.</td></tr>}
          </tbody>
        </table>
      </div>
      <p>
        {pagina > 1 && <a href={`?${qs({ pagina: String(pagina - 1) })}`}>← Anterior</a>} {pagina < paginas && <a href={`?${qs({ pagina: String(pagina + 1) })}`}>Próxima →</a>}
      </p>
    </main>
  );
}
