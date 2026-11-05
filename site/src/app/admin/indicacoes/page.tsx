import { redirect } from "next/navigation";
import { sessaoAdmin } from "@/lib/admin";
import { nivelOk } from "@/lib/admin-users";
import { allReferrerStats, signersOf } from "@/lib/referrals";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Indicações", robots: { index: false } };

export default async function Indicacoes({ searchParams }: { searchParams: { msg?: string } }) {
  const sessao = await sessaoAdmin();
  if (!sessao) redirect("/admin");
  if (!nivelOk(sessao.nivel, "leitura")) redirect("/admin?erro=nivel");
  const rows = await allReferrerStats();
  const base = config.appUrl().replace(/\/$/, "");
  const withNames = await Promise.all(rows.filter((r) => r.signed + r.pending > 0).slice(0, 60).map(async (r) => [r.code, await signersOf(r.code)] as const));
  const names = new Map(withNames);
  const total = rows.reduce((a, r) => ({ v: a.v + r.visits, s: a.s + r.signed }), { v: 0, s: 0 });
  return (
    <main>
      <p><a href="/admin">← Painel</a> · <a href="/admin/monitor">Monitor de acessos</a></p>
      <h1>Indicações e links pessoais</h1>
      {searchParams.msg && <p className="box ok" role="status">{searchParams.msg}</p>}
      <p>{rows.length} códigos · <strong>{total.v}</strong> acessos por indicação · <strong>{total.s}</strong> assinaturas confirmadas por indicação.
        Quem indica vê só os próprios totais; os nomes abaixo são visíveis apenas aqui.</p>
      <form method="post" action="/api/admin/indicacoes" style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "12px 0" }}>
        <input name="label" placeholder="Código da organização (ex.: Sindicato X, Grupo Y)" size={42} required /><button>Criar código</button>
      </form>
      <table>
        <thead><tr><th>Código</th><th>Quem</th><th>Acessos</th><th>Assinaram</th><th>Aguardando</th><th>Link</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code}>
              <td><code>{r.code}</code></td><td>{r.label ? `${r.label} (organização)` : r.name ?? "—"}</td><td>{r.visits}</td><td>{r.signed}</td><td>{r.pending}</td>
              <td><a href={`/api/cartaz/${r.code}?baixar=1`}>cartaz</a> · <span className="small">{base}/r/{r.code}</span>
                {names.get(r.code)?.length ? (
                  <details><summary>{names.get(r.code)!.length} pessoa(s)</summary>
                    <ul>{names.get(r.code)!.map((n, i) => <li key={i}>{n.name} <span className="small">({n.status === "confirmed" ? "assinou" : "aguardando confirmação"})</span></li>)}</ul>
                  </details>
                ) : null}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6}>Nenhum código ainda. Eles surgem quando alguém confirma a assinatura.</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
