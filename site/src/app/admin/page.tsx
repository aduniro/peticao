import { redirect } from "next/navigation";
import { sessaoAdmin } from "@/lib/admin";
import { temUsuarios, ROTULO_NIVEL, nivelOk } from "@/lib/admin-users";
import Dashboard from "@/components/admin/Dashboard";
import AdminLogin from "@/components/admin/AdminLogin";
import { turnstileEnabled, turnstileSiteKey } from "@/lib/turnstile";
import { counts } from "@/lib/signatures";
import { query, verifyAuditChain } from "@/lib/db";
import { getSetting } from "@/lib/batches";
import { defaultProvider } from "@/lib/cpf-check";
import { identityMode } from "@/lib/identity";
import { brasilia } from "@/lib/time";
import { config } from "@/lib/config";
import { outboxStats } from "@/lib/mail/outbox";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin", robots: { index: false } };

export default async function Admin({ searchParams }: { searchParams: { erro?: string; msg?: string } }) {
  const sessao = await sessaoAdmin();
  if (!sessao) {
    return (
      <main className="narrow">
        <h1>Acesso restrito</h1>
        <AdminLogin siteKey={turnstileEnabled() ? turnstileSiteKey() : null} erro={searchParams.erro} msg={searchParams.msg} porUsuario={await temUsuarios()} />
      </main>
    );
  }
  const c = await counts();
  const pending = (await query<{ n: number }>("SELECT COUNT(*)::int n FROM signatures WHERE status='pending'")).rows[0].n;
  const last = (
    await query<Record<string, string>>("SELECT seq, name, category, institution, city, uf, country, university, status, created_at, confirmed_at, batch_id FROM signatures ORDER BY id DESC LIMIT 25")
  ).rows;
  const dist = async (sql: string) => (await query<{ k: string; n: number }>(sql)).rows;
  const byRegion = await dist("SELECT COALESCE(region_criteria,'—') k, COUNT(*)::int n FROM signatures WHERE status='confirmed' AND category='servidor' AND region_validated GROUP BY 1 ORDER BY 2 DESC");
  const notRegion = (await query<{ n: number }>("SELECT COUNT(*)::int n FROM signatures WHERE status='confirmed' AND category='servidor' AND NOT COALESCE(region_validated,false)")).rows[0].n;
  const byIfes = await dist("SELECT COALESCE(ifes_acronym,'—') k, COUNT(*)::int n FROM signatures WHERE status='confirmed' AND category='servidor' GROUP BY 1 ORDER BY 2 DESC LIMIT 15");
  const byUf = await dist("SELECT uf k, COUNT(*)::int n FROM signatures WHERE status='confirmed' AND category='apoiador' GROUP BY 1 ORDER BY 2 DESC LIMIT 15");
  const byCountry = await dist("SELECT country k, COUNT(*)::int n FROM signatures WHERE status='confirmed' AND category='estrangeiro' GROUP BY 1 ORDER BY 2 DESC LIMIT 15");
  const byLocale = await dist("SELECT COALESCE(locale,'pt') k, COUNT(*)::int n FROM signatures WHERE status='confirmed' GROUP BY 1 ORDER BY 2 DESC");
  const chain = await verifyAuditChain();
  const outbox = await outboxStats();
  const blackEmails = (await query<{ n: number }>("SELECT COUNT(*)::int n FROM email_suppressions WHERE reason='invalid'")).rows[0].n;
  const suppressed = (await query<{ n: number }>("SELECT COUNT(*)::int n FROM email_suppressions WHERE reason IN ('bounce','complaint')")).rows[0].n;
  if (sessao.trocarSenha) redirect("/admin/conta");
  const provider = defaultProvider();
  const lastErr = await getSetting("cpf_provider_last_error", "");
  return (
    <main>
      <h1>Painel</h1>
      <p className="small" data-testid="quem">Você está logado como <strong>{sessao.nome}</strong> ({sessao.email}) · nível <strong>{ROTULO_NIVEL[sessao.nivel]}</strong>{sessao.legado ? " (senha única de transição)" : ""}{sessao.userId ? <> · <a href="/admin/conta">Minha conta</a></> : null}{nivelOk(sessao.nivel, "total") && !sessao.legado ? <> · <a href="/admin/usuarios">Usuários</a></> : null}</p>
      {searchParams.erro === "nivel" && <p className="box err" role="alert">O seu nível de acesso ({ROTULO_NIVEL[sessao.nivel]}) não permite abrir aquela página.</p>}
      <Dashboard />
      <h2>Resumo e ferramentas</h2>
      {searchParams.msg && <p className="box ok" role="status">{searchParams.msg}</p>}
      <p><strong>{c.total}</strong> confirmadas ({c.servidor} servidores · {c.apoiador} apoiadores · {c.estrangeiro} estrangeiros) · {pending} aguardando confirmação</p>
      <p>Auditoria: {chain.ok ? "cadeia íntegra" : `ADULTERAÇÃO detectada na linha ${chain.brokenAt}`}</p>
      <p><a href="/api/admin/export">Baixar lista (CSV, sem CPF e sem e-mail)</a> · <a href="/admin/lotes">Lotes e envios</a> · <a href="/admin/emails"><strong>E-mails</strong></a> · <a href="/admin/devolvidos">Sem e-mail entregue</a> · <a href="/api/admin/pdf-previa?tipo=modelo" target="_blank" rel="noopener">PDF: prévia do modelo</a> · <a href="/api/admin/pdf-previa?tipo=real" target="_blank" rel="noopener">PDF: prévia real (assinaturas atuais)</a> · <a href="/admin/contato">Mensagens de contato</a> · <a href="/admin/dominios">Domínios institucionais</a> · <a href="/admin/monitor">Monitor de acessos</a> · <a href="/admin/indicacoes">Indicações</a> · <a href="/admin/dispersao">Dispersão da campanha</a></p>
      <section className="box" style={{ margin: "12px 0" }}>
        <h2 style={{ marginTop: 0 }}>Verificação de identidade (CPF)</h2>
        <p>Modo: <strong>{identityMode()}</strong> · Provedor: <strong>{provider ? (provider.name === "mock" ? "DADOS DE TESTE (mock)" : provider.name) : "nenhum (sem chave)"}</strong>
          {lastErr ? <> · Último erro do serviço: <code>{lastErr}</code></> : " · Sem erros registrados"}</p>
        <form method="post" action="/api/admin/identidade/zerar" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input name="cpf" placeholder="CPF para liberar (zera as tentativas erradas)" size={36} inputMode="numeric" required /><button>Liberar CPF</button>
        </form>
      </section>
      <section className="box" style={{ margin: "12px 0" }}>
        <h2 style={{ marginTop: 0 }}>Métricas (confirmadas)</h2>
        <p>Meta: <strong>{config.goal()}</strong> · próximo envio parcial em <strong>{config.batchSize() - (c.total % config.batchSize())}</strong> assinaturas</p>
        <p>Servidores lotados na Amazônia Legal / faixa de fronteira (declarado e validado pelo IBGE): {byRegion.length ? byRegion.map((r) => `${r.k}: ${r.n}`).join(" · ") : "0"} · servidores sem essa lotação validada: {notRegion}</p>
        <p>Servidores por IFES: {byIfes.map((r) => `${r.k} ${r.n}`).join(" · ") || "—"}</p>
        <p>Apoiadores por UF: {byUf.map((r) => `${r.k} ${r.n}`).join(" · ") || "—"}</p>
        <p>Estrangeiros por país: {byCountry.map((r) => `${r.k} ${r.n}`).join(" · ") || "—"}</p>
        <p>Idioma da tela ao assinar: {byLocale.map((r) => `${r.k} ${r.n}`).join(" · ") || "—"}</p>
      </section>
      <h2>Últimas 25 assinaturas</h2>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Nº</th><th>Nome</th><th>Categoria</th><th>Instituição / Cidade</th><th>Status</th><th>Criada em (Brasília)</th><th>Confirmada em</th><th>Lote</th></tr></thead>
          <tbody>
            {last.map((r, i) => (
              <tr key={i}><td>{r.seq ?? "—"}</td><td>{r.name}</td><td>{r.category}</td>
                <td>{r.category === "estrangeiro" ? `${r.university ?? "—"} (${r.country ?? "—"})` : r.category === "servidor" ? r.institution ?? "—" : [r.city, r.uf].filter(Boolean).join("/") || "—"}</td>
                <td>{r.status === "confirmed" ? "confirmada" : "aguardando e-mail"}</td><td>{brasilia(r.created_at)}</td><td>{r.confirmed_at ? brasilia(r.confirmed_at) : "—"}</td><td>{r.batch_id ?? "—"}</td></tr>
            ))}
            {last.length === 0 && <tr><td colSpan={8}>Nenhuma assinatura ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
