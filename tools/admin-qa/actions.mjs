// Exercises only reads/simulations: never executes publication, reenvio or Terminal operations.
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
const { chromium } = await import(process.env.QA_PLAYWRIGHT_MODULE), output = process.env.QA_OUTPUT_DIR; assert.ok(output); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM, headless: true, args: ["--no-sandbox"] });
const results = [];
try {
  for (const width of [320, 390, 768, 992, 1280, 1920]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: "adm", value: token, url: base.href }]);
    const page = await context.newPage(); const exceptions = [], httpErrors = [], failures = [], deliberate = new WeakSet();
    page.on("pageerror", error => exceptions.push(error.message));
    page.on("response", response => { if (response.status() >= 400) httpErrors.push({ url: response.url(), status: response.status() }); });
    page.on("requestfailed", request => { if (!deliberate.has(request)) failures.push({ url: request.url(), error: request.failure() }); });
    try {
      assert.equal((await page.goto(new URL("/admin/acoes", base).href, { waitUntil: "networkidle" })).status(), 200);
      const reenvio = page.locator("section.box").filter({ has: page.getByRole("heading", { name: "Ligar o reenvio das confirmações", exact: true }) });
      const dates = reenvio.locator('input[type="datetime-local"]');
      await dates.nth(0).fill("2026-11-04T04:00"); await dates.nth(1).fill("2026-11-04T12:00");
      let aborted = 0;
      await page.route("**/api/admin/acoes", async route => { assert.equal(route.request().postDataJSON().modo, "simular"); aborted++; deliberate.add(route.request()); await route.abort("failed"); });
      await reenvio.getByRole("button", { name: "Simular (não altera nada)", exact: true }).click();
      await reenvio.getByRole("alert").waitFor();
      assert.equal(aborted, 1); assert.equal(await dates.nth(0).inputValue(), "2026-11-04T04:00"); assert.equal(await dates.nth(1).inputValue(), "2026-11-04T12:00");
      assert.ok(await reenvio.getByRole("button", { name: "Simular (não altera nada)", exact: true }).isEnabled());
      await page.unroute("**/api/admin/acoes");
      // A route guard rejects this test if any operation accidentally changes to executar.
      await page.route("**/api/admin/acoes", async route => { assert.equal(route.request().postDataJSON().modo, "simular"); await route.continue(); });
      await reenvio.getByRole("button", { name: "Simular (não altera nada)", exact: true }).click();
      await reenvio.getByRole("button", { name: "Executar", exact: true }).waitFor();
      assert.ok(await reenvio.getByRole("button", { name: "Executar", exact: true }).isDisabled());
      const status = page.locator("section.box").filter({ has: page.getByRole("heading", { name: "Ver o estado do sistema", exact: true }) });
      await status.getByRole("button", { name: "Ver", exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll("section.box")].some(section => section.querySelector("h2")?.textContent === "Ver o estado do sistema" && section.querySelector("pre")?.textContent.includes('"assinaturas"')));
      const record = (await db.query("SELECT modo,central_estado,email FROM admin_acoes WHERE email=$1 AND acao='reenvio.iniciar' ORDER BY id DESC LIMIT 1", [email])).rows[0];
      assert.deepEqual(record, { modo: "simular", central_estado: "concluido", email });
      assert.deepEqual(await settings(), before);
      assert.deepEqual(exceptions, []); assert.deepEqual(httpErrors, []); assert.deepEqual(failures, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${output}/actions-${width}.png`, fullPage: true });
      results.push({ width, ok: true, datesPreserved: true, simulationRecovered: true, journalVerified: true, noBusinessWrites: true });
    } catch (error) { results.push({ width, ok: false, error: error.message, exceptions, httpErrors, failures }); }
    finally { await context.close(); }
  }
} finally { await browser.close(); await U.encerrarSessao(token); await db._closeDbForTests(); }
await writeFile(`${output}/actions.json`, JSON.stringify(results, null, 2)); console.log(JSON.stringify(results)); assert.ok(results.every(result => result.ok));
