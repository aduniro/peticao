// Dedicated fictitious database only. No signer API calls or outgoing mail.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL ?? "http://missing"), database = new URL(process.env.DATABASE_URL ?? "http://missing");
assert.equal(base.hostname, "127.0.0.1"); assert.equal(base.port, "3032");
assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "54345");
assert.ok(process.env.CPF_CACHE_ENCRYPTION_KEY?.startsWith("QA-") && process.env.CPF_CACHE_ENCRYPTION_KEY.length >= 32, "Synthetic encryption key required for production-mode fixtures");
assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.equal(process.env.PREVIEW_MODE, "1"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0");
const dm = await import("../../site/src/lib/db.ts"), um = await import("../../site/src/lib/admin-users.ts"), diagnostics = await import("../../site/src/lib/signup-diagnostics.ts");
const db = dm.default ?? dm, U = um.default ?? um, D = diagnostics.default ?? diagnostics;
const snapshot = async () => (await db.query("SELECT row_to_json(s)::text raw FROM signatures s ORDER BY id")).rows;
const before = await snapshot();
const editor = await U.criarUsuario({ email: "qa-diagnostics-editor@example.test", nome: "QA Diagnostics Editor", nivel: "edicao", senha: "QA-Diagnostics-Browser-2026" });
const reader = await U.criarUsuario({ email: "qa-diagnostics-reader@example.test", nome: "QA Diagnostics Reader", nivel: "leitura", senha: "QA-Diagnostics-Browser-2026" });
assert.ok(editor.ok && reader.ok);
const editToken = (await U.abrirSessao(editor.usuario.id, "127.0.0.1")).token, readToken = (await U.abrirSessao(reader.usuario.id, "127.0.0.1")).token;
assert.equal((await db.query("SELECT to_regclass('signup_diagnostics') AS table_name")).rows[0].table_name, null);
for (let i = 0; i < 51; i++) await D.persistDiagnostic({ trace: randomUUID(), source: "server", classification: "validation_failed", category: "apoiador", status: 422, ms: 20, metadata: { fixture: true } });
await D.withSignupDiagnostics(randomUUID(), { consent: true, email: "qa-diagnostic-contact@example.test", category: "apoiador" }, async () => ({ status: 422, json: {} }), null);
const { chromium } = await import(process.env.QA_PLAYWRIGHT_MODULE);
const browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM, headless: true, args: ["--no-sandbox"] });
const output = process.env.QA_OUTPUT_DIR; assert.ok(output); await mkdir(output, { recursive: true });
const results = [];
try {
  for (const width of [320, 390, 768, 992, 1280, 1920]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: "adm", value: editToken, url: base.href }]);
    const page = await context.newPage(), exceptions = [], posts = [];
    page.on("pageerror", e => exceptions.push(e.message)); page.on("request", request => { if (request.method() === "POST") posts.push(new URL(request.url()).pathname); });
    try {
      assert.equal((await page.goto(new URL("/admin/diagnosticos", base).href, { waitUntil: "networkidle" })).status(), 200);
      await page.getByRole("heading", { name: "Diagnósticos de cadastro", exact: true }).waitFor();
      assert.equal(await page.getByRole("cell", { name: "qa-diagnostic-contact@example.test", exact: true }).count(), 0);
      assert.equal(await page.locator("table").nth(1).locator("tbody tr").count(), 50);
      await page.getByRole("link", { name: "Próxima →", exact: true }).click();
      assert.equal(await page.locator("table").nth(1).locator("tbody tr").count(), 2);
      await page.getByRole("link", { name: "← Anterior", exact: true }).click();
      await page.getByRole("link", { name: "Mostrar e-mails", exact: true }).click();
      await page.getByRole("cell", { name: "qa-diagnostic-contact@example.test", exact: true }).waitFor();
      await page.getByRole("link", { name: "Ocultar e-mails", exact: true }).click();
      assert.equal(await page.getByRole("cell", { name: "qa-diagnostic-contact@example.test", exact: true }).count(), 0);
      await page.locator("details").first().locator("summary").click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
      assert.deepEqual(exceptions, []); assert.deepEqual(posts, []);
      await page.screenshot({ path: `${output}/diagnostics-${width}.png`, fullPage: true });
      results.push({ width, ok: true, pagination: true, contactsExplicit: true, readOnlyBrowser: true });
    } finally { await context.close(); }
  }
  const context = await browser.newContext(); await context.addCookies([{ name: "adm", value: readToken, url: base.href }]);
  assert.equal((await context.request.get(new URL("/api/admin/diagnosticos/assinaturas?emails=1", base).href)).status(), 403);
  const page = await context.newPage(); await page.goto(new URL("/admin/diagnosticos", base).href, { waitUntil: "networkidle" });
  assert.ok(!new URL(page.url()).pathname.startsWith("/admin/diagnosticos"));
  assert.equal(await page.getByRole("link", { name: "Diagnósticos de cadastro", exact: true }).count(), 0);
  await context.close();
  assert.deepEqual(await snapshot(), before);
  assert.equal((await db.query("SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox")).rowCount, 0);
} finally { await browser.close(); await U.encerrarSessao(editToken); await U.encerrarSessao(readToken); await db._closeDbForTests(); }
await writeFile(`${output}/diagnostics.json`, JSON.stringify({ results, readerDenied: true, signaturesPreserved: true, noMail: true }, null, 2));
console.log(JSON.stringify(results));

await import("./essential-smoke.mjs");
