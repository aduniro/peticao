import { redirect } from "next/navigation";
import { sessaoAdmin } from "@/lib/admin";
import { nivelOk, stepupValido } from "@/lib/admin-users";
import { config } from "@/lib/config";
import { brasilia } from "@/lib/time";
import { outboxStats } from "@/lib/mail/outbox";
import { query } from "@/lib/db";
import { alertasEmail } from "@/lib/mail/alertas";
import PendentesTable from "@/components/admin/PendentesTable";
import { readPendingEmailPage } from "@/lib/pending-email-admin-store";
import RecuperarFila from "@/components/admin/RecuperarFila";
import { listMailRecovery } from "@/lib/mail/recovery";
import PreviaEmail from "@/components/admin/PreviaEmail";
import { readMailHistoryPage } from "@/lib/mail-history-admin-store";
import { dominiosLentos, eventosResumo, porProvedor, porSubdominio, porTipo, sesSaude, statusProvedores, verificacoes } from "@/lib/mail/painel";

export const dynamic = "force-dynamic";
export const metadata = { title: "E-mails", robots: { index: false } };

const NOME_TIPO: Record<string, string> = { confirmacao: "Confirmação de assinatura", confirmada: "Agradecimento + cartão", divulgacao: "Divulgação (cartaz)", contato: "Contato", lote: "Lote ao governo", aprovacao: "Aprovação (interno)", campanha: "Campanha", geral: "Outros" };
const NOME_EVENTO: Record<string, string> = { hard_bounce: "devolução permanente", soft_bounce: "devolução temporária", blocked: "bloqueado", complaint: "reclamação" };
const n = (x: unknown) => (x === undefined || x === null ? "—" : Number(x).toLocaleString("pt-BR"));
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");

export default async function Emails({ searchParams }: { searchParams: { msg?: string } }) {
  const sessao = await sessaoAdmin();
  if (!sessao) redirect("/admin");
  if (!nivelOk(sessao.nivel, "edicao")) redirect("/admin?erro=nivel");
  const podeRecuperar = nivelOk(sessao.nivel, "total") && !!sessao.userId;
  const stepupAtRead = podeRecuperar && stepupValido(sessao);
  const recuperacao = stepupAtRead
    ? await listMailRecovery().catch(() => null)
    : undefined;
  const historico = await readMailHistoryPage(sessao, { limit: 10 });
  const [prov, tipos, subs, ses, evs, pending, checks, lentos, status, outbox] = await Promise.all([porProvedor(), porTipo(), porSubdominio(), sesSaude(), eventosResumo(), readPendingEmailPage(sessao, { limit: 50 }), verificacoes(), dominiosLentos(), statusProvedores(), outboxStats()]);
  const blackEmails = (await query<{ n: number }>("SELECT COUNT(*)::int n FROM email_suppressions WHERE reason='invalid'")).rows[0].n;
  const suppressed = (await query<{ n: number }>("SELECT COUNT(*)::int n FROM email_suppressions WHERE reason IN ('bounce','complaint')")).rows[0].n;
  const alertas = await alertasEmail({ pendingTotal: pending.ok ? pending.summary.global.total : null });
  const pendingCounts = pending.ok ? pending.summary.global : null;
  const engagementUpdated = (await query<{ value: string | null }>("SELECT MAX(updated_at)::text value FROM mail_engagement")).rows[0].value;
  const status_b = status.brevo?.data, rp = status.respostas?.data; void status_b;
  // Recheck the whole SSR response after potentially lengthy reads, including recovery/preview permissions.
  const current = await sessaoAdmin();
  if (!current || current.userId !== sessao.userId || current.sessaoId !== sessao.sessaoId || !nivelOk(current.nivel, "edicao")) redirect("/admin?erro=nivel");
  if (current.nivel !== sessao.nivel || stepupAtRead !== (nivelOk(current.nivel, "total") && !!current.userId && stepupValido(current))) redirect("/admin/emails");
  const actorScope = `${current.userId}:${current.sessaoId ?? "legacy"}:${current.nivel}`;

  return (
    <main className="v2-pagina">
      <div className="v2-secao">
      <h1>E-mails</h1>
      {searchParams.msg && <p className="box ok" role="status">{searchParams.msg}</p>}
      <p>Cadeia transacional: <strong>{config.mailProviders().join(" → ")}</strong> · Marketing: <strong>{config.marketingProviders().join(" → ") || "não configurado"}</strong> · Reply-To: <strong>{config.mailReplyTo() || "nenhum"}</strong></p>
      {alertas.length ? <div className="box err" role="alert"><strong>Atenção</strong><ul>{alertas.map((a) => <li key={a}>{a}</li>)}</ul></div> : <p className="box ok">Nenhum alerta: provedores com saldo, fila vazia e nenhum cadastro sem e-mail.</p>}
      <form method="post" action="/api/admin/emails/sincronizar" style={{ margin: "10px 0" }}>
        Buscar nos provedores os últimos <select name="dias" defaultValue="3"><option value="1">1 dia</option><option value="3">3 dias</option><option value="7">7 dias</option><option value="14">14 dias</option><option value="30">30 dias</option></select>{" "}
        <button>Sincronizar agora</button> <span className="small">(o agendador faz isso sozinho a cada 10 minutos)</span>
      </form>

      {/* MUDAR AQUI: estados do último sinal conhecido, na mesma consulta global da lista de pendentes. */}
      <h2>Sinais registrados para os cadastros pendentes</h2>
      <p className="small">{pending.ok && <>Resumo da consulta inicial de {brasilia(pending.asOf, true)}. </>}Cada cadastro aguardando confirmação aparece pelo último sinal cronológico registrado para seu endereço. O histórico pode incluir mensagens anteriores e não comprova entrega, abertura ou clique da confirmação atual. Aceite pelo provedor não equivale a entrega; ausência de abertura não comprova spam. <a href="/admin/emails/entregas">Ver cadastros e endereços com sinais registrados</a>.</p>
      {!pendingCounts && <p className="v2-aviso erro" role="alert">Não foi possível consultar os sinais dos pendentes. Atualize a página para tentar novamente.</p>}
      <table className="adm-table"><tbody>
        <tr><td>Aguardando confirmação</td><td><strong>{pendingCounts?.total ?? "—"}</strong></td></tr>
        <tr><td>Último sinal: clique registrado</td><td>{pendingCounts?.byState.clicked ?? "—"}</td></tr>
        <tr><td>Último sinal: abertura registrada</td><td>{pendingCounts?.byState.opened ?? "—"}</td></tr>
        <tr><td>Último sinal: entrega registrada</td><td>{pendingCounts?.byState.delivered ?? "—"}</td></tr>
        <tr><td>Último sinal: devolução, bloqueio ou reclamação</td><td>{pendingCounts?.byState.adverse ?? "—"}</td></tr>
        <tr><td>Último sinal: aceite pelo provedor</td><td>{pendingCounts?.byState.accepted ?? "—"}</td></tr>
        <tr><td>Sem sinal registrado nas fontes disponíveis</td><td>{pendingCounts?.byState.unrecorded ?? "—"}</td></tr>
      </tbody></table>
      <form method="post" action="/api/admin/emails/engajamento" style={{ margin: "10px 0" }}>
        Buscar entregas, aberturas e cliques dos últimos <select name="dias" defaultValue="30"><option value="7">7 dias</option><option value="14">14 dias</option><option value="30">30 dias</option><option value="60">60 dias</option><option value="90">90 dias</option></select> <button>Atualizar engajamento</button>
        <span className="small"> Última atualização do agregado legado: {engagementUpdated ? brasilia(engagementUpdated, true) : "nunca"}. Pode levar alguns minutos.</span>
      </form>

      <h2 id="fila" tabIndex={-1}>Fila de reenvio e lista negra</h2>
      <section className="box" style={{ margin: "8px 0" }}>
        <div className="adm-bar">Fila de reenvio: <strong>{outbox.pending}</strong> pendente(s){outbox.oldest ? ` (a mais antiga é de ${brasilia(outbox.oldest)})` : ""} · {outbox.failed} que desistiram depois de 48 h.
          <form method="post" action="/api/admin/seguranca/fila" style={{ display: "inline" }}><button className="adm-btn sm">Reenviar agora</button></form></div>
        <p>Lista negra por e-mail inexistente (3 tentativas): <strong>{blackEmails}</strong> · suprimidos por devolução permanente ou reclamação: <strong>{suppressed}</strong></p>
        <form method="post" action="/api/admin/seguranca/email" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input name="email" type="email" placeholder="E-mail a tirar da lista negra" size={36} required /><button>Liberar e-mail</button>
        </form>
        <p className="small">Regra: 3 tentativas com o mesmo e-mail inexistente põem o e-mail na lista negra. Não há bloqueio de IP por erro.</p>
      </section>
      {podeRecuperar && !stepupValido(sessao) ? <p><a href="/admin/confirmar?volta=%2Fadmin%2Femails">Concluir fila sem reenviar</a></p> : null}
      {recuperacao?.ok ? <RecuperarFila initial={recuperacao.records} next={recuperacao.next} names={NOME_TIPO} /> : recuperacao === null || recuperacao?.ok === false ? <p className="v2-aviso erro" role="alert">Não foi possível carregar a lista. Tente novamente.</p> : null}
      {podeRecuperar && !stepupValido(sessao) ? <p><a href="/admin/confirmar?volta=%2Fadmin%2Femails">Ver prévia protegida</a></p> : null}
      {historico?.ok ? <PreviaEmail initial={historico.records} next={historico.next} names={NOME_TIPO} canPreview={podeRecuperar && stepupValido(sessao)} actorScope={actorScope} initialAsOf={historico.asOf} initialTotal={historico.total} /> : historico === null || historico?.ok === false ? <p className="v2-aviso erro" role="alert">Não foi possível carregar a lista. Tente novamente.</p> : null}

      <h2>Provedores: saldo e envios</h2>
      <div className="table-scroll"><table>
        <thead><tr><th>Provedor</th><th>Saldo / limite</th><th>Enviados 24 h</th><th>Falhas 24 h</th><th>Enviados 7 dias</th><th>Falhas 7 dias</th><th>Última tentativa</th></tr></thead>
        <tbody>
          {["ses", "sendpulse", "mailersend", "brevo", "mailrelaypresidente", "dev"].map((p) => {
            const r = prov.find((x) => x.provider === p); const s = status[p]?.data;
            const saldo = p === "brevo" ? (s?.ok ? `${n(s.creditos)} envios` : s?.erro ?? "sem consulta")
              : p === "sendpulse" ? (s?.ok ? `${n(s.restantes)} de ${n(s.total)} (até ${s.porHora ? n(s.porHora) + "/h" : "?"}${s.validade ? `, vale até ${String(s.validade).slice(0, 10)}` : ""})` : s?.erro ?? "sem consulta")
              : p === "mailersend" ? (s?.ok ? `${n(s.restantes)} de ${n(s.cotaDia)} hoje` : s?.erro ?? "sem consulta")
              : p === "ses" ? `${n(s?.cotaDia ?? 50000)}/dia · ${s?.porSegundo ?? 14}/s` : p === "mailrelaypresidente" ? "ver painel do Mailrelay" : "—";
            if (!r && p === "dev") return null;
            return <tr key={p}><td><strong>{p}</strong></td><td>{saldo}</td><td>{n(r?.sent24 ?? 0)}</td><td>{n(r?.failed24 ?? 0)}</td><td>{n(r?.sent7 ?? 0)}</td><td>{n(r?.failed7 ?? 0)}</td><td>{r?.last ? brasilia(r.last, true) : "—"}</td></tr>;
          })}
        </tbody>
      </table></div>
      <p className="small">Saldos atualizados em {status.sendpulse ? brasilia(status.sendpulse.at, true) : "—"}. O SES e o Mailrelay não informam a cota pela API; para o SES o painel conta os envios e as devoluções pelo próprio registro.</p>

      <h2>Por tipo de mensagem</h2>
      <div className="table-scroll"><table>
        <thead><tr><th>Tipo</th><th>Canal</th><th>Enviados 24 h</th><th>Falhas 24 h</th><th>Enviados 7 dias</th><th>Falhas 7 dias</th></tr></thead>
        <tbody>{tipos.length ? tipos.map((t) => <tr key={t.kind + t.channel}><td>{NOME_TIPO[t.kind] ?? t.kind}</td><td>{t.channel === "marketing" ? "marketing" : "transacional"}</td><td>{n(t.sent24)}</td><td>{n(t.failed24)}</td><td>{n(t.sent7)}</td><td>{n(t.failed7)}</td></tr>) : <tr><td colSpan={6}><em>Nenhum envio registrado ainda (o registro começou na publicação desta versão).</em></td></tr>}</tbody>
      </table></div>

      <h2>Por subdomínio do remetente</h2>
      <div className="table-scroll"><table>
        <thead><tr><th>Subdomínio (De:)</th><th>Provedor</th><th>Enviados (7 dias)</th></tr></thead>
        <tbody>{subs.length ? subs.map((d) => <tr key={d.dominio + d.provider}><td>{d.dominio || "—"}</td><td>{d.provider}</td><td>{n(d.enviados)}</td></tr>) : <tr><td colSpan={3}><em>Sem dados ainda.</em></td></tr>}</tbody>
      </table></div>

      <h2>Saúde do SES</h2>
      <p className={ses.nivel === "risco" ? "box err" : ses.nivel === "atencao" ? "box" : "box ok"}>
        {ses.nivel === "sem_dados" ? "Poucos envios no SES nos últimos 7 dias para calcular." : <>Últimos 7 dias: <strong>{n(ses.enviados7)}</strong> enviados · devolução permanente <strong>{ses.taxaDevolucao}%</strong> ({n(ses.hard7)}) · temporária {n(ses.soft7)} · reclamações <strong>{ses.taxaReclamacao}%</strong> ({n(ses.reclamacoes7)}). A Amazon revisa a conta a 5% de devolução e 0,1% de reclamação.</>}
      </p>

      <h2>Devoluções, bloqueios e reclamações por provedor</h2>
      <div className="table-scroll"><table>
        <thead><tr><th>Provedor</th><th>Tipo</th><th>24 h</th><th>7 dias</th><th>Total</th></tr></thead>
        <tbody>{evs.length ? evs.map((e) => <tr key={e.provider + e.type}><td>{e.provider}</td><td>{NOME_EVENTO[e.type] ?? e.type}</td><td>{n(e.n24)}</td><td>{n(e.n7)}</td><td>{n(e.total)}</td></tr>) : <tr><td colSpan={5}><em>Nenhum evento registrado. Use “Sincronizar agora” com 14 ou 30 dias para trazer o histórico.</em></td></tr>}</tbody>
      </table></div>

      {/* MUDAR AQUI: sinais pertencem ao histórico do endereço, sem atribuição automática à solicitação atual. */}
      <h2 id="pendentes">Cadastros aguardando confirmação</h2>
      <p>Consulta de todos os cadastros pendentes. Os sinais registrados pertencem ao histórico do endereço e não comprovam, por si só, a situação da mensagem atual. Endereços completos são restritos aos usuários autorizados.</p>
      <PendentesTable actorScope={actorScope} initial={pending.ok ? pending : null} initialError={pending.ok ? undefined : pending.error} />

      <h2>Verificação de e-mail antes do envio (Reacher pelas sondas de cabanos.cc, e domínio)</h2>
      <p className="small">Sondas: <code>verifica1.cabanos.cc</code> (padrão) e <code>verifica2.cabanos.cc</code> (Gmail). Limites do Reacher: 30 por minuto e 5.000 por dia. Domínios institucionais que não respondem à sonda são pulados por 30 minutos.</p>
      <div className="table-scroll"><table>
        <thead><tr><th>Verificação</th><th>Resultado</th><th>24 h</th><th>7 dias</th><th>Tempo médio</th></tr></thead>
        <tbody>{checks.length ? checks.map((c) => <tr key={c.via + c.verdict}><td>{c.via === "reacher" ? "Reacher (cabanos.cc)" : c.via === "mx" ? "Domínio (MX)" : c.via}</td><td>{c.verdict}</td><td>{n(c.n24)}</td><td>{n(c.n7)}</td><td>{c.ms ? `${c.ms} ms` : "—"}</td></tr>) : <tr><td colSpan={5}><em>Nenhuma verificação registrada ainda (o registro começou na publicação desta versão).</em></td></tr>}</tbody>
      </table></div>
      {lentos.length > 0 && <p>Domínios que não responderam à sonda (7 dias): {lentos.map((l) => `${l.dominio} (${l.n})`).join(", ")}.</p>}

      <h2>Respostas recebidas (Cloudflare Email Routing → Proton)</h2>
      {rp?.ok ? <p>Últimos {rp.dias} dias: <strong>{n(rp.total)}</strong> mensagens recebidas nos endereços dos subdomínios · entregues ao Proton {n(rp.entregues)} · marcadas como spam {n(rp.spam)} · rejeitadas {n(rp.rejeitadas)}. As respostas em si ficam na caixa <code>operator-1608598f41@example.invalid</code>.</p>
        : <p className="box">{rp?.erro ?? "sem consulta"}. Para contar as respostas aqui, crie na Cloudflare um token só de leitura de estatísticas (Analytics Read, zona sancionaintegral.org) e grave-o com <code>chave.mjs cloudflare:analytics</code> e <code>deploy/17-credencial-cloudflare-analytics.sh</code>. Enquanto isso, as respostas chegam normalmente ao Proton.</p>}
    </div>
    </main>
  );
}
