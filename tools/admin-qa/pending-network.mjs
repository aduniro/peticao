// Compiled UI with a dedicated QA database. Abort mutations deliberately; never send mail.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL ?? "http://missing"), database = new URL(process.env.DATABASE_URL ?? "http://missing");
assert.equal(base.hostname, "127.0.0.1"); assert.equal(base.port, "3032"); assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "54345");
assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.equal(process.env.PREVIEW_MODE, "1"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0");
const dm = await import("../../site/src/lib/db.ts"), um = await import("../../site/src/lib/admin-users.ts"), sm = await import("../../site/src/lib/security.ts"), mm = await import("../../site/src/lib/email-check.ts");
const db = dm.default ?? dm, U = um.default ?? um, S = sm.default ?? sm, M = mm.default ?? mm;
const created = await U.criarUsuario({ email: "qa-pending-editor@example.test", nome: "QA Editor", nivel: "edicao", senha: "QA-Pending-Network-2026" }); assert.ok(created.ok);
const { token } = await U.abrirSessao(created.usuario.id, "127.0.0.1");
const oldEmail = "qa-pending-old@example.test", newEmail = "qa-pending-new@example.test";
assert.equal((await db.query("SELECT 1 FROM signatures UNION ALL SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox")).rowCount, 0);
// Metadata fixture only: makes the existing pending-list historical cutoff explicit.
await db.query("INSERT INTO mail_log(ts,kind,provider,to_addr,status,error) VALUES('2000-01-01T00:00:00Z','geral','dev','qa-metadata-only@example.test','failed','QA metadata fixture, no dispatch')");
const id = (await db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,created_at,seq,verify_code,token_hash) VALUES('QA Pendência Fictícia',$1,$2,'QA_CPF_PENDING','estrangeiro','QA','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z',801,'QA_VERIFY_PENDING','QA_TOKEN_PENDING') RETURNING id", [oldEmail, S.hmac(M.dedupEmail(oldEmail))])).rows[0].id;
const proof = async () => (await db.query("SELECT id,name,cpf_hash,category,created_at,consent_at,confirmed_at,seq,verify_code,token_hash FROM signatures WHERE id=$1", [id])).rows[0];
const before = await proof(), output = process.env.QA_OUTPUT_DIR; assert.ok(output); await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.QA_PLAYWRIGHT_MODULE);
const browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM, headless: true, args: ["--no-sandbox"] });
const results = [];
try {
  for (const width of [320, 390, 768, 992, 1280, 1920]) {
    await db.query("UPDATE signatures SET email=$1,email_hash=$2 WHERE id=$3", [oldEmail, S.hmac(M.dedupEmail(oldEmail)), id]);
    const context = await browser.newContext({ viewport: { width, height: 900 } }); await context.addCookies([{ name: "adm", value: token, url: base.href }]);
    const page = await context.newPage(), exceptions = []; page.on("pageerror", e => exceptions.push(e.message));
    try {
      assert.equal((await page.goto(new URL("/admin/emails", base).href, { waitUntil: "networkidle" })).status(), 200);
      const row = page.locator('article[role="row"]').filter({ hasText: "QA Pendência Fictícia" }); assert.equal(await row.count(), 1);
      await row.getByRole("button", { name: "Editar", exact: true }).click(); const input = row.locator('input[type="email"]'); await input.fill(newEmail);
      let attempts = 0, started, release;
      const began = new Promise(resolve => { started = resolve; }), gate = new Promise(resolve => { release = resolve; });
      const patch = `**/api/admin/assinaturas/${id}/email`;
      await page.route(patch, async route => { attempts++; started(); await gate; await route.abort("failed"); });
      await input.press("Enter"); await began;
      try { await input.press("Enter"); await input.press("Enter"); assert.equal(await row.getByRole("button", { name: "Salvar", exact: true }).isDisabled(), true); }
      finally { release(); }
      await page.getByRole("status").filter({ hasText: "Não foi possível salvar." }).waitFor();
      assert.equal(await input.inputValue(), newEmail); assert.equal(await row.getByRole("button", { name: "Salvar", exact: true }).isEnabled(), true); assert.equal(attempts, 1);
      assert.equal((await db.query("SELECT email FROM signatures WHERE id=$1", [id])).rows[0].email, oldEmail);
      await page.unroute(patch); await row.getByRole("button", { name: "Salvar", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "corrigido para" }).waitFor(); assert.equal(await input.count(), 0);
      assert.equal((await db.query("SELECT email FROM signatures WHERE id=$1", [id])).rows[0].email, newEmail); assert.deepEqual(await proof(), before);
      let resends = 0;
      await page.route(`**/api/admin/assinaturas/${id}/reenviar`, async route => { resends++; await route.abort("failed"); });
      await row.getByRole("button", { name: "Reenviar", exact: true }).click(); await page.getByRole("status").filter({ hasText: "Não foi possível reenviar." }).waitFor();
      assert.equal(resends, 1); assert.equal(await row.getByRole("button", { name: "Reenviar", exact: true }).isEnabled(), true); assert.ok((await row.textContent()).includes(newEmail));
      await row.locator('input[type="checkbox"]').check(); await page.getByRole("button", { name: "Reenviar selecionados (1)", exact: true }).click();
      let bulk = 0, bulkStarted, bulkRelease;
      const bulkBegan = new Promise(resolve => { bulkStarted = resolve; }), bulkGate = new Promise(resolve => { bulkRelease = resolve; });
      await page.route("**/api/admin/assinaturas/lote", async route => { bulk++; bulkStarted(); await bulkGate; await route.abort("failed"); });
      const send = page.getByRole("button", { name: "Enviar agora", exact: true }); await send.click(); await bulkBegan;
      try { await send.dispatchEvent("click"); await send.dispatchEvent("click"); } finally { bulkRelease(); }
      await page.getByRole("status").filter({ hasText: "Falha na ação em lote." }).waitFor(); assert.equal(bulk, 1); assert.equal(await row.locator('input[type="checkbox"]').isChecked(), true);
      assert.deepEqual(await proof(), before); assert.deepEqual(exceptions, []);
      assert.equal((await db.query("SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM mail_messages")).rowCount, 0);
      assert.equal((await db.query("SELECT count(*)::int n FROM mail_log")).rows[0].n, 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
      await page.screenshot({ path: `${output}/pending-network-${width}.png`, fullPage: true }); results.push({ width, ok: true, draftPreserved: true, realSaveAfterFailure: true, singleFlight: true, selectionPreserved: true, noMail: true });
    } catch (error) { results.push({ width, ok: false, error: error.message, exceptions }); }
    finally { await context.close(); }
  }
} finally { await browser.close(); await U.encerrarSessao(token); await db._closeDbForTests(); }
await writeFile(`${output}/pending-network.json`, JSON.stringify(results, null, 2)); console.log(JSON.stringify(results)); assert.ok(results.every(r => r.ok));
