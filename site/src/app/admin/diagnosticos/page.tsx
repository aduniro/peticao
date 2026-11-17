import { redirect } from "next/navigation";
import { sessaoAdmin } from "@/lib/admin";
import { nivelOk } from "@/lib/admin-users";
import { signupDiagnosticPage } from "@/lib/signup-diagnostics";
import { brasilia } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Diagnósticos de cadastro", robots: { index: false } };

export default async function Diagnosticos({ searchParams }: { searchParams: { offset?: string; emails?: string } }) {
  const sessao = await sessaoAdmin();
  if (!sessao) redirect("/admin");
  if (!nivelOk(sessao.nivel, "edicao")) redirect("/admin?erro=nivel");
  const offset = /^(?:0|[1-9][0-9]{0,6})$/.test(searchParams.offset ?? "0") ? Number(searchParams.offset ?? 0) : 0;
  const emails = searchParams.emails === "1";
  const result = await signupDiagnosticPage(50, emails, offset);
  const href = (next: number, contacts = emails) => `?${new URLSearchParams({ offset: String(next), emails: contacts ? "1" : "0" })}`;
  return (
    <main className="v2-pagina"><div className="v2-secao">
      <h1>Diagnósticos de cadastro</h1>
      <div className="adm-bar">
        <a href={href(0)}>Atualizar</a>
        <a href={href(0, !emails)}>{emails ? "Ocultar e-mails" : "Mostrar e-mails"}</a>
      </div>
      <h2>Resumo por evento</h2>
      <div className="table-scroll"><table className="adm-table">
        <thead><tr><th>Origem</th><th>Classificação</th><th>Eventos</th><th>Tentativas distintas</th></tr></thead>
        <tbody>{result.summary.map(row => <tr key={`${row.source}:${row.classification}`}>
          <td>{row.source}</td><td>{row.classification}</td><td>{row.count}</td><td>{row.attempts}</td>
        </tr>)}{!result.summary.length && <tr><td colSpan={4}>Nenhum resultado.</td></tr>}</tbody>
      </table></div>
      <h2>Eventos registrados</h2>
      <p className="small">{result.total} evento(s) · página {Math.floor(offset / 50) + 1}</p>
      <div className="table-scroll"><table className="adm-table">
        <thead><tr><th>Data e hora</th><th>Origem / categoria</th><th>Classificação</th><th>HTTP / duração</th><th>Índice / política</th><th>Detalhes técnicos</th>{emails && <th>E-mail</th>}</tr></thead>
        <tbody>{result.records.map(row => <tr key={row.id}>
          <td>{brasilia(row.ts, true)}</td><td>{row.source}<br />{row.category ?? "—"}</td>
          <td>{row.classification}</td><td>{row.http_status ?? "—"}<br />{row.duration_ms === null ? "—" : `${row.duration_ms} ms`}</td>
          <td>{row.learning_index ?? "—"}<br />{row.policy_version ?? "—"}</td>
          <td><details><summary>Ver detalhes</summary><pre>{JSON.stringify({ trace: row.trace_id, metadata: row.metadata }, null, 2)}</pre></details></td>
          {emails && <td>{row.email ?? "—"}</td>}
        </tr>)}{!result.records.length && <tr><td colSpan={emails ? 7 : 6}>Nenhum resultado.</td></tr>}</tbody>
      </table></div>
      <nav aria-label="Paginação dos diagnósticos" className="adm-bar">
        {offset > 0 && <a href={href(Math.max(0, offset - 50))}>← Anterior</a>}
        {result.nextOffset !== null && <a href={href(result.nextOffset)}>Próxima →</a>}
      </nav>
    </div></main>
  );
}
