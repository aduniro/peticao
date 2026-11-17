// Real password fields and submissions; fictitious account, private schema, no email transport.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL), database = new URL(process.env.DATABASE_URL);
assert.equal(base.origin, "http://127.0.0.1:3033"); assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "54349");
assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.equal(process.env.PREVIEW_MODE, "1"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0");
const [db, U, H] = await Promise.all([import("../../site/src/lib/db.ts"), import("../../site/src/lib/admin-users.ts"), import("../../site/src/lib/senha.ts")]).then(ms => ms.map(m => m.default ?? m));
let browser;
try {
  const created = await U.criarUsuario({ email: "qa-password-browser@example.test", nome: "QA Password", nivel: "total", senha: "QA-Original-2026-Ficticia" }); assert.ok(created.ok);
  const sessions = await Promise.all([U.abrirSessao(created.usuario.id, "127.0.0.1"), U.abrirSessao(created.usuario.id, "127.0.0.1")]);
  const { chromium } = await import(process.env.QA_PLAYWRIGHT_MODULE); browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROMIUM });
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } }); await context.addCookies([{ name: "adm", value: sessions[0].token, url: base.origin }]);
  const page = await context.newPage(), errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(new URL("/admin/conta", base).href);
  for (const name of ["nova", "nova2"]) { assert.equal(await page.locator(`input[name="${name}"]`).getAttribute("minlength"), "8"); assert.equal(await page.locator(`input[name="${name}"]`).getAttribute("maxlength"), "200"); }
  assert.match(await page.locator("main").innerText(), /Pelo menos 8 caracteres.*todas as sessões serão encerradas/);
  await page.locator('[name="atual"]').fill("QA-Original-2026-Ficticia"); await page.locator('[name="nova"]').fill("Xy7!Lm9"); await page.locator('[name="nova2"]').fill("Xy7!Lm9");
  let posts = 0; page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/admin/conta") posts++; });
  await page.getByRole("button", { name: "Trocar a senha", exact: true }).click();
  assert.equal(await page.locator('[name="nova"]').evaluate(input => input.validity.tooShort), true); assert.equal(posts, 0);
  await page.locator('[name="nova"]').fill("Xy7!Lm9#"); await page.locator('[name="nova2"]').fill("Xy7!Lm9#");
  await Promise.all([page.waitForURL(url => url.pathname === "/admin"), page.getByRole("button", { name: "Trocar a senha", exact: true }).click()]);
  assert.equal(posts, 1); for (const session of sessions) assert.equal(await U.sessaoPorToken(session.token), null);
  let stored = (await db.query("SELECT senha_hash FROM admin_users WHERE id=$1", [created.usuario.id])).rows[0].senha_hash; assert.ok(H.verificarHash("Xy7!Lm9#", stored));
  const reset = []; await U.pedirReset(created.usuario.email, { origin: base.origin, enviar: async mail => { reset.push(mail); } }); assert.equal(reset.length, 1);
  const resetUrl = reset[0].text.match(/https?:\/\/[^\s]+/)[0]; assert.equal(new URL(resetUrl).origin, base.origin);
  await page.goto(resetUrl);
  for (const name of ["senha", "senha2"]) { assert.equal(await page.locator(`input[name="${name}"]`).getAttribute("minlength"), "8"); assert.equal(await page.locator(`input[name="${name}"]`).getAttribute("maxlength"), "200"); }
  await page.locator('[name="senha"]').fill("Ab8?Qr2!"); await page.locator('[name="senha2"]').fill("Ab8?Qr2!");
  await Promise.all([page.waitForURL(url => url.pathname === "/admin" && url.searchParams.get("msg") === "senha-redefinida"), page.getByRole("button", { name: "Salvar a nova senha", exact: true }).click()]);
  stored = (await db.query("SELECT senha_hash FROM admin_users WHERE id=$1", [created.usuario.id])).rows[0].senha_hash; assert.ok(H.verificarHash("Ab8?Qr2!", stored)); assert.ok(!H.verificarHash("Xy7!Lm9#", stored));
  assert.deepEqual(errors, []); assert.equal((await db.query("SELECT 1 FROM signatures UNION ALL SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox")).rowCount, 0); assert.ok((await db.verifyAuditChain()).ok);
  const report = { ok: true, realForms: true, eightCharacterChangeAndReset: true, sevenBlockedBeforeSubmit: true, allOldSessionsRevoked: true, existingHashMechanismPreserved: true, noTransport: true, noSignerWrites: true };
  await writeFile(`${process.env.QA_OUTPUT_DIR}/admin-password-ui.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { if (browser) await browser.close(); await db._closeDbForTests(); }
