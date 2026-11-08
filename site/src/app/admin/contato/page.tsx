import { sessaoAdmin } from "@/lib/admin";
import { nivelOk, stepupValido } from "@/lib/admin-users";
import { historicoDeRespostas, situacaoDoCadastro } from "@/lib/contact-replies";
import ResponderContato from "@/components/admin/ResponderContato";
import ContactTriage from "@/components/admin/ContactTriage";
import { listContacts } from "@/lib/contact";
import { redirect } from "next/navigation";
import { brasilia } from "@/lib/time";
import { contactReplyLabel } from "@/lib/contact-reply-state";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mensagens de contato", robots: { index: false } };

export default async function ContatoAdmin() {
  const sessao = await sessaoAdmin();
  if (!sessao) redirect("/admin");
  if (!nivelOk(sessao.nivel, "edicao")) redirect("/admin?erro=nivel");
  const rows = await listContacts();
  const podeResponder = (nivelOk(sessao.nivel, "total") && !!sessao.userId) || sessao.preview;
  const hist = await historicoDeRespostas(rows.map((r) => r.id));
  const cadastros = new Map(await Promise.all(rows.map(async (r) => [r.id, await situacaoDoCadastro(r.email)] as const)));
  return (
    <main className="v2-pagina">
      <div className="v2-secao">
      <h1>Mensagens de contato</h1>
      <p><a href="/admin/monitor">Monitor</a> · {rows.length} mensagem(ns). Responda pelo e-mail informado; a mensagem também vai para a caixa de contato quando o envio está configurado.</p>
      {rows.length === 0 && <p className="box">Nenhuma mensagem de contato ainda.</p>}
      {rows.map((r) => (
        <section className="box" key={r.id} style={{ margin: "10px 0" }}>
          <p style={{ margin: 0 }}><strong>#{r.id}</strong> · {brasilia(r.created_at)} · <strong>{r.kind}</strong> · {r.locale ?? "?"} · e-mail da caixa: {r.mailed ? "enviado" : <em>NÃO enviado{r.mail_error ? ` (${r.mail_error})` : ""}</em>}</p>
          <p style={{ margin: "4px 0" }}>{r.name} · <a href={`mailto:${encodeURIComponent(r.email).replace(/%40/g, "@")}`}>{r.email}</a></p>
          <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{r.message}</p>
          <p className="small" style={{ margin: "6px 0 0" }}>Cadastro: {cadastros.get(r.id) ? (cadastros.get(r.id)!.status === "confirmed" ? "assinatura confirmada" : `assinatura ${cadastros.get(r.id)!.status === "pending" ? "pendente (não confirmou)" : cadastros.get(r.id)!.status}`) : "sem cadastro com este e-mail"}</p>
          <ContactTriage contactId={r.id} />
          {(hist[r.id] ?? []).length ? <ul className="small" style={{ margin: "6px 0 0" }}>{hist[r.id].map((h) => <li key={h.id}>Resposta {h.rodada} ({h.versao === "texto" ? "só texto" : "com card"}) por {h.por ?? "?"} em {brasilia(h.criada_em)}: <strong>{contactReplyLabel(h)}</strong></li>)}</ul> : null}
          {podeResponder ? (stepupValido(sessao) ? <ResponderContato contactId={r.id} assuntoInicial={`Re: ${r.kind === "duvida" ? "sua dúvida" : r.kind === "bug" ? "o problema que você relatou" : "sua mensagem"} sobre a petição`} jaRespondida={(hist[r.id] ?? []).length > 0} /> : <p className="small"><a href="/admin/confirmar?volta=/admin/contato">Confirmar o acesso (código por e-mail) para responder</a></p>) : null}
        </section>
      ))}
    </div>
    </main>
  );
}
