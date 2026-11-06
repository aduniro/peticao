import { sessaoAdmin } from "@/lib/admin";
import { nivelOk } from "@/lib/admin-users";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { decifrar } from "@/lib/crypto-dados";
import { formatarTelefone } from "@/lib/whatsapp/telefone";
import { waEstado } from "@/lib/whatsapp/provider";
import { DDI_LISTA } from "@/lib/whatsapp/ddi";
import { countryName } from "@/i18n";
import { brasilia } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "WhatsApp", robots: { index: false } };

const CAT: Record<string, string> = { servidor: "Servidor", apoiador: "Apoiador", estrangeiro: "Estrangeiro" };

export default async function WhatsApp({ searchParams }: { searchParams: { msg?: string; q?: string; status?: string } }) {
  const sessao = await sessaoAdmin();
  if (!sessao) redirect("/admin");
  if (!nivelOk(sessao.nivel, "total")) redirect("/admin?erro=nivel");
  const est = waEstado();
  const senders = (await query<{ id: number; label: string; phone_cipher: string; phone_last4: string; active: boolean; created_at: string }>("SELECT * FROM whatsapp_senders ORDER BY id")).rows;
  const q = (searchParams.q ?? "").trim().slice(0, 60);
  const status = ["pending", "confirmed"].includes(searchParams.status ?? "") ? searchParams.status! : "";
  const params: unknown[] = []; const w = ["s.wa_cipher IS NOT NULL"];
  if (q) { params.push(`%${q}%`); w.push(`s.name ILIKE $${params.length}`); }
  if (status) { params.push(status); w.push(`s.status = $${params.length}`); }
  const rows = (await query<any>(`SELECT s.id, s.name, s.category, COALESCE(s.institution, s.university) inst, s.role, s.region_criteria, s.region_validated, s.campus, s.city, s.uf, s.country, s.status, s.wa_cipher, s.wa_confirmed_at,
      (SELECT m.status FROM whatsapp_messages m WHERE m.signature_id = s.id ORDER BY m.id DESC LIMIT 1) ultima
    FROM signatures s WHERE ${w.join(" AND ")} ORDER BY s.id DESC LIMIT 300`, params)).rows;
  const total = (await query<{ n: number }>("SELECT COUNT(*)::int n FROM signatures WHERE wa_cipher IS NOT NULL")).rows[0].n;
  const msgs = (await query<{ status: string; n: number }>("SELECT status, COUNT(*)::int n FROM whatsapp_messages GROUP BY status ORDER BY n DESC")).rows;
  const ok = (b: boolean) => (b ? "✅" : "⏳");
  return (
    <main className="v2-pagina">
      <div className="v2-secao">
      <h1>WhatsApp</h1>
      {searchParams.msg && <p className="box ok" role="status">{searchParams.msg}</p>}

      <h2>Situação do recurso</h2>
      <div className={`box ${est.pronto ? "ok" : ""}`}>
        <p><strong>{est.pronto ? "LIGADO" : "DESLIGADO"}</strong> — {est.pronto ? "o campo aparece no formulário público e os pedidos são enviados." : "o site se comporta como se o WhatsApp não existisse (sem campo no formulário, sem envio). Nada quebra."}</p>
        <ul>
          <li>{ok(est.ligado)} Interruptor <code>WHATSAPP_ENABLED=1</code></li>
          <li>{ok(est.token)} Token do MailerSend (permissão <code>whatsapp_full</code>) guardado criptografado na VPS</li>
          <li>{ok(est.remetente)} Número remetente (<code>WHATSAPP_FROM</code>) conectado no MailerSend</li>
          <li>{ok(est.modeloPedido)} Modelo aprovado de pedido de confirmação (<code>WHATSAPP_TEMPLATE_CONFIRM</code>)</li>
          <li>{ok(est.modeloPronto)} Modelo aprovado de “assinatura confirmada” (<code>WHATSAPP_TEMPLATE_DONE</code>)</li>
        </ul>
        <p className="small">Os números abaixo ficam criptografados no banco (AES-256-GCM) e só são decifrados aqui, para você. Nenhuma chave de API é mostrada nesta página.</p>
      </div>

      <h2>Nossos números remetentes</h2>
      <p className="small">Cadastro para controle. O número que realmente envia é o conectado no painel do MailerSend (WhatsApp → Phone numbers).</p>
      <div className="adm-tablewrap"><table className="adm-table">
        <thead><tr><th>Nome</th><th>Número</th><th>Situação</th><th>Desde</th><th></th></tr></thead>
        <tbody>
          {senders.map((s) => (
            <tr key={s.id}>
              <td data-l="Nome">{s.label}</td><td data-l="Número">{formatarTelefone(decifrar(s.phone_cipher, `wa-sender:${s.id}`) ?? "") || `•••• ${s.phone_last4}`}</td>
              <td data-l="Situação">{s.active ? "ativo" : "pausado"}</td><td data-l="Desde">{brasilia(s.created_at, true)}</td>
              <td><form method="post" action="/api/admin/whatsapp/remetentes" className="adm-bar"><input type="hidden" name="id" value={s.id} />
                <button name="acao" value="toggle" className="adm-btn">{s.active ? "Pausar" : "Ativar"}</button> <button name="acao" value="remove" className="adm-btn">Remover</button></form></td>
            </tr>))}
          {senders.length === 0 ? <tr><td colSpan={5}>Nenhum remetente cadastrado.</td></tr> : null}
        </tbody></table></div>
      <form method="post" action="/api/admin/whatsapp/remetentes" className="adm-bar" style={{ flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        <input type="hidden" name="acao" value="add" />
        <input name="rotulo" placeholder="Nome (ex.: ADUNIR principal)" required maxLength={60} />
        <select name="ddi" defaultValue="55" aria-label="DDI">{DDI_LISTA.map(([iso, d]) => <option key={iso} value={d}>{countryName(iso, "pt")} +{d}</option>)}</select>
        <input name="numero" placeholder="69 99999-0000" inputMode="tel" required />
        <button className="adm-btn">Cadastrar remetente</button>
      </form>

      <h2>Destinatários ({total})</h2>
      <p className="small">Quem informou WhatsApp e aceitou o uso. Quem pediu a assinatura antes de o recurso existir não aparece aqui (segue só pelo e-mail).</p>
      <form method="get" className="adm-bar" style={{ flexWrap: "wrap", gap: 8 }}>
        <input type="search" name="q" defaultValue={q} placeholder="Buscar nome…" />
        <select name="status" defaultValue={status}><option value="">Todos</option><option value="confirmed">Confirmadas</option><option value="pending">Aguardando</option></select>
        <button className="adm-btn">Filtrar</button>
        <button type="button" className="adm-btn" disabled title="Envio manual desativado: só o fluxo automático envia, e só com o recurso ligado.">Enviar mensagem</button>
      </form>
      <div className="adm-tablewrap"><table className="adm-table">
        <thead><tr><th>Categoria</th><th>Nome</th><th>Instituição</th><th>Cargo</th><th>AL/Fronteira</th><th>Campus</th><th>Cidade/UF</th><th>País</th><th>WhatsApp</th><th>Situação</th><th>Última msg</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const reg = r.region_validated ? (r.region_criteria === "ambos" ? "AL + Fronteira" : r.region_criteria === "faixa_fronteira" ? "Fronteira" : "Amazônia Legal") : "";
            const num = formatarTelefone(decifrar(r.wa_cipher, `wa:${r.id}`) ?? "");
            return (
              <tr key={r.id}>
                <td data-l="Categoria">{CAT[r.category] ?? r.category}</td><td data-l="Nome">{r.name}</td><td data-l="Instituição">{r.inst ?? ""}</td>
                <td data-l="Cargo">{r.role === "docente" ? "Docente" : r.role === "tae" ? "TAE" : ""}</td><td data-l="AL/Fronteira">{reg}</td><td data-l="Campus">{r.campus ?? ""}</td>
                <td data-l="Cidade/UF">{r.category === "apoiador" ? [r.city, r.uf].filter(Boolean).join("/") : ""}</td><td data-l="País">{r.category === "estrangeiro" ? r.country ?? "" : r.country === "BR" ? "Brasil" : ""}</td>
                <td data-l="WhatsApp">{num}</td><td data-l="Situação">{r.status === "confirmed" ? (r.wa_confirmed_at ? "confirmada (WhatsApp)" : "confirmada") : "aguardando"}</td><td data-l="Última msg">{r.ultima ?? ""}</td>
              </tr>);
          })}
          {rows.length === 0 ? <tr><td colSpan={11}>Nenhum destinatário.</td></tr> : null}
        </tbody></table></div>
      <h2>Mensagens enviadas</h2>
      <p>{msgs.length ? msgs.map((m) => `${m.status}: ${m.n}`).join(" · ") : "Nenhuma mensagem enviada."}</p>
    </div>
    </main>
  );
}
