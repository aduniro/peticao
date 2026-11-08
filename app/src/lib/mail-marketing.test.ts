import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

(process.env as Record<string, string>).NODE_ENV = "test";

test("canal de marketing separado: sem configuração não envia; usa cadeia e remetente próprios; o transacional não muda", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mkt-")); process.env.MAIL_OUTBOX_DIR = dir;
  const dbmod = await import("./db"); await dbmod._openForTests("t_mail_marketing");
  const { sendMail } = await import("./mail");
  const m = { to: "pessoa@exemplo.org", subject: "Corrija seu nome", text: "texto" };
  delete process.env.MAIL_PROVIDERS_MARKETING;
  await assert.rejects(sendMail(m, "campanha", { channel: "marketing" }), /marketing não configurado/);
  assert.equal(readdirSync(dir).length, 0, "nada enviado pelo canal transacional");
  process.env.MAIL_PROVIDERS_MARKETING = "dev";
  await assert.rejects(sendMail(m, "campanha", { channel: "marketing" }), /Remetente de marketing ausente/);
  process.env.MAIL_FROM_DEV_MARKETING = "Campanha <campanha@mensagens.exemplo.org>";
  assert.equal(await sendMail(m, "campanha", { channel: "marketing" }), "sent");
  assert.equal(readdirSync(dir).length, 1);
  // transacional continua pela cadeia normal (dev) e não usa o remetente de marketing
  process.env.MAIL_PROVIDER = "dev"; delete process.env.MAIL_PROVIDERS;
  assert.equal(await sendMail({ ...m, subject: "confirmação" }, "confirmacao"), "sent");
  assert.equal(readdirSync(dir).length, 2);
});
