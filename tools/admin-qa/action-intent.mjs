// Isolated fake DB only: exercises stopping an inactive resend worker, never starting one.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL ?? "http://127.0.0.1:3032");
const database = new URL(process.env.DATABASE_URL ?? "http://missing");
assert.ok(["127.0.0.1", "localhost"].includes(base.hostname) && base.port === "3032");
assert.ok(["127.0.0.1", "localhost"].includes(database.hostname) && database.port === "54345" && database.pathname === "/peticao");
assert.equal(process.env.PREVIEW_MODE, "1"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0"); assert.equal(process.env.MAIL_PROVIDER, "dev");
const bootstrap = await fetch(new URL("/admin", base)); assert.equal(bootstrap.status, 200); assert.ok((await bootstrap.text()).includes("/dev/outbox"));
const dbModule = await import("../../site/src/lib/db.ts"), userModule = await import("../../site/src/lib/admin-users.ts");
const db = dbModule.default ?? dbModule, U = userModule.default ?? userModule;
const email = "qa-actions@example.test", nome = "QA Ações";
const existing = (await db.query("SELECT id,nome,nivel FROM admin_users WHERE email=$1", [email])).rows[0]; let id;
if (existing) { assert.equal(existing.nome, nome); assert.equal(existing.nivel, "total"); id = existing.id; }
else { const created = await U.criarUsuario({ email, nome, nivel: "total", senha: "QA-Ficticia-2026-Somente-Local" }); assert.ok(created.ok); id = created.usuario.id; }
const { token } = await U.abrirSessao(id, "127.0.0.1");
await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE id=$1", [(await U.sessaoPorToken(token)).sessaoId]);
const settings = async () => (await db.query("SELECT * FROM settings WHERE key LIKE 'reenvio_%' OR key='terminal_ate' ORDER BY key")).rows;
const before = await settings();
assert.ok(!before.find(row => row.key === "reenvio_ativo")?.value?.trim());
const { chromium } = await import(process.env.QA_PLAYWRIGHT_MODULE), output = process.env.QA_OUTPUT_DIR; assert.ok(output); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM, headless: true, args: ["--no-sandbox"] });
const results = [];
try {
  for (const [index, width] of [320, 390, 768, 992, 1280, 1920].entries()) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: "adm", value: token, url: base.href }]);
    const page = await context.newPage(), exceptions = [], failures = [], httpErrors = [], deliberate = new WeakSet();
    page.on("pageerror", error => exceptions.push(error.message));
    page.on("response", response => { if (response.status() >= 400) httpErrors.push({ url: response.url(), status: response.status() }); });
    page.on("requestfailed", request => { if (!deliberate.has(request)) failures.push(request.failure()); });
    let lost = 0, executions = 0, consultations = 0;
    const count = async () => Number((await db.query("SELECT count(*) n FROM admin_acoes WHERE email=$1 AND modo='executar'", [email])).rows[0].n);
    const beforeCount = await count();
    try {
      await page.route("**/api/admin/acoes", async route => {
        const request = route.request();
        if (request.method() !== "POST") { await route.continue(); return; }
        const data = request.postDataJSON();
        assert.equal(data.acao, "reenvio.parar");
        if (data.modo === "executar") {
          executions++;
          if (!lost) {
            const response = await route.fetch(); assert.equal(response.status(), 200);
            assert.equal((await response.json()).modo, "executar");
            lost++; deliberate.add(request); await route.abort("failed"); return;
          }
        }
        if (data.modo === "consultar") consultations++;
        await route.continue();
      });
      assert.equal((await page.goto(new URL("/admin/acoes", base).href, { waitUntil: "networkidle" })).status(), 200);
      const card = page.locator("section.box").filter({ has: page.getByRole("heading", { name: "Parar o reenvio", exact: true }) });
      await card.getByRole("button", { name: "Simular (não altera nada)", exact: true }).click();
      await card.getByRole("button", { name: "Executar", exact: true }).waitFor();
      await card.locator("input").fill("PARAR");
      await card.getByRole("button", { name: "Executar", exact: true }).click();
      await card.getByRole("alert").waitFor();
      assert.equal(lost, 1); assert.equal(await count(), beforeCount + 1);
      assert.equal(await card.locator("input").inputValue(), "PARAR");
      assert.ok(await card.getByRole("button", { name: "Simular (não altera nada)", exact: true }).isDisabled());
      if (index % 2) {
        await page.reload({ waitUntil: "networkidle" });
        await page.waitForFunction(() => [...document.querySelectorAll("section.box")].some(section => section.querySelector("h2")?.textContent === "Parar o reenvio" && section.querySelector("pre")?.textContent.includes('"ligado": false')));
        assert.equal(executions, 1); assert.equal(consultations, 1);
      } else {
        assert.ok(await card.getByRole("button", { name: "Executar", exact: true }).isDisabled());
        await card.getByRole("button", { name: "Conferir resultado", exact: true }).click();
        await card.locator("pre").waitFor(); assert.equal(executions, 1); assert.equal(consultations, 1);
      }
      assert.equal(await count(), beforeCount + 1);
      assert.ok(await card.getByRole("button", { name: "Simular (não altera nada)", exact: true }).isEnabled());
      assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("admin-action-v1:")).length), 0);
      assert.deepEqual(exceptions, []); assert.deepEqual(failures, []); assert.deepEqual(httpErrors, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
      await page.screenshot({ path: `${output}/intent-${width}.png`, fullPage: true });
      results.push({ width, ok: true, recovery: index % 2 ? "reload-consult-only" : "explicit-consult-only", executionsAdmitted: 1, lostResponse: true });
    } catch (error) { results.push({ width, ok: false, error: error.message, exceptions, failures, httpErrors }); }
    finally { await context.close(); }
  }
} finally {
  await browser.close();
  // Restore only the single QA setting touched by reenvio.parar; no worker was started.
  const original = before.find(row => row.key === "reenvio_ativo");
  if (original) await db.query("UPDATE settings SET value=$1 WHERE key='reenvio_ativo'", [original.value]);
  else await db.query("DELETE FROM settings WHERE key='reenvio_ativo'");
  assert.deepEqual(await settings(), before);
  await U.encerrarSessao(token); await db._closeDbForTests();
}
await writeFile(`${output}/intent.json`, JSON.stringify(results, null, 2)); console.log(JSON.stringify(results)); assert.ok(results.every(result => result.ok));
