// Local-only browser regression. Requires an isolated PREVIEW_MODE server with MAIL_PROVIDER=dev.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
const base = new URL(process.env.QA_BASE_URL ?? "http://127.0.0.1:3031");
assert.ok(["127.0.0.1", "localhost"].includes(base.hostname) && base.port === "3031", "QA is restricted to the isolated local preview on port 3031");
const database = new URL(process.env.DATABASE_URL ?? "http://missing");
assert.ok(["127.0.0.1", "localhost"].includes(database.hostname) && database.port === "54345" && database.pathname === "/peticao", "Use only the isolated QA database on port 54345");
assert.equal(process.env.PREVIEW_MODE, "1");
assert.equal(process.env.MAIL_PROVIDER, "dev");
const require = createRequire(new URL("../../site/package.json", import.meta.url));
const { Pool } = require("pg");
const pool = new Pool({ connectionString: database.href });
const marker = "[QA ADMIN FICTICIO]";
const bootstrap = await fetch(new URL("/admin/contato", base));
assert.equal(bootstrap.status, 200);
assert.ok((await bootstrap.text()).includes("/dev/outbox"), "The target must identify itself as a development-mail preview");
try {
  // Deliberately do not delete or rewrite any existing row, even when rerun.
  const existing = await pool.query("SELECT id FROM contact_messages WHERE email=$1 AND message LIKE $2", ["qa-admin-fixture@example.test", marker + "%"]);
  if (!existing.rowCount) await pool.query("INSERT INTO contact_messages(name,email,kind,message,mailed) VALUES($1,$2,'duvida',$3,true)", ["QA Pessoa Fictícia", "qa-admin-fixture@example.test", marker + " Mensagem fictícia para conferir o editor em telas pequenas, preservar o rascunho em falha de rede e verificar o retorno dos botões."]);
} finally { await pool.end(); }
const { chromium } = await import(process.env.QA_PLAYWRIGHT_MODULE);
const browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM, headless: true, args: ["--no-sandbox"] });
const output = process.env.QA_OUTPUT_DIR;
assert.ok(output, "Set QA_OUTPUT_DIR outside tracked source files");
await mkdir(output, { recursive: true });
const results = [];
try {
  for (const width of [320, 390, 768, 992, 1280, 1920]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const exceptions = [], httpErrors = [], unexpectedFailures = [];
    let injected = 0;
    const deliberateFailures = new WeakSet();
    page.on("pageerror", e => exceptions.push(e.message));
    page.on("response", r => { if (r.status() >= 400) httpErrors.push({ url: r.url(), status: r.status() }); });
    page.on("requestfailed", r => { if (!deliberateFailures.has(r)) unexpectedFailures.push({ url: r.url(), error: r.failure() }); });
    try {
      const response = await page.goto(new URL("/admin/contato", base).href, { waitUntil: "networkidle" });
      assert.equal(response.status(), 200);
      const section = page.locator("section.box").filter({ hasText: marker });
      await section.getByRole("button", { name: "Responder", exact: true }).click();
      const subject = section.locator("input").first(), body = section.locator("textarea");
      await subject.fill("Resposta fictícia de QA");
      await body.fill("Rascunho de QA que deve continuar aqui depois de uma falha de rede.");
      await page.route("**/api/admin/contato/responder", async route => { injected++; deliberateFailures.add(route.request()); await route.abort("failed"); });
      await section.getByRole("button", { name: "Ver a prévia dos e-mails", exact: true }).click();
      await section.getByRole("alert").waitFor();
      assert.equal(injected, 1);
      assert.equal(await subject.inputValue(), "Resposta fictícia de QA");
      assert.match(await body.inputValue(), /^Rascunho de QA/);
      assert.equal(await section.getByRole("button", { name: "Ver a prévia dos e-mails", exact: true }).isEnabled(), true);
      await page.unroute("**/api/admin/contato/responder");
      await section.getByRole("button", { name: "Ver a prévia dos e-mails", exact: true }).click();
      await section.getByRole("heading", { name: "1º e-mail: só texto, enviado agora" }).waitFor();
      assert.match(await subject.inputValue(), /Resposta fictícia/);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
      assert.equal(overflow, false, `Horizontal overflow at ${width}px`);
      assert.deepEqual(exceptions, []);
      assert.deepEqual(httpErrors, []);
      assert.deepEqual(unexpectedFailures, []);
      await page.screenshot({ path: `${output}/contact-editor-${width}.png`, fullPage: true });
      results.push({ width, ok: true, draftPreserved: true, previewRecovered: true, injectedFailures: injected, exceptions, httpErrors, unexpectedFailures });
      // Never click Enviar: this regression only composes a preview.
    } catch (error) {
      results.push({ width, ok: false, error: error.message, exceptions, httpErrors, unexpectedFailures });
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
await writeFile(`${output}/contact-editor.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
assert.ok(results.every(result => result.ok), "See the per-width QA report");
