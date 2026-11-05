import test from "node:test";
import assert from "node:assert/strict";
import { normalizarTelefone, formatarTelefone, mascararTelefone } from "./whatsapp/telefone";
import { DDI_LISTA } from "./whatsapp/ddi";
import { waEstado, whatsappAtivo, mailersendWhatsapp, _setWaProviderForTests, type WaMsg } from "./whatsapp/provider";

test("telefone: Brasil, DDI colado, + e erros", () => {
  assert.deepEqual(normalizarTelefone("55", "(69) 99999-0000"), { ok: true, e164: "5569999990000", ddi: "55", nacional: "69999990000" });
  assert.equal((normalizarTelefone("+55", "069 99999-0000") as any).e164, "5569999990000");
  assert.equal((normalizarTelefone("55", "+55 69 99999-0000") as any).e164, "5569999990000");
  assert.equal((normalizarTelefone("55", "69 3222-0000") as any).code, "wa_br_mobile"); // fixo/10 dígitos
  assert.equal((normalizarTelefone("55", "69 89999-0000") as any).code, "wa_br_mobile"); // sem o 9
  assert.equal((normalizarTelefone("55", "123") as any).code, "wa_number_invalid");
  assert.equal((normalizarTelefone("999", "123456789") as any).code, "wa_ddi_invalid");
  assert.equal((normalizarTelefone("351", "912 345 678") as any).e164, "351912345678");
  assert.equal((normalizarTelefone("1", "202 555 0101") as any).e164, "12025550101");
  assert.equal((normalizarTelefone("1", "2025550") as any).code, "wa_number_invalid");
  assert.equal((normalizarTelefone("55", "69 99999-0000 ' OR 1=1") as any).ok, false);
  assert.equal(formatarTelefone("5569999990000"), "+55 69 99999-0000");
  assert.ok(!mascararTelefone("5569999990000").includes("999990"));
  assert.ok(DDI_LISTA.length > 150 && DDI_LISTA[0][0] === "BR");
});

test("provedor: desligado por padrão e payload do MailerSend", async () => {
  const antes = { ...process.env };
  delete process.env.WHATSAPP_ENABLED;
  assert.equal(whatsappAtivo(), false);
  assert.equal(waEstado().pronto, false);
  process.env.WHATSAPP_ENABLED = "1"; // só o interruptor não basta
  assert.equal(whatsappAtivo(), false);
  let visto: any;
  const f = (async (url: any, init: any) => { visto = { url: String(url), init, body: JSON.parse(init.body) }; return { status: 202, json: async () => ({ data: { id: "m1" } }), headers: new Headers() }; }) as any;
  const r = await mailersendWhatsapp("tok", "5569999990000", f).send({ to: "5511999990000", templateId: "tpl", body: ["Maria"], buttons: ["abc"] });
  assert.equal(r.id, "m1");
  assert.equal(visto.url, "https://api.mailersend.com/v1/whatsapp/send");
  assert.deepEqual(visto.body, { from: "5569999990000", to: ["5511999990000"], template_id: "tpl", personalization: [{ to: "5511999990000", data: { body: ["Maria"], buttons: ["abc"] } }] });
  assert.equal(visto.init.headers.Authorization, "Bearer tok");
  const ruim = (async () => ({ status: 422, json: async () => ({}), headers: new Headers() })) as any;
  await assert.rejects(mailersendWhatsapp("t", "1", ruim).send({ to: "1", templateId: "x", body: [] }));
  process.env = antes;
});

test("fluxo: número cifrado, pedido, confirmação por WhatsApp, aviso nos dois canais", async () => {
  process.env.IDENTITY_CHECK_MODE = "off";
  const { query } = await import("./db");
  const { hmac } = await import("./security");
  const { cifrar } = await import("./crypto-dados");
  const { pedirWhatsapp, notificarConfirmacaoWhatsapp, pendentePorToken } = await import("./whatsapp/store");
  const { confirmFull } = await import("./signatures");
  const enviados: WaMsg[] = [];
  _setWaProviderForTests({ name: "fake", async send(m) { enviados.push(m); return { id: "w" + enviados.length }; } });
  process.env.WHATSAPP_TEMPLATE_CONFIRM = "tpl-pedido"; process.env.WHATSAPP_TEMPLATE_DONE = "tpl-pronto";
  void cifrar;
  const email = "wa-teste@wa-teste.example", criada = "2026-11-02T10:00:00.000Z", cpf = "cpf-exclusivo-wa-teste";
  const limpa = async () => { await query("DELETE FROM whatsapp_messages WHERE signature_id IN (SELECT id FROM signatures WHERE email=$1)", [email]); await query("DELETE FROM signatures WHERE email=$1", [email]); };
  await limpa();
  try {
    const id = (await query<{ id: number }>("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,status,created_at,token_hash,token_expires_at) VALUES('Maria Teste',$1,$2,$3,'apoiador','v',$4,'pending',$4,'emailtok',now()+interval '1 day') RETURNING id", [email, hmac("wa1"), hmac(cpf), criada])).rows[0].id;
    await pedirWhatsapp(id, "Maria Teste", "5569999990000");
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].templateId, "tpl-pedido"); assert.deepEqual(enviados[0].body, ["Maria"]);
    const token = enviados[0].buttons![0];
    const cru = (await query<any>("SELECT wa_cipher, wa_fp, wa_optin_at, wa_token_hash FROM signatures WHERE id=$1", [id])).rows[0];
    assert.ok(cru.wa_cipher && !cru.wa_cipher.includes("5569") && cru.wa_optin_at && cru.wa_token_hash && cru.wa_token_hash !== token);
    const p = await pendentePorToken(token);
    assert.equal(p?.id, id); assert.equal(p?.cpfHash, hmac(cpf));
    assert.equal(await pendentePorToken("invalido"), null);
    const r = await confirmFull(token, { ip: "127.0.0.1" }, "whatsapp");
    assert.equal(r.result, "ok");
    const dep = (await query<any>("SELECT status, confirmed_at, wa_confirmed_at, wa_token_hash, token_hash, created_at FROM signatures WHERE id=$1", [id])).rows[0];
    assert.equal(dep.status, "confirmed"); assert.ok(dep.wa_confirmed_at && !dep.wa_token_hash && !dep.token_hash);
    assert.equal(new Date(dep.created_at).toISOString(), criada); // data original intacta
    assert.equal((await confirmFull(token, {}, "whatsapp")).result, "invalid"); // não reutiliza
    await notificarConfirmacaoWhatsapp(id);
    assert.equal(enviados.length, 2); assert.equal(enviados[1].templateId, "tpl-pronto"); assert.equal(enviados[1].to, "5569999990000");
    // sem número informado: nenhum aviso
    const id2 = (await query<{ id: number }>("INSERT INTO signatures(name,email,email_hash,category,text_version,consent_at,status,created_at,token_hash,token_expires_at) VALUES('Sem Zap',$1,$2,'apoiador','v',$3,'confirmed',$3,'x',now()+interval '1 day') RETURNING id", ["wa-teste@wa-teste.example".replace("wa-teste@", "semzap@"), hmac("wa2"), criada])).rows[0].id;
    await notificarConfirmacaoWhatsapp(id2); assert.equal(enviados.length, 2);
    await query("DELETE FROM signatures WHERE id=$1", [id2]);
  } finally { _setWaProviderForTests(null); await limpa(); await query("DELETE FROM signatures WHERE email LIKE '%@wa-teste.example'"); }
});

test("assinar: com WhatsApp ligado valida o número; desligado ignora o campo", async () => {
  const { handleSign } = await import("./sign-flow");
  const { query } = await import("./db");
  const { _setMxResolverForTests } = await import("./email-check");
  _setMxResolverForTests(async () => "ok");
  const base = (email: string, extra: object = {}) => ({ name: "Pessoa Zap", email, category: "estrangeiro", country: "PT", university: "Universidade de Lisboa", consent: true, locale: "pt", ...extra });
  const ctx = { ip: "127.0.0.9" } as any;
  const limpa = async () => { await query("DELETE FROM whatsapp_messages WHERE signature_id IN (SELECT id FROM signatures WHERE email LIKE '%@zap-teste.example')"); await query("DELETE FROM signatures WHERE email LIKE '%@zap-teste.example'"); };
  await limpa();
  const enviados: WaMsg[] = [];
  try {
    // desligado: o campo é ignorado e nada é guardado
    await handleSign(base("off@zap-teste.example", { whatsapp: { ddi: "55", numero: "69999990000" }, whatsappConsent: true }), ctx);
    const wOff = (await query<any>("SELECT wa_cipher FROM signatures WHERE email='off@zap-teste.example'")).rows[0];
    if (wOff) assert.equal(wOff.wa_cipher, null);
    // ligado
    _setWaProviderForTests({ name: "fake", async send(m) { enviados.push(m); return { id: "z" + enviados.length }; } });
    process.env.WHATSAPP_TEMPLATE_CONFIRM = "tp";
    const sem = await handleSign(base("c1@zap-teste.example", { whatsapp: { ddi: "55", numero: "69999990000" } }), ctx);
    assert.equal((sem.json.errors as any)?.whatsappConsent, "wa_consent_required");
    const ruim = await handleSign(base("c2@zap-teste.example", { whatsapp: { ddi: "55", numero: "123" }, whatsappConsent: true }), ctx);
    assert.equal((ruim.json.errors as any)?.whatsapp, "wa_number_invalid");
    assert.equal(enviados.length, 0);
    const vazio = await handleSign(base("c3@zap-teste.example", { whatsapp: { ddi: "55", numero: "  " } }), ctx); // campo em branco = sem WhatsApp
    assert.ok(!(vazio.json.errors as any)?.whatsapp);
    assert.equal(enviados.length, 0);
  } finally { _setWaProviderForTests(null); await limpa(); }
});
