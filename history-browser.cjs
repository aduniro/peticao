"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");

const SOURCE = "f55595cd348c23ffe559dba2de9150259db9f1e7";
const ORIGIN = "http://127.0.0.1:31385";
const CHROME = "/home/barre/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome";
const CHROME_SHA = "481fea1516a1f2b76454664272f12cd9dd1f20117b21e1f1498e08bc7f872c00";
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

function validateConfig(cfg, filename, currentCgroup) {
  const run = path.dirname(filename);
  const match = run.match(/^\/mnt\/dev\/\.peticao-(r0004-local-history-http|r0006-local-history-browser)-qa-20261111\/runs\/[a-f0-9]{12}$/);
  assert.ok(match, "explicit reviewed local history fixture root required");
  assert.equal(filename, path.join(run, "browser-config.json"));
  assert.equal(cfg.run, run);
  assert.equal(cfg.sourceCommit, SOURCE);
  assert.equal(cfg.origin, ORIGIN);
  assert.equal(cfg.cgroup, currentCgroup);
  assert.ok(cfg.cgroup.startsWith("/user.slice/") && cfg.cgroup.endsWith(`/peticao-${match[1]}-qa-20261111.service`), "fixture root and exact local unit must match");
  assert.match(cfg.cookie, /^adm=[A-Za-z0-9_.~-]{16,4096}$/);
  assert.equal(cfg.syntheticSession, true);
  assert.equal(cfg.stepupSeeded, true);
  assert.equal(cfg.batchId, 1);
  assert.equal(cfg.fixtures.length, 2);
  assert.deepEqual(cfg.fixtures.map(f => f.ordinal), [1, 2]);
  for (const f of cfg.fixtures) {
    assert.match(f.id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.match(f.sha256, /^[a-f0-9]{64}$/);
    assert.equal(f.filename, `version-${f.ordinal}.pdf`);
    assert.ok(Number.isSafeInteger(f.bytes) && f.bytes > 0 && f.bytes < 1024 * 1024);
  }
  return run;
}

function classifyRequest(rawUrl, method) {
  const url = new URL(rawUrl);
  if (url.origin !== ORIGIN || url.username || url.password) return "external";
  if (!["GET", "HEAD"].includes(method)) return "mutation";
  return "allowed";
}

function verifyDownloadRequests(requests, fixtures) {
  const observed = requests.filter(r => /^\/api\/admin\/lotes\/1\/versoes\//.test(r.path));
  assert.deepEqual(observed, [...fixtures].reverse().map(f => ({ method: "GET", path: `/api/admin/lotes/1/versoes/${f.id}` })));
}

async function execute(filename) {
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0);
  assert.equal(fs.realpathSync(filename), filename);
  const cfg = JSON.parse(fs.readFileSync(filename, "utf8"));
  const cgroup = fs.readFileSync("/proc/self/cgroup", "utf8").split("\n").find(x => x.startsWith("0::")).slice(3);
  const run = validateConfig(cfg, filename, cgroup);
  assert.equal(sha(fs.readFileSync(CHROME)), CHROME_SHA);
  assert.equal(process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK, "1");
  const { chromium } = require("/home/barre/pdf_temp/scribdl-py/venv/lib/python3.12/site-packages/playwright/driver/package");
  let browser;
  const result = { classification: "AUTHENTICATED_HISTORY_BROWSER_WITH_SYNTHETIC_HTTP_LOGIN_SESSION", sourceCommit: SOURCE, checks: [], requests: [], pageErrors: [], consoleErrors: [], externalRequestsBlocked: [], mutationsBlocked: [], syntheticSession: true, browserLoginUiTested: false, stepupSeeded: true, otpFlowTested: false, realCertificateUsed: false, deployment: false, exit: 1 };
  const check = (name, value) => { result.checks.push({ name, passed: !!value }); assert.ok(value, name); };
  try {
    browser = await chromium.launch({ executablePath: CHROME, headless: true, chromiumSandbox: true, timeout: 30000, proxy: { server: "http://127.0.0.1:9", bypass: "127.0.0.1,localhost" }, env: { PATH: "/usr/bin:/bin", HOME: run + "/empty", TMPDIR: run + "/tmp", LANG: "C.UTF-8" }, args: ["--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run", "--dns-prefetch-disable"] });
    result.browserVersion = browser.version();
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true, serviceWorkers: "block", extraHTTPHeaders: { DNT: "1" } });
    check("fresh context has no inherited cookies", (await context.cookies()).length === 0);
    // Reuse only the session established by a successful fixture HTTP login. Never weaken the application's Secure cookie.
    await context.addCookies([{ name: "adm", value: cfg.cookie.slice(4), domain: "127.0.0.1", path: "/", secure: true, httpOnly: true, sameSite: "Strict" }]);
    await context.route("**/*", route => {
      const req = route.request(), kind = classifyRequest(req.url(), req.method()), url = new URL(req.url());
      if (kind === "external") { result.externalRequestsBlocked.push(url.origin + url.pathname); return route.abort(); }
      if (kind === "mutation") { result.mutationsBlocked.push({ method: req.method(), path: url.pathname }); return route.abort(); }
      result.requests.push({ method: req.method(), path: url.pathname }); return route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", err => result.pageErrors.push(String(err)));
    page.on("console", msg => { if (msg.type() === "error") result.consoleErrors.push(msg.text()); });
    const response = await page.goto(ORIGIN + "/admin/presidente?lote=1", { waitUntil: "networkidle", timeout: 45000 });
    check("authenticated selected batch renders", response.status() === 200 && new URL(page.url()).pathname === "/admin/presidente");
    await page.getByRole("heading", { name: "Lote 1 · parcial", exact: true }).waitFor();
    const dialog = page.getByTestId("document-history");
    check("history starts closed", !(await dialog.evaluate(el => el.open)));
    check("no history PDF fetched automatically", !result.requests.some(r => /^\/api\/admin\/lotes\/1\/versoes\//.test(r.path)));
    const listing = page.waitForResponse(r => r.url() === ORIGIN + "/api/admin/lotes/1/versoes" && r.request().method() === "GET");
    await page.getByRole("button", { name: "Histórico", exact: true }).click();
    check("history metadata HTTP 200", (await listing).status() === 200);
    await dialog.locator("tbody tr").first().waitFor();
    const rows = dialog.locator("tbody tr");
    check("two historical PDF versions render", await rows.count() === 2);
    check("newest version is first", await rows.nth(0).locator("td").nth(0).innerText() === "2" && await rows.nth(1).locator("td").nth(0).innerText() === "1");
    check("opening metadata does not fetch history PDFs", !result.requests.some(r => /^\/api\/admin\/lotes\/1\/versoes\//.test(r.path)));
    for (const item of [...cfg.fixtures].reverse()) {
      const row = rows.nth(2 - item.ordinal);
      check(`version ${item.ordinal} displays exact PDF hash`, (await row.innerText()).includes(item.sha256));
      const link = row.getByRole("link", { name: "Baixar", exact: true });
      check(`version ${item.ordinal} has exact protected URL`, await link.getAttribute("href") === `/api/admin/lotes/1/versoes/${item.id}`);
      const downloading = page.waitForEvent("download"); await link.click(); const download = await downloading;
      assert.equal(await download.failure(), null);
      assert.equal(download.suggestedFilename(), `lote-1-versao-${item.ordinal}-original.pdf`);
      const dest = path.join(run, "downloads", `browser-version-${item.ordinal}.pdf`); await download.saveAs(dest);
      const bytes = fs.readFileSync(dest);
      check(`version ${item.ordinal} downloaded bytes match fixture`, bytes.length === item.bytes && sha(bytes) === item.sha256 && bytes.equals(fs.readFileSync(path.join(run, "pdf-fixtures", item.filename))));
    }
    verifyDownloadRequests(result.requests, cfg.fixtures);
    check("only the two explicit PDF downloads occurred in order", true);
    await page.screenshot({ path: path.join(run, "history-desktop.png"), fullPage: true });
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.activeElement?.textContent === "Histórico");
    check("escape closes history", !(await dialog.evaluate(el => el.open)));
    check("focus returns to history trigger", await page.getByRole("button", { name: "Histórico", exact: true }).evaluate(el => el === document.activeElement));
    check("no page JavaScript exception", result.pageErrors.length === 0);
    check("no browser console error", result.consoleErrors.length === 0);
    check("no external application requests", result.externalRequestsBlocked.length === 0);
    check("no application mutation attempted", result.mutationsBlocked.length === 0);
    await context.close(); result.exit = 0;
  } catch (err) { result.error = String(err).slice(0, 3000); }
  finally {
    if (browser) { try { await browser.close(); } catch (err) { result.exit = 1; result.closeError = String(err).slice(0, 1000); } }
    fs.writeFileSync(path.join(run, "history-browser-result.json"), JSON.stringify(result, null, 2));
  }
  return result.exit;
}

module.exports = { validateConfig, classifyRequest, verifyDownloadRequests };
if (require.main === module) execute(process.argv[2]).then(code => { process.exitCode = code; }).catch(err => { console.error(err.message); process.exitCode = 1; });
