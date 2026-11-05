import { redirect } from "next/navigation";
import { sessaoAdmin } from "@/lib/admin";
import { temUsuarios, ROTULO_NIVEL, nivelOk } from "@/lib/admin-users";
import Dashboard from "@/components/admin/Dashboard";
import Painel from "@/components/admin/painel/Painel";
import BarraLista from "@/components/admin/ui/BarraLista";
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
  const itens = (l: { k: string; n: number }[]) => l.map((r) => ({ nome: r.k, valor: r.n }));
  const REG: Record<string, string> = { amazonia_legal: "Amazônia Legal", faixa_fronteira: "Faixa de Fronteira", ambos: "Ambas" };
  return (
    <main className="v2-pagina">
      {searchParams.erro === "nivel" && <p className="box err" role="alert">O seu nível de acesso ({ROTULO_NIVEL[sessao.nivel]}) não permite abrir aquela página.</p>}
      <Painel />
      <div className="v2-secao">
        {searchParams.msg && <p className="box ok" role="status">{searchParams.msg}</p>}
        <div className="v2-acoes" role="group" aria-label="Atalhos">
          <a className="v2-btn v2-btn-primario" href="/admin/emails">E-mails e pendentes</a>
          <a className="v2-btn v2-btn-sec" href="/admin/lotes">Lotes e envios</a>
          <a className="v2-btn v2-btn-sec" href="/admin/devolvidos">Sem e-mail entregue</a>
          <a className="v2-btn v2-btn-sec" href="/admin/mapa">Mapa interativo</a>
          <a className="v2-btn v2-btn-sec" href="/api/admin/export">Baixar lista (CSV)</a>
          <a className="v2-btn v2-btn-sec" href="/api/admin/pdf-previa?tipo=modelo" target="_blank" rel="noopener">PDF: prévia do modelo</a>
          <a className="v2-btn v2-btn-sec" href="/api/admin/pdf-previa?tipo=real" target="_blank" rel="noopener">PDF: prévia real</a>
          <a className="v2-btn v2-btn-sec" href="/admin/contato">Mensagens de contato</a>
          <a className="v2-btn v2-btn-sec" href="/admin/dominios">Domínios institucionais</a>
          <a className="v2-btn v2-btn-sec" href="/admin/monitor">Monitor de acessos</a>
          <a className="v2-btn v2-btn-sec" href="/admin/indicacoes">Indicações</a>
          <a className="v2-btn v2-btn-sec" href="/admin/dispersao">Dispersão da campanha</a>
        </div>
      </div>

      <div className="v2-secao"><h2 className="v2-h2">Análise detalhada</h2><p className="v2-sub">Filtre por categoria, cargo, instituição, campus, estado, cidade, país e período; os gráficos e o mapa respondem juntos.</p><Dashboard /></div>

      <div className="v2-secao v2-grade3">
        <div className="v2-cartao"><BarraLista titulo="Servidores por instituição (IFES)" itens={itens(byIfes)} vazio="Nenhum servidor confirmado ainda." /></div>
        <div className="v2-cartao"><BarraLista titulo="Apoiadores por estado" itens={itens(byUf)} vazio="Nenhum apoiador confirmado ainda." /></div>
        <div className="v2-cartao"><BarraLista titulo="Estrangeiros por país" itens={itens(byCountry)} vazio="Nenhum estrangeiro confirmado ainda." /></div>
        <div className="v2-cartao"><BarraLista titulo="Servidores na Amazônia Legal / Fronteira (validado pelo IBGE)" itens={[...byRegion.map((r) => ({ nome: REG[r.k] ?? r.k, valor: r.n })), ...(notRegion ? [{ nome: "Sem lotação validada", valor: notRegion }] : [])]} vazio="Nenhum servidor com lotação validada." /></div>
        <div className="v2-cartao"><BarraLista titulo="Idioma da tela ao assinar" itens={itens(byLocale)} vazio="—" /></div>
        <div className="v2-cartao"><h2>Sistema</h2>
          <ul className="v2-status">
            <li><span>Auditoria</span><b className={chain.ok ? "ok" : "ruim"}>{chain.ok ? "cadeia íntegra" : `ADULTERAÇÃO na linha ${chain.brokenAt}`}</b></li>
            <li><span>Verificação de CPF</span><b>{identityMode()} · {provider ? (provider.name === "mock" ? "dados de teste" : provider.name) : "sem chave"}</b></li>
            <li><span>Último erro do serviço de CPF</span><b>{lastErr || "nenhum"}</b></li>
          </ul>
          <form method="post" action="/api/admin/identidade/zerar" className="v2-linha"><input name="cpf" placeholder="CPF para liberar (zera as tentativas erradas)" inputMode="numeric" required aria-label="CPF para liberar" /><button className="v2-btn v2-btn-sec">Liberar CPF</button></form>
        </div>
      </div>

      <div className="v2-secao">
        <h2 className="v2-h2">Últimas 25 assinaturas</h2>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Nº</th><th>Nome</th><th>Categoria</th><th>Instituição / Cidade</th><th>Status</th><th>Criada em (Brasília)</th><th>Confirmada em</th><th>Lote</th></tr></thead>
            <tbody>
              {last.map((r, i) => (
                <tr key={i}><td>{r.seq ?? "—"}</td><td>{r.name}</td><td>{r.category}</td>
                  <td>{r.category === "estrangeiro" ? `${r.university ?? "—"} (${r.country ?? "—"})` : r.category === "servidor" ? r.institution ?? "—" : [r.city, r.uf].filter(Boolean).join("/") || "—"}</td>
                  <td><span className={`v2-selo ${r.status === "confirmed" ? "ok" : "esp"}`}>{r.status === "confirmed" ? "confirmada" : "aguardando e-mail"}</span></td><td>{brasilia(r.created_at)}</td><td>{r.confirmed_at ? brasilia(r.confirmed_at) : "—"}</td><td>{r.batch_id ?? "—"}</td></tr>
              ))}
              {last.length === 0 && <tr><td colSpan={8}>Nenhuma assinatura ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
