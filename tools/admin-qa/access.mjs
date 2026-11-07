// Execute with site/node_modules/.bin/tsx. Uses only dedicated local QA fixtures.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL ?? "http://127.0.0.1:3032");
const database = new URL(process.env.DATABASE_URL ?? "http://missing");
assert.ok(["127.0.0.1", "localhost"].includes(base.hostname) && base.port === "3032");
assert.ok(["127.0.0.1", "localhost"].includes(database.hostname) && database.port === "54345" && database.pathname === "/peticao");
assert.equal(process.env.PREVIEW_MODE, "1");
assert.equal(process.env.ADMIN_NO_PASSWORD, "0");
assert.equal(process.env.MAIL_PROVIDER, "dev");
const bootstrap = await fetch(new URL("/admin", base));
assert.equal(bootstrap.status, 200);
assert.ok((await bootstrap.text()).includes("/dev/outbox"));
const dbModule = await import("../../site/src/lib/db.ts");
const userModule = await import("../../site/src/lib/admin-users.ts");
const db = dbModule.default ?? dbModule, U = userModule.default ?? userModule;
const { chromium } = await import(process.env.QA_PLAYWRIGHT_MODULE);
const output = process.env.QA_OUTPUT_DIR;
assert.ok(output);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM, headless: true, args: ["--no-sandbox"] });
const results = [], tokens = [];
const routes = [
  { path: "/admin/assinaturas", min: "leitura" },
  { path: "/admin/contato", min: "edicao" },
  { path: "/admin/emails", min: "edicao" },
  { path: "/admin/lotes", min: "total" },
  { path: "/admin/usuarios", min: "total" },
];
try {
  const anonymous = await browser.newContext();
  const loginPage = await anonymous.newPage();
  await loginPage.goto(new URL("/admin/contato", base).href);
  assert.equal(new URL(loginPage.url()).pathname, "/admin");
  await anonymous.close();
  for (const nivel of U.NIVEIS) {
    const email = `qa-access-${nivel}@example.test`, nome = `QA Acesso ${nivel}`;
    const existing = (await db.query("SELECT id,nome,nivel FROM admin_users WHERE email=$1", [email])).rows[0];
    let id;
    if (existing) {
      assert.equal(existing.nome, nome); assert.equal(existing.nivel, nivel); id = existing.id;
    } else {
      const created = await U.criarUsuario({ email, nome, nivel, senha: "QA-Ficticia-2026-Somente-Local" });
      assert.ok(created.ok); id = created.usuario.id;
    }
    const { token } = await U.abrirSessao(id, "127.0.0.1"); tokens.push(token);
    const context = await browser.newContext();
    await context.addCookies([{ name: "adm", value: token, url: base.href }]);
    try {
      if (nivel === "total") {
        const page = await context.newPage();
        await page.goto(new URL("/admin/usuarios", base).href);
        assert.equal(new URL(page.url()).pathname, "/admin/confirmar");
        assert.equal(new URL(page.url()).searchParams.get("volta"), "/admin/usuarios");
        await page.close();
        // This fixture tests the gate, not delivery or entry of a real code.
        await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE id=$1", [(await U.sessaoPorToken(token)).sessaoId]);
      }
      for (const width of [320, 390, 768, 992, 1280, 1920]) {
        const page = await context.newPage();
        await page.setViewportSize({ width, height: 900 });
        const exceptions = [];
        page.on("pageerror", error => exceptions.push(error.message));
        for (const route of routes) {
          const response = await page.goto(new URL(route.path, base).href, { waitUntil: "networkidle" });
          const allowed = U.nivelOk(nivel, route.min);
          const actual = new URL(page.url());
          assert.equal(response.status(), 200);
          assert.equal(actual.pathname, allowed ? route.path : "/admin");
          if (!allowed) assert.equal(actual.searchParams.get("erro"), "nivel");
          assert.deepEqual(exceptions, []);
          results.push({ nivel, width, path: route.path, allowed, ok: true });
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: `${output}/access-${nivel}-${width}.png`, fullPage: true });
        await page.close();
      }
    } finally { await context.close(); }
  }
} catch (error) {
  results.push({ ok: false, error: error.message });
} finally {
  for (const token of tokens) await U.encerrarSessao(token);
  await browser.close(); await db._closeDbForTests();
}
await writeFile(`${output}/access-pages.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ checks: results.length, failures: results.filter(result => !result.ok) }));
assert.ok(results.every(result => result.ok));
