import { isAdmin } from "@/lib/admin";
import { listContacts } from "@/lib/contact";
import { redirect } from "next/navigation";
import { brasilia } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mensagens de contato", robots: { index: false } };

export default async function ContatoAdmin() {
  if (!isAdmin()) redirect("/admin");
  const rows = await listContacts();
  return (
    <main>
      <h1>Mensagens de contato</h1>
      <p><a href="/admin">← Painel</a> · <a href="/admin/monitor">Monitor</a> · {rows.length} mensagem(ns). Responda pelo e-mail informado; a mensagem também vai para a caixa de contato quando o envio está configurado.</p>
      {rows.length === 0 && <p className="box">Nenhuma mensagem de contato ainda.</p>}
      {rows.map((r) => (
        <section className="box" key={r.id} style={{ margin: "10px 0" }}>
          <p style={{ margin: 0 }}><strong>#{r.id}</strong> · {brasilia(r.created_at)} · <strong>{r.kind}</strong> · {r.locale ?? "?"} · e-mail da caixa: {r.mailed ? "enviado" : <em>NÃO enviado{r.mail_error ? ` (${r.mail_error})` : ""}</em>}</p>
          <p style={{ margin: "4px 0" }}>{r.name} · <a href={`mailto:${encodeURIComponent(r.email).replace(/%40/g, "@")}`}>{r.email}</a></p>
          <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{r.message}</p>
        </section>
      ))}
    </main>
  );
}
