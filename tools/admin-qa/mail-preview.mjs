// Real compiled endpoint + browser rendering. Fictitious local database/identities only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL ?? "http://127.0.0.1:3032"), database = new URL(process.env.DATABASE_URL ?? "http://missing");
assert.equal(base.hostname, "127.0.0.1"); assert.equal(base.port, "3032"); assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "54345"); assert.equal(database.pathname, "/peticao");
assert.equal(process.env.PREVIEW_MODE, "1"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0"); assert.equal(process.env.MAIL_PROVIDER, "dev");
const output = process.env.QA_OUTPUT_DIR; assert.ok(output); await mkdir(output, { recursive: true });
const boot = await fetch(new URL("/admin", base)); assert.equal(boot.status, 200); assert.ok((await boot.text()).includes("/dev/outbox"));
const dm = await import("../../site/src/lib/db.ts"), um = await import("../../site/src/lib/admin-users.ts"), am = await import("../../site/src/lib/mail/archive.ts");
const db = dm.default ?? dm, U = um.default ?? um, A = am.default ?? am;
let token, browser;
try {
  assert.equal((await db.query("SELECT count(*)::int n FROM mail_messages WHERE to_addr NOT LIKE '%@example.test'")).rows[0].n, 0);
  const signerSnapshot = async () => (await db.query("SELECT id,name,cpf_hash,email_hash,status,seq,created_at,confirmed_at FROM signatures ORDER BY id")).rows;
  const before = await signerSnapshot(), secret = "QA_PRIVATE_TOKEN_123456789012345678901234567890", password = "QA-Local-Previa-2026-Ficticia";
  const html = `<html><head><style>@import 'https://blocked.test/css';</style></head><body style="background:#eef3f0"><table style="width:100%;max-width:600px;background:#ffffff;border:1px solid #d5e0da"><tr><td style="background:#05382a;color:#ffffff;padding:20px;font-size:21px"><strong>QA PREVIEW SAFE</strong></td></tr><tr><td style="padding:20px"><p>Olá, José. Esta é uma mensagem fictícia.</p><p>Código <b>123</b><i>456</i></p><p><a href="https://blocked.test/confirmar?token=${secret}">Confirmar minha assinatura</a></p><p>https://blocked.test/confirmar?token=${secret}</p><img src="https://blocked.test/pixel"><script>window.parent.__qaExecuted=true;fetch('https://blocked.test/script')</script><form action="https://blocked.test/submit"><input value="SECRET"></form><svg onload="window.parent.__qaExecuted=true"></svg></td></tr></table></body></html>`;
  const message = await A.prepareMessage({ to: `qa-preview-${randomUUID()}@example.test`, subject: "QA Prévia", text: `QA PREVIEW SAFE ${secret} 123456`, html, attachments: [{ filename: "fixture.pdf", content: Buffer.from("QA_ATTACHMENT_PRIVATE") }] }, "confirmacao", "transactional", { archive: { until: new Date(Date.now() + 3600000) } });
  const email = "qa-mail-preview-owner@example.test";
  let user = (await db.query("SELECT id,nivel FROM admin_users WHERE email=$1", [email])).rows[0];
  if (user) assert.equal(user.nivel, "total"); else { const created = await U.criarUsuario({ email, nome: "QA Prévia", nivel: "total", senha: password }); assert.ok(created.ok); user = created.usuario; }
  token = (await U.abrirSessao(user.id, "127.0.0.1")).token;
  const path = `/api/admin/emails/mensagens/previa?id=${message.id}`;
  const request = auth => fetch(new URL(path, base), { headers: { origin: base.origin, cookie: auth ? `adm=${auth}` : "" } });
  assert.equal((await request()).status, 401); assert.equal((await request(token)).status, 403);
  const messages = [], session = (await U.sessaoPorToken(token));
  await U.pedirStepup(session, async mail => { messages.push(mail.text); }); const otp = /\b\d{6}\b/.exec(messages[0])[0]; assert.ok((await U.confirmarStepup(session, password, otp)).ok);
  const mailSnapshot = async () => (await db.query("SELECT row_to_json(m) data FROM mail_messages m UNION ALL SELECT row_to_json(a) FROM mail_message_attempts a UNION ALL SELECT row_to_json(l) FROM mail_log l UNION ALL SELECT row_to_json(q) FROM mail_outbox q")).rows;
  const mailBefore = await mailSnapshot();
  const response = await request(token); assert.equal(response.status, 200); assert.match(response.headers.get("cache-control") ?? "", /(^|,)\s*no-store\s*(,|$)/); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const preview = await response.json(); assert.equal(preview.state, "ready"); assert.ok(preview.transformed);
  for (const bad of [secret, "123456", "QA_ATTACHMENT_PRIVATE", "blocked.test"]) assert.ok(!JSON.stringify(preview).includes(bad));
  const { chromium } = await import(process.env.QA_PLAYWRIGHT_MODULE ?? "/mnt/apps/peticao-final/_externos/tmp/peticao-ui-hotfix/node_modules/playwright/index.mjs");
  browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROMIUM ?? "/home/barre/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome" });
  const widths = [320, 390, 768, 992, 1280, 1920], shots = [];
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 800 } }), network = [], errors = [], consoleErrors = [];
    page.on("request", r => network.push(r.url())); page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
    await page.setContent("<!doctype html><html><body style='margin:0'><iframe title='QA preview' sandbox='' style='width:100%;height:760px;border:0'></iframe></body></html>");
    await page.evaluate(html => { window.__qaSentinel = "QA_PARENT_PRIVATE"; window.__qaExecuted = false; document.querySelector("iframe").srcdoc = html; }, preview.html);
    const frame = await page.locator("iframe").elementHandle().then(handle => handle.contentFrame());
    await frame.waitForFunction(() => document.body?.textContent.includes("QA PREVIEW SAFE"));
    assert.equal(await frame.locator("script,img,form,iframe,svg,math,object,embed,link,a[href]").count(), 0);
    const access = await frame.evaluate(() => { try { return window.parent.__qaSentinel; } catch { return "blocked"; } }); assert.equal(access, "blocked");
    assert.equal(await page.evaluate(() => window.__qaExecuted), false); assert.ok(!(await frame.locator("body").innerText()).includes("123456"));
    assert.deepEqual(network, []); assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []);
    const shot = `${output}/preview-${width}.png`; await page.screenshot({ path: shot, fullPage: true }); shots.push(shot); await page.close();
  }
  assert.deepEqual(await signerSnapshot(), before); assert.deepEqual(await mailSnapshot(), mailBefore);
  const audit = (await db.query("SELECT data FROM audit_log WHERE event='mail_message_preview' AND data::jsonb->>'messageId'=$1", [message.id])).rows; assert.equal(audit.length, 1); assert.equal(JSON.parse(audit[0].data).por, email);
  const report = { ok: true, compiledAuth: true, stepupRequired: true, auditActor: true, masksApplied: true, noTrackerRequests: true, sandboxIsolated: true, widths, shots, noSignerWrites: true, noMailSent: true };
  await writeFile(`${output}/mail-preview.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ ...report, shots: shots.length }));
} finally { if (browser) await browser.close(); if (token) await U.encerrarSessao(token); await db._closeDbForTests(); }
