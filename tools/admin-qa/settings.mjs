// Local-only configuration regression; all writes are limited to isolated QA fixtures.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL ?? "http://127.0.0.1:3032");
const database = new URL(process.env.DATABASE_URL ?? "http://missing");
assert.ok(["127.0.0.1", "localhost"].includes(base.hostname) && base.port === "3032");
assert.ok(["127.0.0.1", "localhost"].includes(database.hostname) && database.port === "54345" && database.pathname === "/peticao");
assert.equal(process.env.PREVIEW_MODE, "1"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0"); assert.equal(process.env.MAIL_PROVIDER, "dev");
const bootstrap = await fetch(new URL("/admin", base)); assert.equal(bootstrap.status, 200);
assert.ok((await bootstrap.text()).includes("/dev/outbox"));
const dbModule = await import("../../site/src/lib/db.ts"), userModule = await import("../../site/src/lib/admin-users.ts");
const db = dbModule.default ?? dbModule, U = userModule.default ?? userModule;
const email = "qa-settings@example.test", nome = "QA Configurações";
const previous = (await db.query("SELECT value FROM settings WHERE key='painel_popup_estado'")).rows;
const existing = (await db.query("SELECT id,nome,nivel FROM admin_users WHERE email=$1", [email])).rows[0];
let id;
if (existing) { assert.equal(existing.nome, nome); assert.equal(existing.nivel, "total"); id = existing.id; }
else { const created = await U.criarUsuario({ email, nome, nivel: "total", senha: "QA-Ficticia-2026-Somente-Local" }); assert.ok(created.ok); id = created.usuario.id; }
const { token } = await U.abrirSessao(id, "127.0.0.1");
const { chromium } = await import(process.env.QA_PLAYWRIGHT_MODULE);
const output = process.env.QA_OUTPUT_DIR; assert.ok(output); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM, headless: true, args: ["--no-sandbox"] });
const results = [];
try {
  for (const width of [320, 390, 768, 992, 1280, 1920]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: "adm", value: token, url: base.href }]);
    const page = await context.newPage();
    const exceptions = [], httpErrors = [], failures = [], deliberate = new WeakSet();
    page.on("pageerror", error => exceptions.push(error.message));
    page.on("response", response => { if (response.status() >= 400) httpErrors.push({ url: response.url(), status: response.status() }); });
    page.on("requestfailed", request => { if (!deliberate.has(request)) failures.push({ url: request.url(), error: request.failure() }); });
    try {
      assert.equal((await page.goto(new URL("/admin/configuracoes", base).href, { waitUntil: "networkidle" })).status(), 200);
      const switches = page.getByRole("switch"); assert.equal(await switches.count(), 2);
      const initial = [await switches.nth(0).isChecked(), await switches.nth(1).isChecked()];
      let requests = 0;
      for (const fail of [true, false]) {
        let release, begun;
        const gate = new Promise(resolve => { release = resolve; }), start = new Promise(resolve => { begun = resolve; });
        await page.route("**/api/admin/configuracoes", async route => {
          requests++; begun(); await gate;
          if (fail) { deliberate.add(route.request()); await route.abort("failed"); } else await route.continue();
        });
        await page.locator("label.v2-chave").nth(0).click(); await start;
        try {
          await page.waitForFunction(() => [...document.querySelectorAll('input[role="switch"]')].every(input => input.disabled));
          assert.equal(await switches.nth(0).isDisabled(), true);
          assert.equal(await switches.nth(1).isDisabled(), true);
        } finally { release(); }
        await page.locator(fail ? ".v2-aviso[role=alert]" : ".v2-aviso[role=status]").waitFor();
        await page.waitForFunction(() => [...document.querySelectorAll('input[role="switch"]')].every(input => !input.disabled));
        assert.equal(await switches.nth(0).isChecked(), fail ? initial[0] : !initial[0]);
        assert.equal(await switches.nth(1).isChecked(), initial[1]);
        await page.unroute("**/api/admin/configuracoes");
      }
      assert.equal(requests, 2);
      const actor = (await db.query("SELECT data FROM audit_log WHERE event='painel_config' ORDER BY id DESC LIMIT 1")).rows[0];
      assert.equal(JSON.parse(actor.data).por, email);
      assert.deepEqual(exceptions, []); assert.deepEqual(httpErrors, []); assert.deepEqual(failures, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
      await page.screenshot({ path: `${output}/settings-${width}.png`, fullPage: true });
      results.push({ width, ok: true, singleFlight: true, statePreservedAfterFailure: true, realSaveAfterRetry: true, actorVerified: true });
    } catch (error) { results.push({ width, ok: false, error: error.message, exceptions, httpErrors, failures }); }
    finally { await context.close(); }
  }
} finally {
  await browser.close(); await U.encerrarSessao(token);
  // Restore only the preference modified by this fixture, preserving all other QA data.
  if (previous.length) await db.query("UPDATE settings SET value=$1 WHERE key='painel_popup_estado'", [previous[0].value]);
  else await db.query("DELETE FROM settings WHERE key='painel_popup_estado'");
  await db._closeDbForTests();
}
await writeFile(`${output}/settings.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
assert.ok(results.every(result => result.ok));
