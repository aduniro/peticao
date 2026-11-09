import { sessaoAdmin } from "@/lib/admin";
import { nivelOk, stepupValido } from "@/lib/admin-users";
import { historicoDeRespostas, situacaoDoCadastro } from "@/lib/contact-replies";
import ResponderContato from "@/components/admin/ResponderContato";
import ContactTriage from "@/components/admin/ContactTriage";
import { contactListOptions, listContactPage } from "@/lib/contact-list";
import { redirect } from "next/navigation";
import { brasilia } from "@/lib/time";
import { contactReplyLabel } from "@/lib/contact-reply-state";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mensagens de contato", robots: { index: false } };

export default async function ContatoAdmin({ searchParams = {} }: { searchParams?: { antes?: string; tipo?: string; busca?: string } }) {
  const sessao = await sessaoAdmin();
  if (!sessao) redirect("/admin");
  if (!nivelOk(sessao.nivel, "edicao")) redirect("/admin?erro=nivel");
  const filters = contactListOptions({ before: searchParams.antes, kind: searchParams.tipo, search: searchParams.busca });
  const page = await listContactPage(filters ?? {}).catch(() => null);
  const rows = page?.ok ? page.records : [];
  const qs = (before?: number) => {
    const params = new URLSearchParams();
    if (filters?.kind) params.set("tipo", filters.kind);
    if (filters?.search) params.set("busca", filters.search);
    if (before) params.set("antes", String(before));
    return params.size ? `?${params}` : "/admin/contato";
  };
  const podeResponder = (nivelOk(sessao.nivel, "total") && !!sessao.userId) || sessao.preview;
  const hist = await historicoDeRespostas(rows.map((r) => r.id));
  const cadastros = new Map(await Promise.all(rows.map(async (r) => [r.id, await situacaoDoCadastro(r.email)] as const)));
  return (
    <main className="v2-pagina">
      <div className="v2-secao">
      <h1>Mensagens de contato</h1>
      <p><a href="/admin/monitor">Monitor</a> · {page?.ok ? `${page.total} mensagem(ns) · ${rows.length} nesta página` : "Consulta indisponível"}. Responda pelo e-mail informado; a mensagem também vai para a caixa de contato quando o envio está configurado.</p>
      <form method="get" action="/admin/contato" className="adm-bar" data-testid="contact-list-filters">
        <label>Tipo <select name="tipo" defaultValue={filters?.kind ?? ""}><option value="">Todos</option><option value="duvida">Dúvida</option><option value="bug">Problema/erro na página</option><option value="outro">Outro assunto</option></select></label>
        <label>Nome ou e-mail <input name="busca" defaultValue={filters?.search ?? ""} maxLength={120} /></label>
        <button type="submit" className="adm-btn sm">Filtrar</button>
        <a href="/admin/contato">Limpar filtros</a>
      </form>
      {!filters && <p className="err" role="alert">Não foi possível aplicar os filtros. Confira os valores.</p>}
      {!page?.ok && <p className="err" role="alert">Não foi possível carregar as mensagens. Tente novamente.</p>}
      {page?.ok && rows.length === 0 && <p className="box">{page.total === 0 ? "Nenhuma mensagem encontrada." : "Nenhuma mensagem nesta página."}</p>}
      {rows.map((r) => (
        <section className="box" key={r.id} data-contact-id={r.id} style={{ margin: "10px 0" }}>
          <p style={{ margin: 0 }}><strong>#{r.id}</strong> · {brasilia(r.created_at)} · <strong>{r.kind}</strong> · {r.locale ?? "?"} · e-mail da caixa: {r.mailed ? "aceite registrado" : <em>sem aceite registrado{r.mail_error ? ` (${r.mail_error})` : ""}</em>}</p>
          <p style={{ margin: "4px 0" }}>{r.name} · <a href={`mailto:${encodeURIComponent(r.email).replace(/%40/g, "@")}`}>{r.email}</a></p>
          <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{r.message}</p>
          <p className="small" style={{ margin: "6px 0 0" }}>Cadastro: {cadastros.get(r.id) ? (cadastros.get(r.id)!.status === "confirmed" ? "assinatura confirmada" : `assinatura ${cadastros.get(r.id)!.status === "pending" ? "pendente (não confirmou)" : cadastros.get(r.id)!.status}`) : "sem cadastro com este e-mail"}</p>
          <ContactTriage contactId={r.id} />
          {(hist[r.id] ?? []).length ? <ul className="small" style={{ margin: "6px 0 0" }}>{hist[r.id].map((h) => <li key={h.id}>Resposta {h.rodada} ({h.versao === "texto" ? "só texto" : "com card"}) por {h.por ?? "?"} em {brasilia(h.criada_em)}: <strong>{contactReplyLabel(h)}</strong></li>)}</ul> : null}
          {podeResponder ? (stepupValido(sessao) ? <ResponderContato contactId={r.id} assuntoInicial={`Re: ${r.kind === "duvida" ? "sua dúvida" : r.kind === "bug" ? "o problema que você relatou" : "sua mensagem"} sobre a petição`} jaRespondida={(hist[r.id] ?? []).length > 0} /> : <p className="small"><a href="/admin/confirmar?volta=/admin/contato">Confirmar o acesso (código por e-mail) para responder</a></p>) : null}
        </section>
      ))}
      {page?.ok && (filters?.before || page.nextBefore) ? <nav className="adm-bar" aria-label="Paginação das mensagens">{filters?.before ? <a className="adm-btn sm" href={qs()}>Primeira página</a> : null}{page.nextBefore ? <a className="adm-btn sm" href={qs(page.nextBefore)}>Próximas mensagens</a> : null}</nav> : null}
    </div>
    </main>
  );
}
