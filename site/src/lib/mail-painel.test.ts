import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";

const resp = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { "content-type": "application/json" } });

test("painel de e-mails: registro por provedor/tipo, devoluções de todos os provedores, supressão, sem e-mail entregue, saúde do SES e verificações", async () => {
  const dbmod = await import("./db"); await dbmod._openForTests("t_mail_painel");
  const { query } = dbmod;
  const { deliver } = await import("./mail");
  const { attemptLogger, logQueued } = await import("./mail/log");
  const ev = await import("./mail/events");
  const st = await import("./mail/status");
  const pn = await import("./mail/painel");
  const { isSuppressed } = await import("./mail/suppression");
  const { logCheck } = await import("./email-check-log");
  const wait = () => new Promise((r) => setTimeout(r, 600));
  // O log de tentativas é gravado em segundo plano: espera pelas linhas (até 10 s) em vez de um tempo fixo, que falhava com a máquina carregada.
  const esperaLog = async (n: number) => { for (let i = 0; i < 100; i++) { if ((await query<{ c: number }>("SELECT COUNT(*)::int c FROM mail_log")).rows[0].c >= n) return; await new Promise((r) => setTimeout(r, 100)); } };

  // 1/4) cada tentativa fica registrada com provedor, tipo e remetente; falha de um provedor e sucesso do seguinte
  const m = { to: "Pessoa@Exemplo.org", subject: "s", text: "t" };
  await deliver(m, ["ses", "sendpulse"], { ses: async () => { throw new Error("cota excedida"); }, sendpulse: async () => {} } as never, (p: string, k?: string) => `Nome <${k}@${p}.sancionaintegral.org>`, "confirmacao", attemptLogger(m, "confirmacao"));
  logQueued({ to: "fila@exemplo.org" }, "confirmacao", "todos falharam");
  await esperaLog(3);
  const log = (await query<any>("SELECT provider,status,kind,to_addr,from_addr FROM mail_log ORDER BY id")).rows;
  assert.deepEqual(log.map((l: any) => `${l.provider}:${l.status}`).sort(), ["fila:queued", "sendpulse:sent", "ses:failed"]);
  assert.equal(log.find((l: any) => l.provider === "ses").to_addr, "pessoa@exemplo.org");
  const prov = await pn.porProvedor(); assert.equal(prov.find((p) => p.provider === "sendpulse")!.sent7, 1); assert.equal(prov.find((p) => p.provider === "ses")!.failed7, 1);
  assert.equal((await pn.porTipo())[0].kind, "confirmacao");
  assert.ok((await pn.porSubdominio()).some((d) => d.dominio === "sendpulse.sancionaintegral.org"));

  // 3) coletores: Brevo, SendPulse, MailerSend e Mailrelay normalizam os eventos; duplicados não entram duas vezes
  const hoje = new Date().toISOString();
  const fake = (async (url: string) => {
    if (url.includes("api.brevo.com") && url.includes("event=hardBounces")) return resp({ events: [{ email: "Duro@Exemplo.org", date: hoje, reason: "550 5.1.1 caixa inexistente" }] });
    if (url.includes("api.brevo.com")) return resp({ events: [] });
    if (url.endsWith("/oauth/access_token")) return resp({ access_token: "T" });
    if (url.includes("sendpulse.com/smtp/emails")) return resp([{ recipient: "sp5@exemplo.org", send_date: "2026-11-04 10:00:00", smtp_answer_code: 550, smtp_answer_code_explain: "User unknown" }, { recipient: "sp4@exemplo.org", send_date: "2026-11-04 10:01:00", smtp_answer_code: 451 }, { recipient: "ok@exemplo.org", send_date: "2026-11-04 10:02:00", smtp_answer_code: 250 }]);
    if (url.includes("mailersend.com/v1/domains")) return resp({ data: [{ id: "d1", name: "envia.sancionaintegral.org" }] });
    if (url.includes("mailersend.com/v1/activity")) return resp({ data: [{ type: "hard_bounced", created_at: hoje, email: { recipient: { email: "ms@exemplo.org" } } }, { type: "spam_complaint", created_at: hoje, email: { recipient: { email: "reclama@exemplo.org" } } }] });
    if (url.includes("ipzmarketing.com")) return resp([{ email: "mr@exemplo.org", status: "bounced", bounced_at: hoje, bounce_message: "mailbox full" }, { email: "mr2@exemplo.org", status: "delivered" }]);
    return resp({}, 404);
  }) as unknown as typeof fetch;
  const rep = await ev.pollProviders(3, fake, { brevo: "k", sendpulse: "id\nsec", mailersend: "t", mailrelayP: { key: "k", host: "x.ipzmarketing.com" } });
  assert.deepEqual(Object.fromEntries(Object.entries(rep).map(([k, v]) => [k, v.ok])), { brevo: true, sendpulse: true, mailersend: true, mailrelaypresidente: true });
  const evs = (await query<any>("SELECT provider,type,email FROM mail_events ORDER BY provider,email")).rows;
  assert.ok(evs.some((e: any) => e.provider === "brevo" && e.type === "hard_bounce" && e.email === "duro@exemplo.org"));
  assert.ok(evs.some((e: any) => e.provider === "sendpulse" && e.type === "hard_bounce" && e.email === "sp5@exemplo.org"));
  assert.ok(evs.some((e: any) => e.provider === "sendpulse" && e.type === "soft_bounce" && e.email === "sp4@exemplo.org"));
  assert.ok(!evs.some((e: any) => e.email === "ok@exemplo.org"), "entregue não é evento");
  assert.ok(evs.some((e: any) => e.provider === "mailersend" && e.type === "complaint"));
  // supressão automática: permanentes e reclamação suprimem; soft não
  assert.equal(await isSuppressed("duro@exemplo.org"), true); assert.equal(await isSuppressed("reclama@exemplo.org"), true); assert.equal(await isSuppressed("sp4@exemplo.org"), false);
  const again = await ev.pollProviders(3, fake, { brevo: "k", sendpulse: "id\nsec", mailersend: "t", mailrelayP: { key: "k", host: "x.ipzmarketing.com" } });
  assert.equal(Object.values(again).reduce((n, v) => n + (v.novos ?? 0), 0), 0, "sem duplicar");
  // um provedor com erro não derruba os outros
  const quebrado = (async (url: string) => (url.includes("brevo") ? resp({}, 500) : fake(url, {} as never))) as unknown as typeof fetch;
  const r3 = await ev.pollProviders(3, quebrado, { brevo: "k", sendpulse: null, mailersend: "t", mailrelayP: null });
  assert.equal(r3.brevo.ok, false); assert.equal(r3.mailersend.ok, true);

  // SES pelo webhook: permanente, transitório e reclamação entram na mesma tabela
  const sesEv = ev.sesToEvents({ eventType: "Bounce", bounce: { bounceType: "Permanent", timestamp: hoje, bouncedRecipients: [{ emailAddress: "ses1@exemplo.org", diagnosticCode: "550" }] } });
  sesEv.push(...ev.sesToEvents({ eventType: "Bounce", bounce: { bounceType: "Transient", timestamp: hoje, bouncedRecipients: [{ emailAddress: "ses2@exemplo.org" }] } }), ...ev.sesToEvents({ eventType: "Complaint", complaint: { timestamp: hoje, complainedRecipients: [{ emailAddress: "ses3@exemplo.org" }] } }));
  await ev.storeEvents(sesEv);
  assert.deepEqual((await pn.eventosResumo()).filter((e) => e.provider === "ses").map((e) => e.type).sort(), ["complaint", "hard_bounce", "soft_bounce"]);

  // 5) saúde do SES: poucos envios = sem dados; com envios e devoluções acima de 5% = risco
  assert.equal((await pn.sesSaude()).nivel, "sem_dados");
  for (let i = 0; i < 40; i++) await query("INSERT INTO mail_log(kind,provider,to_addr,status) VALUES('confirmacao','ses',$1,'sent')", [`x${i}@exemplo.org`]);
  const h = await pn.sesSaude();
  assert.deepEqual([h.enviados7, h.hard7, h.soft7, h.reclamacoes7], [40, 1, 1, 1]);
  assert.equal(h.nivel, "risco"); // 1 reclamação em 40 envios (2,5%) passa muito de 0,1%
  await query("DELETE FROM mail_events WHERE provider='ses' AND type='complaint'");
  assert.equal((await pn.sesSaude()).nivel, "atencao"); // 1 devolução permanente em 40 = 2,5%: atenção (a revisão da Amazônia é a 5%)
  await ev.storeEvents([{ ts: hoje, provider: "ses", type: "hard_bounce", email: "mais1@exemplo.org", reason: "x", source: "webhook" }, { ts: hoje, provider: "ses", type: "hard_bounce", email: "mais2@exemplo.org", reason: "x", source: "webhook" }]);
  assert.equal((await pn.sesSaude()).nivel, "risco"); // 3 em 40 = 7,5%

  // 6) cadastros pendentes sem e-mail entregue
  const mk = (email: string, n: number) => query("INSERT INTO signatures(name,email,email_hash,category,text_version,consent_at,status) VALUES($1,$2,$3,'apoiador','v','2026-11-04T00:00:00Z','pending')", [`Pessoa ${n}`, email, `h${n}`]);
  await mk("duro@exemplo.org", 1); await mk("fila2@exemplo.org", 2); await mk("semenvio@exemplo.org", 3); await mk("pessoa@exemplo.org", 4);
  await query("INSERT INTO mail_outbox(kind,to_addr,payload,status) VALUES('confirmacao','fila2@exemplo.org','{}','pending')");
  const sem = await pn.semEmailEntregue();
  const por = Object.fromEntries(sem.map((s) => [s.email, s.motivo]));
  assert.equal(por["duro@exemplo.org"], "devolvido"); assert.equal(por["fila2@exemplo.org"], "na fila"); assert.equal(por["semenvio@exemplo.org"], "sem envio");
  assert.equal(por["pessoa@exemplo.org"], undefined, "este recebeu pelo SendPulse e só não clicou");

  // 2/7) saldos e respostas pela API de cada serviço
  const status = (async (url: string) => {
    if (url.includes("brevo.com/v3/account")) return resp({ plan: [{ type: "payAsYouGo", credits: 0 }, { type: "subscription", credits: 12, endDate: "2026-11-21" }] });
    if (url.includes("brevo.com")) return resp({ requests: 100, delivered: 90, hardBounces: 5, softBounces: 5 });
    if (url.endsWith("/oauth/access_token")) return resp({ access_token: "T" });
    if (url.includes("balance/detail")) return resp({ smtp: { email_qty_left: 49000, email_qty: 50000, qty_per_hour: 5000, end_date: "2026-12-04" } });
    if (url.includes("api-quota")) return resp({ quota: 100, remaining: 90, reset: "2026-11-05T00:00:00Z" });
    if (url.includes("graphql")) return resp({ data: { viewer: { zones: [{ emailRoutingAdaptiveGroups: [{ count: 7, dimensions: { status: "delivered", isSpam: 0, isNDR: 0 } }, { count: 2, dimensions: { status: "delivered", isSpam: 1, isNDR: 0 } }, { count: 1, dimensions: { status: "rejected", isSpam: 0, isNDR: 0 } }] }] } }, errors: null });
    return resp({}, 404);
  }) as unknown as typeof fetch;
  await st.refreshProviderStatus(status, { brevo: "k", sendpulse: "id\nsec", mailersend: "t", mailrelayP: null });
  await st.refreshReplies(status, "tok", "zona");
  const ps = await pn.statusProvedores();
  assert.equal(ps.brevo.data.creditos, 12); assert.equal(ps.sendpulse.data.restantes, 49000); assert.equal(ps.mailersend.data.restantes, 90); assert.equal(ps.ses.data.cotaDia, 50000);
  assert.deepEqual([ps.respostas.data.total, ps.respostas.data.entregues, ps.respostas.data.spam, ps.respostas.data.rejeitadas], [10, 7, 2, 1]);
  await st.refreshReplies(status, "", "zona"); assert.equal((await pn.statusProvedores()).respostas.data.ok, false); // sem token: avisa que falta configurar

  // verificações (Reacher pelas sondas de cabanos.cc e MX)
  logCheck("reacher", "a@unir.br", "indisponivel", 4000); logCheck("reacher", "b@unir.br", "indisponivel", 4001); logCheck("reacher", "c@gmail.com", "aceito", 800); logCheck("mx", "d@x.org", "ok", 12);
  await wait();
  const ck = await pn.verificacoes(); assert.ok(ck.some((c) => c.via === "reacher" && c.verdict === "indisponivel" && c.n7 === 2));
  assert.deepEqual((await pn.dominiosLentos())[0], { dominio: "unir.br", n: 2 });
});
