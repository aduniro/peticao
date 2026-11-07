// Read-only compiled navigation with synthetic accounts and data, never production.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL ?? "http://missing"), database = new URL(process.env.DATABASE_URL ?? "http://missing");
assert.equal(base.hostname, "127.0.0.1"); assert.equal(base.port, "3032");
assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "54345");
assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.equal(process.env.PREVIEW_MODE, "1"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0");
const dm = await import("../../site/src/lib/db.ts"), um = await import("../../site/src/lib/admin-users.ts");
const db = dm.default ?? dm, U = um.default ?? um;
const before = (await db.query("SELECT row_to_json(s)::text raw FROM signatures s ORDER BY id")).rows;
const { chromium } = await import(process.env.QA_PLAYWRIGHT_MODULE);
const browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM, headless: true, args: ["--no-sandbox"] });
const paths = ["/admin", "/admin/assinaturas", "/admin/rankings", "/admin/indicacoes", "/admin/mapa", "/admin/mapa/tela", "/admin/monitor", "/admin/conta", "/admin/emails", "/admin/emails/entregas", "/admin/contato", "/admin/dispersao", "/admin/dominios", "/admin/diagnosticos", "/admin/configuracoes", "/admin/lotes", "/admin/usuarios", "/admin/acoes", "/admin/terminal", "/admin/whatsapp"];
const results = [], tokens = [];
let client = 10;
try {
  for (const nivel of ["leitura", "edicao", "exclusao", "total"]) {
    const created = await U.criarUsuario({ email: `qa-smoke-${nivel}@example.test`, nome: `QA Smoke ${nivel}`, nivel, senha: "QA-Smoke-Browser-2026" }); assert.ok(created.ok);
    const { token } = await U.abrirSessao(created.usuario.id, "127.0.0.1"); tokens.push(token);
    // Synthetic setup only: exercise protected views without sending a step-up email.
    if (nivel === "total") await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE user_id=$1", [created.usuario.id]);
    for (const width of nivel === "total" ? [390, 1280] : [1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": `198.18.0.${client++}` } });
      await context.addCookies([{ name: "adm", value: token, url: base.href }]);
      const page = await context.newPage(), exceptions = [], writes = [], serverErrors = [], rejectedReads = [];
      page.on("pageerror", error => exceptions.push(error.message));
      page.on("response", response => { const url = new URL(response.url()); if (url.origin !== base.origin) return; if (response.status() >= 500) serverErrors.push({ path: url.pathname, status: response.status() }); if (url.pathname.startsWith("/api/") && response.status() >= 400) rejectedReads.push({ path: url.pathname, status: response.status() }); });
      await page.route("**/*", async route => {
        const request = route.request();
        if (!["GET", "HEAD"].includes(request.method())) { writes.push(new URL(request.url()).pathname); await route.abort(); }
        else await route.continue();
      });
      try {
        for (const path of paths) {
          const response = await page.goto(new URL(path, base).href, { waitUntil: "networkidle" });
          assert.equal(response.status(), 200, `${nivel}: ${path}`);
          const landing = new URL(page.url());
          const editing = ["/admin/emails", "/admin/emails/entregas", "/admin/contato", "/admin/dispersao", "/admin/dominios", "/admin/diagnosticos"].includes(path);
          const total = ["/admin/configuracoes", "/admin/lotes", "/admin/usuarios", "/admin/acoes", "/admin/terminal", "/admin/whatsapp"].includes(path);
          if (total && nivel !== "total" || editing && nivel === "leitura") {
            assert.equal(landing.pathname, "/admin"); assert.equal(landing.searchParams.get("erro"), "nivel");
          } else assert.equal(landing.pathname, path);
          // Network idle can precede a debounced fetch or hydration. Require real data.
          if (landing.pathname === "/admin") {
            await page.locator(".v2-vivo.vivo").waitFor({ timeout: 30000 });
            await page.locator("svg.v2-mapa-svg").waitFor({ timeout: 15000 });
          } else if (["/admin/assinaturas", "/admin/mapa", "/admin/mapa/tela"].includes(landing.pathname)) {
            await page.getByText(/\d+ assinatura\(s\)/).first().waitFor({ timeout: 30000 });
          }
          assert.deepEqual(exceptions, [], `${nivel}: ${path}`);
          assert.deepEqual(serverErrors, [], `${nivel}: ${path}`);
          assert.deepEqual(writes, [], `${nivel}: ${path}`);
          assert.deepEqual(rejectedReads, [], `${nivel}: ${path}`);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, `${width}: ${path}`);
          console.log(JSON.stringify({ navigation: path, nivel, width, loaded: true }));
          results.push({ nivel, width, path, ok: true, liveDataChecked: ["/admin", "/admin/assinaturas", "/admin/mapa", "/admin/mapa/tela"].includes(landing.pathname), landing: landing.pathname });
          if (nivel === "total" && ["/admin", "/admin/assinaturas", "/admin/conta"].includes(path)) await page.screenshot({ path: `${process.env.QA_OUTPUT_DIR}/essential-${path.split('/').pop() || 'admin'}-${width}.png`, fullPage: true });
        }
      } finally { await context.close(); }
    }
  }
  assert.deepEqual((await db.query("SELECT row_to_json(s)::text raw FROM signatures s ORDER BY id")).rows, before);
  assert.equal((await db.query("SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox")).rowCount, 0);
  await writeFile(`${process.env.QA_OUTPUT_DIR}/essential-smoke.json`, JSON.stringify({ results, signaturesPreserved: true, noMail: true }, null, 2));
  console.log(JSON.stringify({ navigationCases: results.length, roles: 4, noMail: true, signaturesPreserved: true }));
} finally { await browser.close(); for (const token of tokens) await U.encerrarSessao(token); await db._closeDbForTests(); }
