import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin";
import { dispersionRows, summarize, type DispRow } from "@/lib/dispersion";
import { brasilia } from "@/lib/time";
import { KIND_LABELS } from "@/lib/institutional";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dispersão da campanha", robots: { index: false } };

const ORIGIN: Record<string, string> = { direto: "Link direto / sem rastreio", organizacao: "Código de organização", pessoal: "Indicação de um assinante" };
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "—");

function Node({ r, kids, depth }: { r: DispRow; kids: Map<number, DispRow[]>; depth: number }) {
  const children = kids.get(r.id) ?? [];
  const label = <>{r.name} <span className="small">({r.status === "confirmed" ? "assinou" : "aguardando"}{r.invited_confirmed ? ` · convidou ${r.invited_confirmed}` : ""})</span></>;
  if (!children.length || depth > 6) return <li>{label}</li>;
  return <li><details open={depth < 1}><summary>{label}</summary><ul>{children.map((c) => <Node key={c.id} r={c} kids={kids} depth={depth + 1} />)}</ul></details></li>;
}

export default async function Dispersao() {
  if (!isAdmin()) redirect("/admin");
  const rows = await dispersionRows();
  const s = summarize(rows);
  const kids = new Map<number, DispRow[]>();
  for (const r of rows) if (r.owner_id !== null) kids.set(r.owner_id, [...(kids.get(r.owner_id) ?? []), r]);
  const roots = rows.filter((r) => r.owner_id === null && (kids.get(r.id)?.length ?? 0) > 0).sort((a, b) => b.invited_confirmed - a.invited_confirmed);
  return (
    <main className="wide">
      <p><a href="/admin">← Painel</a> · <a href="/admin/indicacoes">Indicações</a> · <a href="/admin/monitor">Monitor</a></p>
      <h1>Dispersão da campanha</h1>
      <p>De onde vieram as assinaturas: link direto, código de uma organização ou link/QR de outro assinante. <a href="/api/admin/dispersao">Baixar base interna (CSV, com e-mail e horário de Brasília)</a>. <strong>Não envie esse arquivo às autoridades.</strong></p>

      <div className="stats">
        <div><strong>{s.confirmed}</strong><span>assinaturas confirmadas ({s.total} no total)</span></div>
        {(["direto", "organizacao", "pessoal"] as const).map((k) => <div key={k}><strong>{s.byOrigin[k].confirmed}</strong><span>{ORIGIN[k]} ({pct(s.byOrigin[k].confirmed, s.confirmed)})</span></div>)}
        <div><strong>{s.avgInvitedPerConfirmed.toFixed(2)}</strong><span>convites que viraram assinatura, por assinante</span></div>
        <div><strong>{pct(Math.round(s.deepShare * s.confirmed), s.confirmed)}</strong><span>vieram de uma cadeia com 2+ repasses</span></div>
      </div>

      <h2>Por geração</h2>
      <p className="small">Geração 0 = entrou direto ou por código de organização. Geração 1 = entrou pelo link de alguém da geração 0. Geração 2+ = o link foi repassado de novo por quem não veio da organização, ou seja, houve repasse entre terceiros.</p>
      <table><thead><tr><th>Geração</th><th>Pessoas</th><th>Confirmadas</th></tr></thead>
        <tbody>{s.byGeneration.map((g) => <tr key={g.generation}><td>{g.generation}</td><td>{g.total}</td><td>{g.confirmed}</td></tr>)}
          {s.byGeneration.length === 0 && <tr><td colSpan={3}>Sem assinaturas ainda.</td></tr>}</tbody></table>

      <h2>Quem mais trouxe gente</h2>
      <table><thead><tr><th>Assinante</th><th>Convidou</th><th>Confirmaram</th><th>Alcance total*</th></tr></thead>
        <tbody>{s.spreaders.map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.invited}</td><td>{p.invitedConfirmed}</td><td>{p.reach}</td></tr>)}
          {s.spreaders.length === 0 && <tr><td colSpan={4}>Ninguém trouxe outra pessoa ainda.</td></tr>}</tbody></table>

      <p className="small">* Alcance total = assinaturas confirmadas que descendem da pessoa: convidados, convidados dos convidados e assim por diante.</p>

      <h2>Repasse do e-mail de confirmação</h2>
      <p>Das confirmadas: <strong>{s.sameDevice}</strong> confirmaram no mesmo aparelho em que assinaram e <strong>{s.notSameDevice}</strong> em outro aparelho.
        <span className="small"> Atenção: é só um indício. Abrir o e-mail no celular e assinar no computador, ou o navegador embutido do aplicativo de e-mail, também aparece como "outro aparelho".</span></p>

      <h2>Árvore de indicações</h2>
      {roots.length ? <ul className="tree">{roots.map((r) => <Node key={r.id} r={r} kids={kids} depth={0} />)}</ul> : <p>Ainda não há indicações.</p>}

      <h2>Todas as assinaturas ({rows.length})</h2>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Assinou em (Brasília)</th><th>Nome</th><th>E-mail</th><th>Instituição pelo e-mail</th><th>Origem</th><th>Quem indicou / código</th><th>Ger.</th><th>Convidou</th><th>Situação</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{brasilia(r.consent_at)}</td><td>{r.name}</td><td>{r.email}</td>
                <td>{r.email_institution ?? r.email_domain ?? "—"}{r.email_domain_kind ? <span className="small"> · {KIND_LABELS[r.email_domain_kind as keyof typeof KIND_LABELS] ?? r.email_domain_kind}</span> : null}</td>
                <td>{ORIGIN[r.origin]}</td>
                <td>{r.origin === "pessoal" ? rows.find((o) => o.id === r.owner_id)?.name ?? "—" : r.org_label ?? "—"}{r.ref_code ? <span className="small"> · {r.ref_code}</span> : null}</td>
                <td>{r.generation}</td><td>{r.invited_confirmed}/{r.invited}</td><td>{r.status === "confirmed" ? `confirmada ${brasilia(r.confirmed_at)}` : "aguardando"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9}>Sem assinaturas ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
