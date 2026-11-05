import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";

test("SendPulse: OAuth uma vez, HTML em Base64, remetente, cópia oculta, anexo e erros", async () => {
  const { sendSendpulseWith, _clearSendpulseToken, deliver } = await import("./mail");
  _clearSendpulseToken();
  const calls: { url: string; body: any; auth?: string }[] = [];
  const fake = (async (url: string, init: any) => {
    const body = JSON.parse(init.body); calls.push({ url, body, auth: init.headers?.Authorization });
    if (url.endsWith("/oauth/access_token")) return new Response(JSON.stringify({ access_token: "TOK", expires_in: 3600 }), { status: 200 });
    return new Response(JSON.stringify({ result: true, id: "abc" }), { status: 200 });
  }) as unknown as typeof fetch;
  const m = { to: "pessoa@exemplo.org", bcc: ["c@exemplo.org"], replyTo: "r@exemplo.org", subject: "Olá", text: "texto", html: "<p>Olá, João</p>", attachments: [{ filename: "a.pdf", content: Buffer.from("PDF") }] };
  await sendSendpulseWith(fake, { id: "ID", secret: "SEC" }, m, 'Petição PLV 12/2026 <assinatura@notifica.sancionaintegral.org>');
  await sendSendpulseWith(fake, { id: "ID", secret: "SEC" }, { to: "b@exemplo.org", subject: "x", text: "y" }, "assinatura@notifica.sancionaintegral.org");
  assert.equal(calls.filter((c) => c.url.endsWith("/oauth/access_token")).length, 1, "token reaproveitado");
  const send = calls.filter((c) => c.url.endsWith("/smtp/emails"));
  assert.equal(send.length, 2); assert.equal(send[0].auth, "Bearer TOK");
  const e = send[0].body.email;
  assert.equal(e.from.email, "assinatura@notifica.sancionaintegral.org"); assert.equal(e.from.name, "Petição PLV 12/2026");
  assert.equal(Buffer.from(e.html, "base64").toString("utf8"), "<p>Olá, João</p>");
  assert.deepEqual([e.to[0].email, e.bcc[0].email, e.reply_to.email, e.text], ["pessoa@exemplo.org", "c@exemplo.org", "r@exemplo.org", "texto"]);
  assert.equal(Buffer.from(e.attachments_binary["a.pdf"], "base64").toString(), "PDF");
  // recusas: autenticação e HTTP de erro viram exceção (a cadeia passa ao próximo provedor)
  _clearSendpulseToken();
  await assert.rejects(sendSendpulseWith((async () => new Response("{}", { status: 401 })) as unknown as typeof fetch, { id: "x", secret: "y" }, m, "a@b.org"), /autenticação recusada/);
  _clearSendpulseToken();
  const err = (async (url: string) => (url.endsWith("access_token") ? new Response(JSON.stringify({ access_token: "T" }), { status: 200 }) : new Response("quota", { status: 400 }))) as unknown as typeof fetch;
  await assert.rejects(sendSendpulseWith(err, { id: "x", secret: "y" }, m, "a@b.org"), /SendPulse respondeu 400/);
  // na cadeia: Brevo recusa → SendPulse entrega, com o remetente do próprio subdomínio
  const log: string[] = [];
  const out = await deliver(m, ["brevo", "sendpulse", "ses"], { brevo: async () => { throw new Error("cota"); }, sendpulse: async (_m: unknown, from: string) => { log.push(from); }, ses: async () => { log.push("ses"); } } as never, (p) => `${p}@dominio.test`);
  assert.equal(out, "sendpulse"); assert.deepEqual(log, ["sendpulse@dominio.test"]);
});

test("MailerSend: corpo, remetente, cópia oculta, anexo e erro HTTP (na cadeia, cai no próximo)", async () => {
  const { sendMailersendWith, deliver } = await import("./mail");
  let seen: any; let auth = "";
  const ok = (async (_u: string, init: any) => { seen = JSON.parse(init.body); auth = init.headers.Authorization; return new Response(null, { status: 202 }); }) as unknown as typeof fetch;
  await sendMailersendWith(ok, "mlsn.x", { to: "p@exemplo.org", bcc: ["c@exemplo.org"], replyTo: "r@exemplo.org", subject: "Olá", text: "t", html: "<b>h</b>", attachments: [{ filename: "a.pdf", content: Buffer.from("PDF") }] }, "Petição PLV 12/2026 <assinatura@envia.sancionaintegral.org>");
  assert.equal(auth, "Bearer mlsn.x");
  assert.deepEqual([seen.from.email, seen.from.name, seen.to[0].email, seen.bcc[0].email, seen.reply_to.email, seen.html], ["assinatura@envia.sancionaintegral.org", "Petição PLV 12/2026", "p@exemplo.org", "c@exemplo.org", "r@exemplo.org", "<b>h</b>"]);
  assert.equal(Buffer.from(seen.attachments[0].content, "base64").toString(), "PDF");
  await assert.rejects(sendMailersendWith((async () => new Response("limite", { status: 429 })) as unknown as typeof fetch, "x", { to: "p@exemplo.org", subject: "s", text: "t" }, "a@b.org"), /MailerSend respondeu 429/);
  const out = await deliver({ to: "p@exemplo.org", subject: "s", text: "t" }, ["brevo", "mailersend"], { brevo: async () => { throw new Error("cota"); }, mailersend: async () => {} } as never, (p) => p);
  assert.equal(out, "mailersend");
});
