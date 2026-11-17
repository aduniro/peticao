// Read-only compiled Central visual QA. New fictitious database; no action POSTs.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL ?? "http://invalid"), database = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.equal(base.hostname, "127.0.0.1"); assert.equal(base.port, "3036");
assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "54356"); assert.equal(database.pathname, "/peticao");
assert.equal(process.env.PREVIEW_MODE, "1"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0"); assert.equal(process.env.MAIL_PROVIDER, "dev");
const output = process.env.QA_OUTPUT_DIR; assert.ok(output); await mkdir(output, { recursive: true });
const [db, U] = await Promise.all([import("../../site/src/lib/db.ts"), import("../../site/src/lib/admin-users.ts")]).then(items => items.map(item => item.default ?? item));
let token, browser;
try {
  assert.equal((await db.query("SELECT count(*)::int n FROM signatures")).rows[0].n, 0, "Must start with a new fictitious database");
  await db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,status) VALUES('Pessoa Fictícia','qa-preserved@example.test','QA-EMAIL-HASH','QA-CPF-HASH','apoiador','QA',now(),'pending')");
  const user = await U.criarUsuario({ email: "qa-central-visual@example.test", nome: "QA Central Visual", nivel: "total", senha: "QA-Layout-2026-Ficticia" }); assert.ok(user.ok, JSON.stringify(user));
  token = (await U.abrirSessao(user.usuario.id, "127.0.0.1")).token;
  const headers = { origin: base.origin, cookie: `adm=${token}` };
  assert.equal((await fetch(new URL("/api/admin/acoes", base))).status, 401);
  assert.equal((await fetch(new URL("/api/admin/acoes", base), { headers })).status, 403);
  await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE user_id=$1", [user.usuario.id]);
  await db.query("INSERT INTO admin_acoes(user_id,email,acao,modo,parametros,central_estado,central_request_id,ok) VALUES($1,$2,'publicar.pedir','executar',$3,'indeterminado','1234567890abcdef',false),($1,$2,'estado.ver','simular','{}','legacy',NULL,false),($1,$2,'reenvio.parar','executar','{}','concluido',NULL,true)", [user.usuario.id, user.usuario.email, JSON.stringify({ candidato: "a".repeat(64) })]);
  const snapshot = async () => (await db.query("SELECT 'signature' kind,row_to_json(s)::text data FROM signatures s UNION ALL SELECT 'message',row_to_json(m)::text FROM mail_messages m UNION ALL SELECT 'attempt',row_to_json(a)::text FROM mail_message_attempts a UNION ALL SELECT 'queue',row_to_json(q)::text FROM mail_outbox q UNION ALL SELECT 'action',row_to_json(x)::text FROM admin_acoes x UNION ALL SELECT 'audit',row_to_json(l)::text FROM audit_log l UNION ALL SELECT 'setting',row_to_json(t)::text FROM settings t ORDER BY kind,data")).rows;
  const before = await snapshot();
  const { chromium } = await import(process.env.QA_PLAYWRIGHT_MODULE); browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROMIUM });
  const widths = [320, 390, 768, 992, 1280, 1920], reports = [];
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 900 } }); await context.addCookies([{ name: "adm", value: token, url: base.origin }]);
    const page = await context.newPage(), errors = [], failed = [], badHttp = [], writes = [], external = [];
    page.on("pageerror", error => errors.push(error.message)); page.on("requestfailed", request => failed.push(request.url()));
    page.on("response", response => { if (response.status() >= 400) badHttp.push({ status: response.status(), url: response.url() }); });
    page.on("request", request => { if (!["GET", "HEAD"].includes(request.method())) writes.push({ method: request.method(), url: request.url() }); if (new URL(request.url()).origin !== base.origin) external.push(request.url()); });
    try {
      assert.equal((await page.goto(new URL("/admin/acoes", base).href)).status(), 200);
      const history = page.getByTestId("action-history"); await history.locator("tbody tr").first().waitFor();
      assert.equal(await history.locator("tbody tr").count(), 3);
      assert.ok((await history.innerText()).includes("A conferência consulta o resultado do executor; não executa a ação novamente."));
      const wrapper = history.locator(".table-scroll"), table = wrapper.locator("table");
      const metrics = await wrapper.evaluate(element => {
        const table = element.querySelector("table"), header = element.querySelector("th:nth-child(2)");
        return { client: element.clientWidth, scroll: element.scrollWidth, overflowX: getComputedStyle(element).overflowX, tableWidth: table.getBoundingClientRect().width, dateColumnWidth: header.getBoundingClientRect().width };
      });
      assert.ok(metrics.tableWidth >= 759.5, `table width ${width}: ${JSON.stringify(metrics)}`);
      assert.ok(metrics.dateColumnWidth >= 70, `readable column width ${width}`);
      assert.ok(["auto", "scroll"].includes(metrics.overflowX));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, `page overflow ${width}`);
      if (metrics.tableWidth > metrics.client + 1) {
        assert.ok(metrics.scroll > metrics.client, "Only the table container should scroll horizontally");
        await wrapper.evaluate(element => { element.scrollLeft = element.scrollWidth; });
        assert.ok(await wrapper.evaluate(element => element.scrollLeft > 0));
        const button = history.getByRole("button", { name: "Conferir resultado", exact: true });
        const bounds = await button.boundingBox(), container = await wrapper.boundingBox();
        assert.ok(bounds.x >= container.x - 1 && bounds.x + bounds.width <= container.x + container.width + 1, "The rightmost action must be reachable inside the scroll container");
      }
      const right = `${output}/actions-history-${width}-right.png`; await history.screenshot({ path: right });
      await wrapper.evaluate(element => { element.scrollLeft = 0; });
      const left = `${output}/actions-history-${width}-left.png`; await history.screenshot({ path: left });
      assert.deepEqual(errors, []); assert.deepEqual(failed, []); assert.deepEqual(badHttp, []); assert.deepEqual(writes, []); assert.deepEqual(external, []);
      reports.push({ width, ...metrics, noPageOverflow: true, readOnlyBrowser: true, left, right });
    } finally { await context.close(); }
  }
  assert.deepEqual(await snapshot(), before, "Read-only views must not change signatures, mail, actions, audit or settings");
  const report = { ok: true, compiledRealPage: true, minTableWidth: 760, widths, reports, noActionPost: true, noExternalBrowserRequests: true, fixturesPreserved: true };
  await writeFile(`${output}/actions-visual.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { if (browser) await browser.close(); if (token) await U.encerrarSessao(token); await db._closeDbForTests(); }
