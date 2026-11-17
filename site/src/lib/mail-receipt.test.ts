import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerId, receiptId, receiptJson, sesReceipt, mailrelayReceipt, smtpInfoReceipt, mailersendReceipt, objectReceiptId } from "./mail/receipt";
(process.env as Record<string, string>).NODE_ENV = "test";
const directory = mkdtempSync(join(tmpdir(), "peticao-receipt-")); after(() => rmSync(directory, { recursive: true, force: true }));
const mail = () => ({ to: "qa-receipt@example.test", subject: "QA receipt", text: "QA body" });
const sesId = "0100017352b73695-a103f18d-f0a3-4a48-9d86-db1df264a3fe-000000";
async function setup() { const db = await import("./db"); await db._openForTests("t_mail_receipt"); return { db, M: await import("./mail"), A: await import("./mail/archive"), R: await import("./mail/recorded") }; }
const scope = async (fn: () => Promise<void>) => {
  const keys = ["MAIL_PROVIDER", "MAIL_PROVIDERS", "MAIL_PROVIDERS_MARKETING", "MAIL_ARCHIVE_RETENTION", "PREVIEW_MODE", "SMTP_URL", "BREVO_API_KEY", "MAILERSEND_API_TOKEN", "SENDPULSE_CLIENT_ID", "SENDPULSE_CLIENT_SECRET", "MAILRELAY_API_KEY", "MAILRELAY_HOST", "MAILRELAY_PRESIDENTE_API_KEY", "MAILRELAY_PRESIDENTE_HOST", "MAIL_OUTBOX_DIR", "MAIL_FROM_MAILRELAYPRESIDENTE_MARKETING"];
  const saved = new Map(keys.map(k => [k, process.env[k]])), previousFetch = globalThis.fetch;
  delete process.env.PREVIEW_MODE; delete process.env.MAIL_PROVIDERS; delete process.env.MAIL_ARCHIVE_RETENTION; process.env.MAIL_PROVIDER = "dev"; process.env.MAIL_OUTBOX_DIR = directory;
  try { await fn(); } finally { globalThis.fetch = previousFetch; for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
};
async function close(c: Awaited<ReturnType<typeof setup>>) { await c.M.waitForBackgroundMail(); await c.db._closeDbForTests(); }

test("recibos validam ID opaco e destinatário; Message-ID local nunca vira ID SES", () => {
  assert.equal(providerId("<qa-id@relay.test>"), "<qa-id@relay.test>");
  for (const raw of [undefined, null, 123, "", "a".repeat(201), "id\r\nSECRET", "{secret}", "<script>alert(1)</script>"]) assert.equal(providerId(raw), undefined);
  assert.equal(receiptId({ get providerId() { throw new Error("fixture"); } }), undefined);
  assert.equal(smtpInfoReceipt({ get response() { throw new Error("fixture"); } }), undefined);
  assert.equal(mailersendReceipt({ get headers() { throw new Error("fixture"); } } as unknown as Response), undefined);
  assert.equal(objectReceiptId({ get messageId() { throw new Error("fixture"); } },"messageId"), undefined);
  assert.equal(sesReceipt(`250 Ok ${sesId}`), sesId); assert.equal(sesReceipt("250 queued as local-id"), undefined); assert.equal(sesReceipt("<local-id@example.test>"), undefined);
  assert.equal(mailrelayReceipt([{ id: 42, email: "QA-RECEIPT@EXAMPLE.TEST" }], mail().to), "42");
  for (const raw of [[], [{ id: 42, email: "other@example.test" }], [{ id: 42, email: mail().to }, { id: 43, email: mail().to }], [{ id: Number.MAX_SAFE_INTEGER + 1, email: mail().to }], [{ id: "42", email: mail().to }]]) assert.equal(mailrelayReceipt(raw, mail().to), undefined);
});

test("corpo de metadados é limitado por bytes/prazo e erro de leitura não lança falha de envio", async () => {
  assert.deepEqual(await receiptJson(new Response('{"messageId":"qa-id"}')), { messageId: "qa-id" });
  assert.equal(await receiptJson(new Response("invalid")), undefined); assert.equal(await receiptJson(new Response("a".repeat(100)), 20), undefined);
  assert.equal(await receiptJson(new Response(new ReadableStream({ start(controller) { controller.error(new Error("fixture stream")); } }))), undefined);
  let cancelled = false; const stalled = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  assert.equal(await receiptJson(stalled, 100, 10), undefined); assert.ok(cancelled);
});

test("transportes reais com HTTP fictício persistem somente IDs, mantendo guardas/canais e aceite separado de entrega", () => scope(async () => {
  const c = await setup(); try {
    Object.assign(process.env, { BREVO_API_KEY: "QA_KEY_DO_NOT_PERSIST", MAILERSEND_API_TOKEN: "QA_KEY_DO_NOT_PERSIST", SENDPULSE_CLIENT_ID: "QA_CLIENT", SENDPULSE_CLIENT_SECRET: "QA_KEY_DO_NOT_PERSIST", MAILRELAY_API_KEY: "QA_KEY_DO_NOT_PERSIST", MAILRELAY_HOST: "qa-integral.ipzmarketing.com", MAILRELAY_PRESIDENTE_API_KEY: "QA_KEY_DO_NOT_PERSIST", MAILRELAY_PRESIDENTE_HOST: "qa-presidente.ipzmarketing.com", MAIL_FROM_MAILRELAYPRESIDENTE_MARKETING: "QA Marketing <qa-marketing@example.test>" });
    c.M._clearSendpulseToken(); const calls: string[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push(url);
      if (url.includes("/oauth/access_token")) return new Response(JSON.stringify({ access_token: "QA_AUTH_DO_NOT_PERSIST", expires_in: 3600 }));
      if (url.includes("api.brevo.com")) return new Response(JSON.stringify({ messageId: "<qa-brevo@relay.test>", apiKey: "QA_KEY_DO_NOT_PERSIST" }), { status: 201 });
      if (url.includes("api.mailersend.com")) return new Response(null, { status: 202, headers: { "x-message-id": "qa-mailersend" } });
      if (url.includes("api.sendpulse.com")) return new Response(JSON.stringify({ result: true, id: "qa-sendpulse" }));
      if (url.includes("ipzmarketing.com")) return new Response(JSON.stringify([{ id: url.includes("presidente") ? 202 : 101, email: JSON.parse(init.body as string).to[0].email, secret: "QA_KEY_DO_NOT_PERSIST" }]), { status: 201 });
      throw new Error("Unexpected network endpoint");
    }) as typeof fetch;
    for (const provider of ["brevo", "mailersend", "sendpulse", "mailrelay", "mailrelaypresidente"]) {
      process.env.MAIL_PROVIDER = provider; process.env.MAIL_PROVIDERS_MARKETING = provider;
      assert.equal(await c.M.sendMail(mail(), "confirmacao", { queue: false, channel: provider === "mailrelaypresidente" ? "marketing" : "transactional" }), "sent"); await c.M.waitForBackgroundMail();
    }
    const attempts = (await c.db.query("SELECT provider,provider_id,state FROM mail_message_attempts ORDER BY started_at,id")).rows;
    assert.deepEqual(attempts.map(a => [a.provider, a.provider_id, a.state]), [["brevo", "<qa-brevo@relay.test>", "accepted"], ["mailersend", "qa-mailersend", "accepted"], ["sendpulse", "qa-sendpulse", "accepted"], ["mailrelay", "101", "accepted"], ["mailrelaypresidente", "202", "accepted"]]);
    const stored = JSON.stringify((await c.db.query("SELECT row_to_json(a) data FROM mail_message_attempts a UNION ALL SELECT row_to_json(m) FROM mail_messages m UNION ALL SELECT row_to_json(l) FROM mail_log l UNION ALL SELECT row_to_json(a) FROM audit_log a")).rows);
    assert.ok(!stored.includes("QA_KEY_DO_NOT_PERSIST")); assert.ok(!stored.includes("QA_AUTH_DO_NOT_PERSIST"));
    assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_engagement")).rows[0].n, 0); assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_outbox")).rows[0].n, 0); assert.ok((await c.db.verifyAuditChain()).ok);
    const before = calls.length; await assert.rejects(c.M.sendMail({ ...mail(), to: "qa@ministerio.gov.br" })); assert.equal(calls.length, before);
  } finally { await close(c); }
}));

test("ID ausente/inválido ou metadado quebrado após HTTP aceito nunca troca de provedor", () => scope(async () => {
  const c = await setup(); try {
    process.env.BREVO_API_KEY = "qa-fake-key"; let calls = 0;
    const responses = [new Response("{}", { status: 201 }), new Response('{"messageId":"bad\\nheader"}', { status: 201 }), new Response("not json", { status: 201 }), new Response("a".repeat(20000), { status: 201 }), new Response(new ReadableStream({ start(controller) { controller.error(new Error("fixture")); } }), { status: 201 })];
    globalThis.fetch = (async () => { calls++; return responses.shift()!; }) as typeof fetch;
    for (let i = 0; i < 5; i++) {
      const record = await c.A.prepareMessage(mail(), "confirmacao", "transactional");
      assert.equal(await c.M.deliver(mail(), ["brevo", "unknown-never-reached"], undefined, () => "QA <qa@example.test>", "confirmacao", undefined, { journal: c.R.journalFor(record.id, true) }), "brevo");
    }
    assert.equal(calls, 5); const attempts = (await c.db.query("SELECT state,provider_id FROM mail_message_attempts")).rows; assert.equal(attempts.length, 5); assert.ok(attempts.every(a => a.state === "accepted" && a.provider_id === null));
  } finally { await close(c); }
}));

test("Mailrelay guarda recibo do principal em falha posterior da cópia e não atribui ID da cópia ao principal", () => scope(async () => {
  const c = await setup(); try {
    process.env.MAILRELAY_HOST = "qa-integral.ipzmarketing.com"; process.env.MAILRELAY_API_KEY = "qa-fake-key"; let calls = 0;
    globalThis.fetch = (async (_url: string, init: RequestInit) => { calls++; const to = JSON.parse(init.body as string).to[0].email; return to === mail().to ? new Response(JSON.stringify([{ id: 901, email: to }]), { status: 201 }) : new Response("bcc refused", { status: 422 }); }) as typeof fetch;
    const record = await c.A.prepareMessage({ ...mail(), bcc: ["qa-copy@example.test"] }, "confirmacao", "transactional");
    await assert.rejects(c.M.deliver({ ...mail(), bcc: ["qa-copy@example.test"] }, ["mailrelay", "never"], undefined, () => "QA <qa@example.test>", "confirmacao", undefined, { singleAttempt: true, journal: c.R.journalFor(record.id, false) }), /422/);
    assert.equal(calls, 2); const row = (await c.db.query("SELECT provider_id,state FROM mail_message_attempts")).rows[0]; assert.deepEqual(row, { provider_id: "901", state: "indeterminate" });
    assert.equal((await c.A.messageMetadata(record.id))!.status, "indeterminate");
    globalThis.fetch = (async (_url: string, init: RequestInit) => { const to = JSON.parse(init.body as string).to[0].email; return new Response(JSON.stringify([{ id: to === mail().to ? 902 : 903, email: to }]), { status: 201 }); }) as typeof fetch;
    const second = await c.A.prepareMessage({ ...mail(), bcc: ["qa-copy@example.test"] }, "confirmacao", "transactional");
    assert.equal(await c.M.deliver({ ...mail(), bcc: ["qa-copy@example.test"] }, ["mailrelay"], undefined, () => "QA <qa@example.test>", "confirmacao", undefined, { journal: c.R.journalFor(second.id, true) }), "mailrelay");
    assert.equal((await c.db.query("SELECT provider_id FROM mail_message_attempts WHERE message_id=$1", [second.id])).rows[0].provider_id, "902");
  } finally { await close(c); }
}));

test("recibo conflitante ou getter quebrado não derruba aceite; failover mantém ID de cada tentativa", () => scope(async () => {
  const c = await setup(); try {
    for (const mode of ["conflict", "getter", "legacy"]) {
      const record = await c.A.prepareMessage(mail(), "confirmacao", "transactional"); let calls = 0;
      const senders = { first: async (_m: unknown, _f: string, report?: (r: { providerId: string }) => void) => { calls++; if (mode === "conflict") { report!({ providerId: "qa-first" }); return { providerId: "qa-second" }; } if (mode === "getter") return { get providerId(): string { throw new Error("fixture"); } }; }, never: async () => { calls++; } };
      assert.equal(await c.M.deliver(mail(), ["first", "never"], senders, () => "QA <qa@example.test>", "confirmacao", undefined, { journal: c.R.journalFor(record.id, true) }), "first"); assert.equal(calls, 1);
      assert.equal((await c.db.query("SELECT provider_id FROM mail_message_attempts WHERE message_id=$1", [record.id])).rows[0].provider_id, null);
    }
    const record = await c.A.prepareMessage(mail(), "confirmacao", "transactional");
    assert.equal(await c.M.deliver(mail(), ["first", "second"], { first: async (_m, _f, report) => { report!({ providerId: "qa-partial" }); throw new Error("transport uncertain"); }, second: async () => ({ providerId: "qa-second" }) }, () => "QA <qa@example.test>", "confirmacao", undefined, { journal: c.R.journalFor(record.id, true) }), "second");
    assert.deepEqual((await c.db.query("SELECT provider,provider_id,state FROM mail_message_attempts WHERE message_id=$1 ORDER BY started_at", [record.id])).rows.map(a => [a.provider, a.provider_id, a.state]), [["first", "qa-partial", "indeterminate"], ["second", "qa-second", "accepted"]]);
  } finally { await close(c); }
}));

test("SES só captura resposta do servidor AWS; SMTP genérico não usa Message-ID local e dev não fabrica ID", () => scope(async () => {
  const c = await setup(), nodemailer = (await import("nodemailer")).default, original = nodemailer.createTransport;
  try {
    nodemailer.createTransport = (() => ({ sendMail: async () => ({ messageId: "LOCAL_NOT_PROVIDER@example.test", response: `250 Ok ${sesId}` }) })) as never;
    for (const [provider, url, expected] of [["ses", "smtps://qa:fake@email-smtp.us-east-1.amazonaws.com:465", sesId], ["smtp", "smtps://qa:fake@email-smtp.us-east-1.amazonaws.com:465", null], ["ses", "smtp://qa:fake@smtp.example.test:25", null]] as const) {
      process.env.MAIL_PROVIDER = provider; process.env.SMTP_URL = url; assert.equal(await c.M.sendMail(mail(), "confirmacao", { queue: false }), "sent"); await c.M.waitForBackgroundMail();
      const latest = (await c.db.query("SELECT provider_id FROM mail_message_attempts ORDER BY started_at DESC LIMIT 1")).rows[0]; assert.equal(latest.provider_id, expected);
    }
    process.env.MAIL_PROVIDER = "dev"; assert.equal(await c.M.sendMail(mail()), "sent"); await c.M.waitForBackgroundMail(); assert.equal((await c.db.query("SELECT provider_id FROM mail_message_attempts WHERE provider='dev'")).rows[0].provider_id, null);
    assert.ok(!(JSON.stringify((await c.db.query("SELECT * FROM mail_message_attempts")).rows)).includes("LOCAL_NOT_PROVIDER"));
  } finally { nodemailer.createTransport = original; await close(c); }
}));


test("SendPulse conserva recusa result=false mesmo com ID; ausência de ID não fabrica recusa após aceite", () => scope(async () => {
  const M = await import("./mail"); M._clearSendpulseToken(); let accepted = false, authCalls = 0, sendCalls = 0;
  const fake = (async (url: string) => {
    if (url.endsWith("access_token")) { authCalls++; return new Response(JSON.stringify({ access_token: "QA_TOKEN_ONLY", expires_in: 3600 })); }
    sendCalls++; return new Response(JSON.stringify({ result: accepted, id: accepted ? "invalid\\nidentifier" : "qa-id-not-an-acceptance" }));
  }) as typeof fetch;
  await assert.rejects(M.sendSendpulseWith(fake, { id: "qa-client", secret: "qa-fake-key" }, mail(), "QA <qa@example.test>"), /result=false/);
  accepted = true; const receipt = await M.sendSendpulseWith(fake, { id: "qa-client", secret: "qa-fake-key" }, mail(), "QA <qa@example.test>");
  assert.equal(receipt.providerId, undefined); assert.equal(authCalls, 1); assert.equal(sendCalls, 2); M._clearSendpulseToken();
}));
