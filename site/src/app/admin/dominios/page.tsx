import { redirect } from "next/navigation";
import { sessaoAdmin } from "@/lib/admin";
import { nivelOk } from "@/lib/admin-users";
import { query } from "@/lib/db";
import { KIND_LABELS } from "@/lib/institutional";

export const dynamic = "force-dynamic";
export const metadata = { title: "Domínios institucionais", robots: { index: false } };

type Row = { domain: string; kind: string; institution: string | null; source: string; status: string; seen_count: number; evidence_url: string | null };

const KindSelect = ({ def = "ifes" }: { def?: string }) => (
  <select name="kind" defaultValue={def}>
    {Object.entries(KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
  </select>
);

export default async function Dominios({ searchParams }: { searchParams: { msg?: string } }) {
  const sessao = await sessaoAdmin();
  if (!sessao) redirect("/admin");
  if (!nivelOk(sessao.nivel, "edicao")) redirect("/admin?erro=nivel");
  const rows = (await query<Row>("SELECT domain,kind,institution,source,status,seen_count,evidence_url FROM institutional_domains ORDER BY seen_count DESC, domain LIMIT 1500")).rows;
  const pend = rows.filter((r) => r.status === "pending"), appr = rows.filter((r) => r.status === "approved"), rej = rows.filter((r) => r.status === "rejected");
  const bySource = new Map<string, number>();
  for (const r of pend) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
  const stats = (await query<{ k: string | null; n: number }>("SELECT email_domain_kind k, COUNT(*)::int n FROM signatures WHERE status='confirmed' GROUP BY 1 ORDER BY 2 DESC")).rows;
  const checks = (await query<{ c: string | null; n: number }>("SELECT cpf_name_check c, COUNT(*)::int n FROM signatures WHERE status='confirmed' GROUP BY 1 ORDER BY 2 DESC")).rows;
  return (
    <main className="v2-pagina">
      <div className="v2-secao">
      <h1>Domínios institucionais</h1>
      {searchParams.msg && <p className="box ok" role="status">{searchParams.msg}</p>}
      <p className="small">O selo <strong>e-mail institucional confirmado</strong> indica domínio de órgão ou instituição pública (ou de ensino superior). Ele <strong>não</strong> prova que a pessoa é servidora: alunos, terceirizados e aposentados também têm e-mail institucional.
        Sufixos automáticos: .gov.br, .edu.br (pode incluir instituições privadas), .leg.br, .jus.br e .mp.br.</p>

      <h2>Assinaturas confirmadas por selo</h2>
      <p>{stats.map((s) => `${s.k ? KIND_LABELS[s.k as keyof typeof KIND_LABELS] ?? s.k : "sem selo"}: ${s.n}`).join(" · ") || "nenhuma ainda"}</p>
      <p>Conferência de nome no CPF: {checks.map((c) => `${c.c ?? "não verificado"}: ${c.n}`).join(" · ") || "nenhuma ainda"}</p>

      <h2>Pendentes ({pend.length})</h2>
      {[...bySource].map(([src, n]) => (
        <form key={src} method="post" action="/api/admin/dominios" style={{ marginBottom: 8 }}>
          <input type="hidden" name="action" value="approve_source" /><input type="hidden" name="source" value={src} />
          Aprovar <strong>todos os {n}</strong> pendentes da fonte <code>{src}</code> como <KindSelect /> <button>Aprovar em lote</button>
          <span className="small"> {src === "cnpj" || src === "visitante" ? " (confira antes: esta fonte traz muito ruído)" : ""}</span>
        </form>
      ))}
      <table>
        <thead><tr><th>Domínio</th><th>Instituição</th><th>Fonte</th><th>Vezes visto</th><th>Decisão</th></tr></thead>
        <tbody>
          {pend.map((r) => (
            <tr key={r.domain}>
              <td><a href={`https://${r.domain}`} target="_blank" rel="noreferrer noopener">{r.domain}</a></td><td>{r.institution ?? "—"}</td><td>{r.source}</td><td>{r.seen_count}</td>
              <td>
                <form method="post" action="/api/admin/dominios" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  <input type="hidden" name="domain" value={r.domain} />
                  <KindSelect /><input name="institution" placeholder="Instituição" defaultValue={r.institution ?? ""} size={18} /><input name="evidence" placeholder="URL de evidência" size={18} />
                  <button name="action" value="approve">Aprovar</button><button name="action" value="reject">Rejeitar</button>
                </form>
              </td>
            </tr>
          ))}
          {pend.length === 0 && <tr><td colSpan={5}>Nenhum domínio pendente.</td></tr>}
        </tbody>
      </table>

      <h2>Adicionar domínio manualmente</h2>
      <form method="post" action="/api/admin/dominios" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input name="domain" placeholder="exemplo.br" required /><KindSelect /><input name="institution" placeholder="Instituição" /><input name="evidence" placeholder="URL de evidência" />
        <button name="action" value="approve">Aprovar</button><button name="action" value="reject">Rejeitar (bloquear)</button>
      </form>

      <h2>Aprovados ({appr.length})</h2>
      <table><tbody>{appr.map((r) => <tr key={r.domain}><td>{r.domain}</td><td>{KIND_LABELS[r.kind as keyof typeof KIND_LABELS] ?? r.kind}</td><td>{r.institution ?? "—"}</td><td>{r.source}</td></tr>)}</tbody></table>
      <h2>Rejeitados ({rej.length})</h2>
      <table><tbody>{rej.map((r) => <tr key={r.domain}><td>{r.domain}</td><td>{r.institution ?? "—"}</td><td>{r.source}</td></tr>)}</tbody></table>
    </div>
    </main>
  );
}
