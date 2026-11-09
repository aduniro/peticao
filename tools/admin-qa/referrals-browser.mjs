// Native form, lost responses and explicit retries. Fictitious loopback QA only.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL), database = new URL(process.env.DATABASE_URL);
assert.equal(base.origin, "http://127.0.0.1:3033");
assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "54349");
assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.equal(process.env.MAIL_PROVIDERS, "dev");
assert.equal(process.env.PREVIEW_MODE, "1"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0");
const dm = await import("../../site/src/lib/db.ts"), um = await import("../../site/src/lib/admin-users.ts");
const db = dm.default ?? dm, U = um.default ?? um;
const owner = await U.criarUsuario({ email: "qa-referral-browser@example.test", nome: "QA Indicações", nivel: "edicao", senha: "Ficticia-Intencao-Protegida-2026!" }); assert.ok(owner.ok, owner.ok ? undefined : owner.erro);
const { token } = await U.abrirSessao(owner.usuario.id, "127.0.0.1");
const { chromium } = await import(process.env.QA_PLAYWRIGHT_MODULE);
const browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM, headless: true });
const results = [], errors = [];
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addCookies([{ name: "adm", value: token, url: base.origin }]);
    const page = await context.newPage(); page.on("pageerror", e => errors.push(e.message));
    const open = () => page.goto(new URL("/admin/indicacoes", base).href, { waitUntil: "networkidle" });
    await open();
    const input = page.locator('input[name="label"]'), intent = page.locator('input[name="requestId"]');
    await input.fill(`QA Browser ${width}`);
    const requestId = await intent.inputValue();
    assert.match(requestId, /^[a-f0-9-]{36}$/);
    for (const committed of [false, true]) {
      await page.route("**/api/admin/indicacoes", async route => {
        if (committed) assert.equal((await route.fetch({ maxRedirects: 0 })).status(), 303);
        await route.fulfill({ status: 500, body: "QA injected response loss" });
      });
      await Promise.all([page.waitForURL("**/api/admin/indicacoes"), page.getByRole("button", { name: "Criar código", exact: true }).click()]);
      await page.unroute("**/api/admin/indicacoes");
      await open();
      await page.waitForFunction(label => document.querySelector('input[name="label"]')?.value === label, `QA Browser ${width}`);
      assert.equal(await intent.inputValue(), requestId);
    }
    const before = (await db.query("SELECT row_to_json(q)::text raw FROM admin_referral_requests q ORDER BY request_id")).rows;
    await Promise.all([page.waitForURL(url => url.searchParams.get("completedRequestId") === requestId), page.getByRole("button", { name: "Criar código", exact: true }).click()]);
    await page.waitForLoadState("networkidle");
    assert.equal(await input.inputValue(), "");
    assert.deepEqual((await db.query("SELECT row_to_json(q)::text raw FROM admin_referral_requests q ORDER BY request_id")).rows, before);
    assert.equal((await db.query("SELECT count(*)::int n FROM referrers WHERE label=$1", [`QA Browser ${width}`])).rows[0].n, 1);
    assert.equal((await db.query("SELECT count(*)::int n FROM audit_log WHERE event='referrer_created' AND data::jsonb->>'label'=$1", [`QA Browser ${width}`])).rows[0].n, 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    await page.screenshot({ path: `${process.env.QA_OUTPUT_DIR}/referrals-${width}.png`, fullPage: true });
    results.push({ width, draftAndIntentSurviveFailure: true, lostCommittedResponseReplayedOnce: true, nativePost: true, noOverflow: true });
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.equal((await db.query("SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM signatures")).rowCount, 0);
  assert.ok((await db.verifyAuditChain()).ok);
  await mkdir(process.env.QA_OUTPUT_DIR, { recursive: true });
  await writeFile(`${process.env.QA_OUTPUT_DIR}/referrals-browser.json`, JSON.stringify({ results, errors, noMailOrSignerWrites: true }, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); await U.encerrarSessao(token); await db._closeDbForTests(); }
