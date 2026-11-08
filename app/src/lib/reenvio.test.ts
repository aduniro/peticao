import test from "node:test";
import assert from "node:assert/strict";
import { reenvioMail } from "./signatures";

test("e-mail de reenvio: aviso, pedido, link novo e data original", () => {
  const m = reenvioMail("Maria Souza", "tok123", "2026-11-04T12:00:00.000Z");
  assert.match(m.subject, /Confirme sua assinatura/);
  assert.match(m.text, /Pedimos desculpas/); assert.match(m.text, /caído na caixa de spam/); assert.match(m.text, /avise os colegas/);
  assert.match(m.html, /Pedimos desculpas/); assert.match(m.html, /spam, lixo eletrônico e promoções/);
  assert.match(m.text, /confirmar\?token=tok123/); assert.match(m.html, /confirmar\?token=tok123/);
  assert.match(m.text, /04\/11\/2026/); // data/hora ORIGINAL do cadastro
  assert.ok(!/[A-ZÁÉÍÓÚ]{6,}/.test(m.subject.replace(/PLV|SPAM/g, ""))); // assunto sem gritaria
});

test("reenvio por falha: travado sem aprovação; com aprovação usa OUTRO serviço e não repete", async () => {
  process.env.MAIL_PROVIDER = "dev"; delete process.env.MAIL_PROVIDERS;
  const { query } = await import("./db");
  const { hmac } = await import("./security");
  const { setSetting } = await import("./batches");
  const { processarReenvio, CHAVES, provedoresUsados } = await import("./reenvio");
  const { outboxDir } = await import("./mail");
  const { mkdtempSync, readdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  process.env.MAIL_OUTBOX_DIR = mkdtempSync(join(tmpdir(), "reenvio-"));
  const dom = "@reenvio-teste.example", ini = "2026-11-04T07:00:00.000Z", fim = "2026-11-04T15:00:00.000Z";
  const limpa = async () => { await query("DELETE FROM reenvio_falha WHERE signature_id IN (SELECT id FROM signatures WHERE email LIKE $1)", ["%" + dom]); await query("DELETE FROM signatures WHERE email LIKE $1", ["%" + dom]); await query("DELETE FROM mail_log WHERE to_addr LIKE $1", ["%" + dom]); await query("DELETE FROM email_suppressions WHERE email LIKE $1", ["%" + dom]); };
  await limpa();
  try {
    const mk = async (n: string, criada: string, status = "pending") => (await query<{ id: number }>("INSERT INTO signatures(name,email,email_hash,category,text_version,consent_at,status,created_at,token_hash,token_expires_at) VALUES($1,$2,$3,'apoiador','v',$4,$5,$4,$6,'2026-11-05T00:00:00Z') RETURNING id", [`Pessoa ${n}`, n + dom, hmac("r" + n), criada, status, "velho" + n])).rows[0].id;
    const dentro = await mk("dentro", "2026-11-04T10:00:00.000Z"); await mk("fora", "2026-11-03T10:00:00.000Z"); await mk("confirmada", "2026-11-04T10:00:00.000Z", "confirmed"); await mk("suprimida", "2026-11-04T10:00:00.000Z");
    await query("INSERT INTO email_suppressions(email,reason) VALUES($1,'bounce')", ["suprimida" + dom]);
    await setSetting(CHAVES.inicio, ini); await setSetting(CHAVES.fim, fim);
    // 1) travado: sem `reenvio_ativo` nada acontece
    await setSetting(CHAVES.ativo, "");
    assert.deepEqual(await processarReenvio(), { ativo: false, enviados: 0, falhas: 0, restantes: 0 });
    assert.equal((await query("SELECT 1 FROM reenvio_falha")).rowCount, 0);
    // 2) aprovado: só a pessoa pendente, dentro da janela, não suprimida
    await setSetting(CHAVES.ativo, "AP-TESTE");
    const antes = (await query<{ created_at: string; token_hash: string }>("SELECT created_at, token_hash FROM signatures WHERE id=$1", [dentro])).rows[0];
    const r = await processarReenvio();
    assert.equal(r.enviados, 1); assert.equal(r.falhas, 0); assert.equal(r.restantes, 0);
    const depois = (await query<{ created_at: string; token_hash: string; status: string }>("SELECT created_at, token_hash, status FROM signatures WHERE id=$1", [dentro])).rows[0];
    assert.equal(new Date(depois.created_at).toISOString(), new Date(antes.created_at).toISOString()); // data original intacta
    assert.notEqual(depois.token_hash, antes.token_hash); assert.equal(depois.status, "pending");
    assert.equal(readdirSync(outboxDir()).length, 1);
    // 3) não repete
    assert.equal((await processarReenvio()).enviados, 0);
    assert.equal((await query("SELECT 1 FROM reenvio_falha")).rowCount, 1);
    // 4) política "serviço diferente": provedoresUsados lê quem já enviou
    await query("INSERT INTO mail_log(ts,kind,provider,from_addr,to_addr,status,channel) VALUES(now(),'confirmacao','sendpulse','x','dentro'||$1,'sent','transactional')", [dom]);
    assert.deepEqual((await provedoresUsados("dentro" + dom)).sort(), ["dev", "sendpulse"]); // "dev" = o próprio reenvio de teste; "sendpulse" = envio anterior
  } finally { await setSetting(CHAVES.ativo, ""); await limpa(); delete process.env.MAIL_OUTBOX_DIR; }
});

test("reenvio usa o mesmo remetente da confirmação original", async () => {
  const { config } = await import("./config");
  process.env.MAIL_FROM_SES_CONFIRMACAO = "X <confirmar@assinatura.exemplo>"; process.env.MAIL_FROM_SES = "Y <apex@exemplo>";
  assert.equal(config.mailFromFor("ses", "reenvio"), "X <confirmar@assinatura.exemplo>");
  assert.equal(config.mailFromFor("ses", "confirmacao"), "X <confirmar@assinatura.exemplo>");
  assert.equal(config.mailFromFor("ses", "contato"), "Y <apex@exemplo>");
  delete process.env.MAIL_FROM_SES_CONFIRMACAO; delete process.env.MAIL_FROM_SES;
});
