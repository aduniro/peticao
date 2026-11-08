import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";

const mail = { to: "a@b.org", subject: "x", text: "y" };

test("cadeia de e-mail: usa o primeiro que funciona, cai para o próximo se falhar, cada um com o seu From", async () => {
  const { deliver } = await import("./mail");
  const calls: string[] = [];
  const mk = (name: string, fail: boolean) => async (_m: unknown, from: string) => { calls.push(`${name}:${from}`); if (fail) throw new Error(`${name} fora do ar`); };
  const fromFor = (p: string) => `X <a@${p}.sancionaintegral.org>`;
  assert.equal(await deliver(mail, ["ses", "brevo"], { ses: mk("ses", false), brevo: mk("brevo", false) }, fromFor), "ses");
  assert.deepEqual(calls, ["ses:X <a@ses.sancionaintegral.org>"]);
  calls.length = 0;
  assert.equal(await deliver(mail, ["ses", "brevo"], { ses: mk("ses", true), brevo: mk("brevo", false) }, fromFor), "brevo");
  assert.deepEqual(calls, ["ses:X <a@ses.sancionaintegral.org>", "brevo:X <a@brevo.sancionaintegral.org>"]);
});

test("cadeia de e-mail: se todos falharem lança erro com o resumo (sem vazar segredos); provedor desconhecido é pulado", async () => {
  const { deliver } = await import("./mail");
  const boom = async () => { throw new Error("recusado"); };
  await assert.rejects(() => deliver(mail, ["ses", "xyz", "brevo"], { ses: boom, brevo: boom }, () => "F <f@x.org>"), (e: Error) => /ses: recusado/.test(e.message) && /xyz: provedor desconhecido/.test(e.message) && /brevo: recusado/.test(e.message));
});

test("config: MAIL_PROVIDERS define a ordem; MAIL_FROM_<PROVEDOR> tem prioridade sobre MAIL_FROM", async () => {
  const { config } = await import("./config");
  delete process.env.MAIL_PROVIDERS; process.env.MAIL_PROVIDER = "smtp";
  assert.deepEqual(config.mailProviders(), ["smtp"]);
  process.env.MAIL_PROVIDERS = " Brevo , ses ";
  assert.deepEqual(config.mailProviders(), ["brevo", "ses"]);
  process.env.MAIL_FROM = "Geral <g@x.org>"; process.env.MAIL_FROM_BREVO = "Brevo <b@confirma.x.org>";
  assert.equal(config.mailFromFor("brevo"), "Brevo <b@confirma.x.org>");
  assert.equal(config.mailFromFor("ses"), "Geral <g@x.org>");
  delete process.env.MAIL_PROVIDERS; delete process.env.MAIL_FROM_BREVO; delete process.env.MAIL_FROM; delete process.env.MAIL_PROVIDER;
});

test("Mailrelay: envia pela API do host da conta, com chave no cabeçalho, Reply-To e cópia oculta em envio separado; anexo recusa", async () => {
  const realFetch = globalThis.fetch;
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  globalThis.fetch = (async (url: string, init: any) => { calls.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return new Response("[]", { status: 201 }); }) as typeof fetch;
  process.env.MAILRELAY_HOST = "conta-x.ipzmarketing.com"; process.env.MAILRELAY_API_KEY = "SEGREDOMR";
  try {
    const { deliver } = await import("./mail");
    await deliver({ to: "a@b.org", bcc: ["c@d.org"], replyTo: "r@s.org", subject: "S", text: "T" }, ["mailrelay"], undefined, () => '"Sanção Integral" <assinatura@avisos.sancionaintegral.org>');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://conta-x.ipzmarketing.com/api/v1/send_emails");
    assert.equal(calls[0].headers["X-AUTH-TOKEN"], "SEGREDOMR");
    assert.deepEqual(calls[0].body.from, { name: "Sanção Integral", email: "assinatura@avisos.sancionaintegral.org" });
    assert.deepEqual(calls[0].body.to, [{ email: "a@b.org" }]);
    assert.deepEqual(calls[0].body.reply_to, { email: "r@s.org" });
    assert.deepEqual(calls[1].body.to, [{ email: "c@d.org" }]); // cópia oculta
    assert.ok(!JSON.stringify(calls.map((c) => c.url)).includes("SEGREDOMR"));
    await assert.rejects(() => deliver({ ...mail, attachments: [{ filename: "a.pdf", content: Buffer.from("x") }] }, ["mailrelay"], undefined, () => "F <f@avisos.x.org>"), /anexos não suportados/);
    process.env.MAILRELAY_HOST = "invalido.example.com";
    await assert.rejects(() => deliver(mail, ["mailrelay"], undefined, () => "F <f@x.org>"), /Mailrelay não configurado/);
  } finally { globalThis.fetch = realFetch; delete process.env.MAILRELAY_HOST; delete process.env.MAILRELAY_API_KEY; }
});
