import test from "node:test";
import assert from "node:assert/strict";
import { query } from "./db";
import { hmac } from "./security";
import { cifrar } from "./crypto-dados";
import { CSV_CABECALHO, entregasCsv, listarEntregas } from "./mail/entregas";
import { brevoEngagement, mailersendEngagement, sendpulseEngagement, sendpulseWebhookToEngaj, storeEngagement, resumoEngajamento } from "./mail/engajamento";

const fake = (resp: (u: string) => unknown): typeof fetch => (async (u: any) => ({ ok: true, status: 200, json: async () => resp(String(u)) })) as any;

test("Brevo: converte entregue/aberto/clique e pagina", async () => {
  const ev = await brevoEngagement("k", 30, fake((u) => ({ events: /event=opened/.test(u) ? [{ email: "A@x.com", date: "2026-11-01T10:00:00Z" }] : /event=clicks/.test(u) ? [] : [{ email: "a@x.com", date: "2026-11-01T09:00:00Z" }, { email: "b@x.com", date: "2026-11-01T09:00:00Z" }] })));
  assert.deepEqual(ev.map((e) => e.kind + ":" + e.email), ["delivered:a@x.com", "delivered:b@x.com", "opened:a@x.com"]);
});

test("MailerSend: usa o tipo do evento", async () => {
  const ev = await mailersendEngagement("t", 30, fake((u) => /domains/.test(u) ? { data: [{ id: "d1" }] } : { data: [{ type: "opened", created_at: "2026-11-01T10:00:00Z", email: { recipient: { email: "C@x.com" } } }, { type: "sent", created_at: "2026-11-01T10:00:00Z", email: { recipient: { email: "z@x.com" } } }] }));
  assert.deepEqual(ev.map((e) => e.kind + ":" + e.email), ["opened:c@x.com"]);
});

test("resumo: melhor sinal por pendente; mantém o primeiro horário", async () => {
  const { hmac } = await import("./security");
  const dom = "@eng-teste.example", criada = "2026-11-02T10:00:00.000Z";
  const limpa = async () => { await query("DELETE FROM mail_engagement WHERE email LIKE $1", ["%" + dom]); await query("DELETE FROM signatures WHERE email LIKE $1", ["%" + dom]); await query("DELETE FROM mail_events WHERE email LIKE $1", ["%" + dom]); };
  await limpa();
  try {
    const mk = async (n: string) => query("INSERT INTO signatures(name,email,email_hash,category,text_version,consent_at,status,created_at,token_hash,token_expires_at) VALUES($1,$2,$3,'apoiador','v',$4,'pending',$4,$5,'2099-01-01T00:00:00Z')", [`P ${n}`, n + dom, hmac("eng" + n), criada, "tk" + n]);
    const antes = await resumoEngajamento();
    for (const n of ["clique", "abriu", "entregue", "devolvido", "nada"]) await mk(n);
    const t = (k: string, kind: "delivered" | "opened" | "clicked", ts = "2026-11-01T09:00:00Z") => ({ provider: "brevo", email: k + dom, kind, ts });
    await storeEngagement([t("clique", "delivered"), t("clique", "opened"), t("clique", "clicked"), t("abriu", "delivered"), t("abriu", "opened"), t("entregue", "delivered"), t("entregue", "delivered", "2026-11-02T09:00:00Z")]);
    await query("INSERT INTO mail_events(ts,provider,type,email,reason) VALUES(now(),'brevo','hard_bounce',$1,'x')", ["devolvido" + dom]);
    const d = await resumoEngajamento();
    assert.equal(d.pendentes - antes.pendentes, 5);
    assert.equal(d.clicou - antes.clicou, 1);
    assert.equal(d.abriu - antes.abriu, 1);
    assert.equal(d.entregueSemAbrir - antes.entregueSemAbrir, 1);
    assert.equal(d.devolvido - antes.devolvido, 1);
    assert.equal(d.semRegistro - antes.semRegistro, 1);
    const e = (await query<any>("SELECT delivered_at FROM mail_engagement WHERE email=$1", ["entregue" + dom])).rows[0];
    assert.equal(new Date(e.delivered_at).toISOString(), "2026-11-01T09:00:00.000Z");
  } finally { await limpa(); }
});

import { sesToEngajamento, brevoWebhookToEngaj, mailersendWebhookToEngaj } from "./mail/engajamento";
test("webhooks: SES, Brevo e MailerSend viram entrega/abertura/clique", () => {
  assert.deepEqual(sesToEngajamento({ eventType: "Open", mail: { destination: ["A@x.com"], timestamp: "2026-11-05T10:00:00Z" }, open: { timestamp: "2026-11-05T10:05:00Z" } }), [{ provider: "ses", email: "a@x.com", kind: "opened", ts: "2026-11-05T10:05:00.000Z" }]);
  assert.equal(sesToEngajamento({ eventType: "Delivery", mail: { destination: ["a@x.com", "b@x.com"] }, delivery: { timestamp: "2026-11-05T10:00:00Z" } }).length, 2);
  assert.equal(sesToEngajamento({ eventType: "Bounce", mail: { destination: ["a@x.com"] } }).length, 0);
  assert.equal(brevoWebhookToEngaj({ event: "click", email: "C@x.com", ts_event: 1793849000 })[0].kind, "clicked");
  assert.equal(brevoWebhookToEngaj({ event: "unique_opened", email: "c@x.com" })[0].kind, "opened");
  assert.equal(brevoWebhookToEngaj({ event: "request", email: "c@x.com" }).length, 0);
  assert.equal(mailersendWebhookToEngaj({ type: "activity.delivered", data: { email: { recipient: { email: "D@x.com" } }, created_at: "2026-11-05T10:00:00Z" } })[0].email, "d@x.com");
  assert.equal(mailersendWebhookToEngaj({ type: "activity.sent", data: { email: { recipient: { email: "d@x.com" } } } }).length, 0);
});

test("SendPulse (API): só código 2xx vira entregue", async () => {
  const ev = await sendpulseEngagement("t", 30, fake(() => [
    { recipient: "A@x.com", smtp_answer_code: 250, send_date: "2026-11-05 12:00:00" },
    { recipient: "b@x.com", smtp_answer_code: 550, send_date: "2026-11-05 12:01:00" },
    { recipient: "c@x.com", smtp_answer_code: 451, send_date: "2026-11-05 12:02:00" },
  ]));
  assert.deepEqual(ev.map((e) => e.kind + ":" + e.email), ["delivered:a@x.com"]);
  assert.equal(ev[0].ts, "2026-11-05T12:00:00.000Z");
});

test("SendPulse (webhook): entregue, aberto e clique; ignora o resto", () => {
  const k = (b: any) => sendpulseWebhookToEngaj(b).map((e) => e.kind + ":" + e.email);
  assert.deepEqual(k({ event: "delivered", email: "A@x.com", timestamp: 1793884728 }), ["delivered:a@x.com"]);
  assert.deepEqual(k({ event: "opened", email: "a@x.com" }), ["opened:a@x.com"]);
  assert.deepEqual(k({ event: "clicked", email: "a@x.com" }), ["clicked:a@x.com"]);
  assert.deepEqual(k({ event: "undelivered", email: "a@x.com" }), []);
  assert.deepEqual(k({ event: "hard_bounced", email: "a@x.com" }), []);
  assert.deepEqual(k({ event: "opened" }), []);
  assert.equal(sendpulseWebhookToEngaj({ event: "delivered", email: "a@x.com", timestamp: 1793884728 })[0].ts, new Date(1793884728 * 1000).toISOString());
});

// Fica neste arquivo (e não em outro) de propósito: o node --test roda arquivos em paralelo no mesmo banco, e este teste cria um cadastro pendente que o teste de resumo acima contaria.
const DOM = "@entregas-teste.example";
const limpa = async () => {
  await query("DELETE FROM mail_engagement WHERE email LIKE $1", ["%" + DOM]);
  await query("DELETE FROM mail_events WHERE email LIKE $1", ["%" + DOM]);
  await query("DELETE FROM mail_log WHERE to_addr LIKE $1", ["%" + DOM]);
  await query("DELETE FROM signatures WHERE email LIKE $1", ["%" + DOM]);
};

test("entregas: traz nome e dados cadastrais, nunca CPF/IP/token; sem cadastro sai sem nome", async () => {
  await limpa();
  try {
    const ins = async (nome: string, mail: string, status: string, extra: { wa?: boolean } = {}) => {
      const r = await query<{ id: number }>(
        `INSERT INTO signatures(name,email,email_hash,cpf_hash,category,institution,role,campus,city,uf,text_version,consent_at,ip,user_agent,status,token_hash,confirmed_at,created_at)
         VALUES($1,$2,$3,$4,'servidor','UNIR','Professora','Campus Porto Velho','Porto Velho','RO','v','2026-11-01T10:00:00Z','203.0.113.9','agente-secreto',$5,$6,$7,'2026-11-01T10:00:00.000Z') RETURNING id`,
        [nome, mail, hmac("e:" + mail), hmac("c:" + mail), status, "token-" + mail, status === "confirmed" ? "2026-11-02T10:00:00.000Z" : null]);
      if (extra.wa) await query("UPDATE signatures SET wa_cipher=$2, wa_optin_at=now() WHERE id=$1", [r.rows[0].id, cifrar("+5569999990000", `wa:${r.rows[0].id}`)]);
      return r.rows[0].id;
    };
    await ins("Maria Fictícia", "maria" + DOM, "pending", { wa: true });
    await ins("João Fictício", "joao" + DOM, "confirmed");
    for (const m of ["maria", "joao", "avulso"]) await query("INSERT INTO mail_log(kind,provider,to_addr,status) VALUES('confirmacao','ses',$1,'sent')", [m + DOM]);
    await query("INSERT INTO mail_engagement(provider,email,delivered_at,opened_at) VALUES('mailersend',$1,now(),now())", ["maria" + DOM]);
    await query("INSERT INTO mail_events(ts,provider,type,email,reason) VALUES(now(),'ses','hard_bounce',$1,'caixa inexistente')", ["joao" + DOM]);

    const r = await listarEntregas({ busca: DOM.slice(1) });
    assert.equal(r.total, 3);
    const por = (m: string) => r.linhas.find((l) => l.email === m + DOM)!;
    const maria = por("maria");
    assert.equal(maria.nome, "Maria Fictícia");
    assert.equal(maria.instituicao, "UNIR"); assert.equal(maria.cargo, "Professora"); assert.equal(maria.cidadeUf, "Porto Velho/RO");
    assert.equal(maria.cadastro, "aguardando"); assert.equal(maria.situacao, "abriu"); assert.equal(maria.whatsapp, "+5569999990000");
    assert.equal(por("joao").situacao, "devolvido"); assert.equal(por("joao").devolucaoMotivo, "caixa inexistente"); assert.equal(por("joao").whatsapp, "");
    assert.equal(por("avulso").nome, ""); assert.equal(por("avulso").cadastro, ""); assert.equal(por("avulso").situacao, "sem_registro");

    const tudo = JSON.stringify(r.linhas) + (await entregasCsv({ busca: DOM.slice(1) })).csv;
    for (const proibido of ["203.0.113.9", "agente-secreto", "token-", hmac("c:maria" + DOM), "cpf_hash"]) assert.ok(!tudo.includes(proibido), "vazou: " + proibido);
    assert.ok(!CSV_CABECALHO.some((c) => /cpf|^ip$|agent|token/.test(c)));
    assert.ok(!Object.keys(maria).some((k) => /cpf|^ip$|agent|token/i.test(k)));

    assert.equal((await listarEntregas({ busca: DOM.slice(1), situacao: "devolvido" })).total, 1);
    assert.equal((await listarEntregas({ busca: DOM.slice(1), cadastro: "sem" })).total, 1);
    assert.equal((await listarEntregas({ busca: "maria fict" })).linhas[0]?.email, "maria" + DOM);
    assert.equal((await listarEntregas({ busca: DOM.slice(1), provedor: "ses", limite: 2 })).linhas.length, 2);
    assert.equal((await listarEntregas({ busca: DOM.slice(1), limite: 2, pagina: 2 })).linhas.length, 1);
    assert.equal((await listarEntregas({ busca: DOM.slice(1), provedor: "nenhum" })).total, 0);
  } finally { await limpa(); }
});
