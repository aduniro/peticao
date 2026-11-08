// Real compiled Central UI. Local fictitious DB; only stops an already inactive resend setting.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL ?? "http://invalid"), database = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.equal(base.hostname, "127.0.0.1"); assert.equal(database.hostname, "127.0.0.1");
assert.ok(base.port === "3033" && database.port === "54349" || base.port === "3036" && database.port === "54356");
assert.equal(process.env.PREVIEW_MODE, "1"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0"); assert.equal(process.env.MAIL_PROVIDER, "dev");
const output = process.env.QA_OUTPUT_DIR; assert.ok(output); await mkdir(output, { recursive: true });
const [db, U] = await Promise.all([import("../../site/src/lib/db.ts"), import("../../site/src/lib/admin-users.ts")]).then(items => items.map(item => item.default ?? item));
let token, browser;
const widths = [320, 390, 768, 992, 1280, 1920], reports = [];
try {
  assert.equal((await db.query("SELECT count(*)::int n FROM signatures WHERE email NOT LIKE '%@example.test'")).rows[0].n, 0);
  const settings = async () => (await db.query("SELECT * FROM settings WHERE key LIKE 'reenvio_%' ORDER BY key")).rows;
  const originalSettings = await settings(); assert.ok(!originalSettings.find(row => row.key === "reenvio_ativo")?.value?.trim());
  const preserved = async () => (await db.query("SELECT row_to_json(s)::text data FROM signatures s UNION ALL SELECT row_to_json(m)::text FROM mail_messages m UNION ALL SELECT row_to_json(q)::text FROM mail_outbox q")).rows;
  const original = await preserved();
  const user = await U.criarUsuario({ email: "qa-central-ui@example.test", nome: "QA Central", nivel: "total", senha: "QA-Central-2026-Ficticia" }); assert.ok(user.ok);
  token = (await U.abrirSessao(user.usuario.id, "127.0.0.1")).token;
  const headers = { origin: base.origin, cookie: `adm=${token}` };
  assert.equal((await fetch(new URL("/api/admin/acoes", base))).status, 401);
  assert.equal((await fetch(new URL("/api/admin/acoes", base), { headers })).status, 403);
  await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE user_id=$1", [user.usuario.id]);
  await db.query("INSERT INTO admin_acoes(user_id,email,acao,modo,parametros,central_estado,ok) SELECT $1,$2,'estado.ver','simular','{}','legacy',false FROM generate_series(1,35)", [user.usuario.id, user.usuario.email]);
  const receiptRow = (await db.query("INSERT INTO admin_acoes(user_id,email,acao,modo,parametros,central_estado,central_request_id,ok) VALUES($1,$2,'publicar.pedir','executar',$3,'indeterminado','1234567890abcdef',false) RETURNING id", [user.usuario.id, user.usuario.email, JSON.stringify({ candidato: "a".repeat(64) })])).rows[0].id;
  const { chromium } = await import(process.env.QA_PLAYWRIGHT_MODULE); browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROMIUM });
  try {
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: 900 } }); await context.addCookies([{ name: "adm", value: token, url: base.origin }]);
      const page = await context.newPage(), exceptions = [], failed = [], unexpectedHttp = [], deliberate = new WeakSet(), deliberateHttp = new WeakSet();
      page.on("pageerror", error => exceptions.push(error.message));
      page.on("requestfailed", request => { if (!deliberate.has(request)) failed.push(request.url()); });
      page.on("response", response => {
        if (response.status() < 400) return;
        if (deliberateHttp.has(response.request())) return;
        const request = response.request(), input = request.method() === "POST" ? request.postDataJSON() : null;
        if (!(response.status() === 409 && new URL(response.url()).pathname === "/api/admin/acoes" && input?.modo === "conciliar" && input.id === receiptRow)) unexpectedHttp.push({ url: response.url(), status: response.status() });
      });
      let executed = 0, consulted = 0, lost = false, effect;
      const count = async () => Number((await db.query("SELECT count(*)::int n FROM admin_acoes WHERE email=$1 AND modo='executar' AND acao='reenvio.parar'", [user.usuario.email])).rows[0].n);
      const beforeCount = await count();
      await page.route("**/api/admin/acoes", async route => {
        if (route.request().method() !== "POST") return route.continue();
        const input = route.request().postDataJSON();
        if (input.acao === "reenvio.parar" && input.modo === "executar") {
          executed++; const response = await route.fetch(); assert.equal(response.status(), 200);
          lost = true; deliberate.add(route.request()); await route.abort("failed"); return;
        }
        if (input.acao === "reenvio.parar" && input.modo === "consultar") consulted++;
        if (input.acao === "reenvio.iniciar") assert.equal(input.modo, "simular", "Never start a resend worker in QA");
        await route.continue();
      });
      try {
        assert.equal((await page.goto(new URL("/admin/acoes", base).href)).status(), 200);
        const history = page.getByTestId("action-history"); await history.locator(`[data-action-id="${receiptRow}"]`).waitFor();
        const rowCount = await history.locator("tbody tr").count(); assert.equal(rowCount, 30);
        const pagination = url => url.pathname === "/api/admin/acoes" && url.searchParams.has("antes");
        await page.route(pagination, async route => { deliberateHttp.add(route.request()); await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, erro: "fixture_pagination_unavailable" }) }); });
        await history.getByRole("button", { name: "Carregar mais", exact: true }).click(); await history.getByRole("alert").waitFor(); assert.equal(await history.locator("tbody tr").count(), rowCount);
        await page.unroute(pagination); await history.getByRole("button", { name: "Carregar mais", exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('[data-testid="action-history"] tbody tr').length > 30);
        const start = page.locator("section.box").filter({ has: page.getByRole("heading", { name: "Ligar o reenvio das confirmações", exact: true }) });
        await start.getByLabel("Início da janela (vazio = padrão exibido na simulação)").fill("2026-11-04T06:00");
        await start.getByLabel("Fim da janela (vazio = padrão exibido na simulação)").fill("2026-11-04T09:00");
        const simulated = page.waitForResponse(response => response.url().endsWith("/api/admin/acoes") && response.request().postDataJSON()?.acao === "reenvio.iniciar");
        await start.getByRole("button", { name: "Simular (não altera nada)", exact: true }).click(); effect = (await (await simulated).json()).efeito;
        await start.locator("p").filter({ hasText: effect }).waitFor(); assert.ok(effect.includes("horário de Rondônia"));
        const stop = page.locator("section.box").filter({ has: page.getByRole("heading", { name: "Parar o reenvio", exact: true }) });
        await stop.getByRole("button", { name: "Simular (não altera nada)", exact: true }).click(); await stop.getByRole("button", { name: "Executar", exact: true }).waitFor();
        await stop.locator("input").fill("PARAR"); await stop.getByRole("button", { name: "Executar", exact: true }).click(); await stop.getByRole("alert").waitFor();
        assert.ok((await stop.getByRole("alert").innerText()).includes("Não foi possível confirmar o resultado da ação."));
        assert.equal(lost, true); assert.equal(await count(), beforeCount + 1); assert.ok(await stop.getByRole("button", { name: "Executar", exact: true }).isDisabled());
        await stop.getByRole("button", { name: "Conferir resultado", exact: true }).click(); await stop.locator("pre").waitFor();
        assert.equal(executed, 1); assert.equal(consulted, 1); assert.equal(await count(), beforeCount + 1);
        assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("admin-action-v1:")).length), 0);
        // A missing trusted receipt must not invent success or invoke a deployment.
        const publishingBefore = (await db.query("SELECT row_to_json(a)::text raw FROM admin_acoes a WHERE acao='publicar.pedir'")).rows;
        const missingReceipt = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/api/admin/acoes") && response.request().postDataJSON()?.modo === "conciliar");
        await history.locator(`[data-action-id="${receiptRow}"]`).getByRole("button", { name: "Conferir resultado", exact: true }).click(); await history.getByRole("alert").waitFor();
        const missing = await missingReceipt; assert.equal(missing.status(), 409); assert.equal((await missing.json()).erro, "sem_evidencia");
        assert.deepEqual((await db.query("SELECT row_to_json(a)::text raw FROM admin_acoes a WHERE acao='publicar.pedir'")).rows, publishingBefore);
        assert.deepEqual(exceptions, []); assert.deepEqual(failed, []); assert.deepEqual(unexpectedHttp, []);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
        const shot = `${output}/actions-ui-${width}.png`; await page.screenshot({ path: shot, fullPage: true }); reports.push({ width, effect, paginationFailurePreservesRows: true, paginationRecovers: true, lostResponse: true, consultationOnly: true, missingReceiptBlocked: true, shot });
      } finally { await context.close(); }
    }
  } finally {
    const setting = originalSettings.find(row => row.key === "reenvio_ativo");
    if (setting) await db.query("UPDATE settings SET value=$1 WHERE key='reenvio_ativo'", [setting.value]); else await db.query("DELETE FROM settings WHERE key='reenvio_ativo'");
    assert.deepEqual(await settings(), originalSettings);
  }
  assert.deepEqual(await preserved(), original); assert.ok((await db.verifyAuditChain()).ok);
  const report = { ok: true, realCompiledUi: true, widths, reports, simulationDescription: true, uncertainResultExplicit: true, lostResponseNeverReexecutes: true, historyAndReceiptReadOnly: true, signaturesMailAndSettingsPreserved: true, realDeployment: false };
  await writeFile(`${output}/actions-ui.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { if (browser) await browser.close(); if (token) await U.encerrarSessao(token); await db._closeDbForTests(); }
