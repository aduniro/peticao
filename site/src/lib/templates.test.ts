import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";

test("e-mail HTML de confirmação: botão com o link específico, link por extenso, escape de HTML e logos", async () => {
  const { confirmationHtml } = await import("./mail/templates");
  const link = "https://sancionaintegral.org/confirmar?token=abc123&x=1";
  const h = confirmationHtml({ origin: "https://sancionaintegral.org/", firstName: "<b>Maria</b>", link, hours: 24, startedAt: "03/11/2026 10:00:00 (horário de Brasília)" });
  assert.match(h, /<a href="https:\/\/sancionaintegral\.org\/confirmar\?token=abc123&amp;x=1"[^>]*>Confirmar minha assinatura<\/a>/);
  assert.ok(!h.includes("<b>Maria</b>") && h.includes("&lt;b&gt;Maria&lt;/b&gt;")); // nome nunca vira HTML
  assert.match(h, /src="https:\/\/sancionaintegral\.org\/logos\/adunir\.png"/); assert.match(h, /src="https:\/\/sancionaintegral\.org\/logos\/andes\.png"/);
  assert.match(h, /24 horas/); assert.match(h, /lang="pt-BR"/);
  assert.ok(!/<script/i.test(h));
});

test("e-mail de confirmação: o texto puro mantém o link como primeira URL e o HTML acompanha", async () => {
  process.env.APP_URL = "https://sancionaintegral.org";
  const dbmod = await import("./db");
  await dbmod._openForTests("t_tmpl");
  const { readdirSync, readFileSync, mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "tp-")); process.env.MAIL_OUTBOX_DIR = dir; process.env.MAIL_PROVIDER = "dev"; delete process.env.MAIL_PROVIDERS;
  const { submit } = await import("./signatures");
  await submit({ name: "Maria da Silva", email: "maria@unir.br", category: "servidor", consent: true, cpf: "52998224725", institution: "UNIR" } as any, { ip: "local" } as any);
  const mail = JSON.parse(readFileSync(join(dir, readdirSync(dir)[0]), "utf8"));
  assert.match(mail.text.match(/https?:\/\/\S+/)![0], /^https:\/\/sancionaintegral\.org\/confirmar\?token=/);
  assert.ok(mail.html.includes(mail.text.match(/https?:\/\/\S+/)![0].replace(/&/g, "&amp;")));
  assert.match(mail.html, /Confirmar minha assinatura/);
  rmSync(dir, { recursive: true, force: true });
  await dbmod._closeDbForTests();
});
