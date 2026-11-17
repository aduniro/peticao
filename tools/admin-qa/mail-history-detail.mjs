// Read-only metadata UI: fresh local DB, fictional actors and no real delivery.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL), database = new URL(process.env.DATABASE_URL);
assert.equal(base.origin, "http://127.0.0.1:3037"); assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "54358");
assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.equal(process.env.PREVIEW_MODE, "1"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0");
assert.equal(process.env.DATABASE_SCHEMA, "qa_history_detail");
const { Pool } = createRequire(new URL("../../site/package.json", import.meta.url))("pg");
const setup = new Pool({ connectionString: database.href });
try { await setup.query('CREATE SCHEMA "qa_history_detail"'); } finally { await setup.end(); }
const [db, U, A] = await Promise.all([import("../../site/src/lib/db.ts"), import("../../site/src/lib/admin-users.ts"), import("../../site/src/lib/mail/archive.ts")]).then(ms => ms.map(m => m.default ?? m));
let browser, server, stopped; const tokens = [];
try {
  assert.equal((await db.query("SELECT 1 FROM signatures UNION ALL SELECT 1 FROM mail_messages")).rowCount, 0);
  const mail = { to: "qa-history-reader@example.test", subject: "QA_PRIVATE_SUBJECT_NOT_METADATA", text: "QA_PRIVATE_BODY_NOT_METADATA" };
  const message = await A.prepareMessage(mail, "confirmacao", "transactional", { archive: { until: new Date(Date.now() + 3600000) } });
  const attempt = await A.beginAttempt(message.id, "dev", "qa-sender@example.test"); assert.ok(attempt.ok); assert.ok((await A.finishAttempt(attempt.id, "accepted", { providerId: "QA_PROVIDER_ID", accountScope: "a".repeat(64) })).ok);
  await db.query("INSERT INTO mail_message_events(fingerprint,provider,account_scope,provider_id,recipient,event_type,occurred_at,source,association_state,message_id,attempt_id) VALUES('QA-EVENT-FINGERPRINT','dev',$1,'QA_PROVIDER_ID',$2,'delivered',now(),'api','linked',$3,$4)", ["a".repeat(64), mail.to, message.id, attempt.id]);
  const legacy = (await db.query("INSERT INTO mail_log(kind,provider,to_addr,status) VALUES('confirmacao','dev','qa-legacy@example.test','sent') RETURNING id")).rows[0].id;
  const saved = async () => (await db.query("SELECT row_to_json(m)::text raw FROM mail_messages m UNION ALL SELECT row_to_json(a)::text FROM mail_message_attempts a UNION ALL SELECT row_to_json(e)::text FROM mail_message_events e UNION ALL SELECT row_to_json(l)::text FROM mail_log l")).rows;
  const before = await saved(), actors = [];
  for (const nivel of ["edicao", "leitura"]) { const u = await U.criarUsuario({ email: `qa-history-${nivel}@example.test`, nome: "QA Histórico", nivel, senha: "QA-Historico-2026-Ficticia" }); assert.ok(u.ok); actors.push(u.usuario); tokens.push((await U.abrirSessao(u.usuario.id, "127.0.0.1")).token); }
  const out = createWriteStream(`${process.env.QA_OUTPUT_DIR}/server.log`); server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3037"], { env: process.env }); stopped = once(server, "exit"); server.stdout.pipe(out); server.stderr.pipe(out);
  let ready = false; for (let n = 0; n < 120; n++) { assert.equal(server.exitCode, null); try { ready = (await fetch(new URL("/admin", base))).status === 200; } catch {} if (ready) break; await new Promise(r => setTimeout(r, 500)); } assert.ok(ready);
  const endpoint = `/api/admin/emails/mensagens?id=message:${message.id}`;
  assert.equal((await fetch(new URL(endpoint, base))).status, 401);
  assert.equal((await fetch(new URL(endpoint, base), { headers: { cookie: `adm=${tokens[1]}`, origin: base.origin } })).status, 403);
  const { chromium } = await import(process.env.QA_PLAYWRIGHT_MODULE); browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROMIUM });
  const context = await browser.newContext(); await context.addCookies([{ name: "adm", value: tokens[0], url: base.origin }]);
  const page = await context.newPage(), errors = [], external = []; let posts = 0;
  page.on("pageerror", e => errors.push(e.message)); page.on("request", r => { if (r.method() === "POST") posts++; if (!r.url().startsWith(base.origin) && !r.url().startsWith("data:")) external.push(r.url()); });
  const shots = [], widths = [320, 390, 768, 992, 1280, 1920];
  const row = () => page.getByTestId("mail-preview-history").locator("tr").filter({ hasText: `message:${message.id}` });
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 }); await page.goto(new URL("/admin/emails", base).href);
    assert.equal(await page.getByTestId("mail-preview-history").getByRole("button", { name: "Ver prévia protegida", exact: true }).count(), 0);
    await row().getByRole("button", { name: "Histórico", exact: true }).click(); const modal = page.locator('dialog[open][data-testid="mail-message-detail"]'); await modal.getByText("QA_PROVIDER_ID", { exact: true }).waitFor();
    const text = await modal.innerText(); assert.match(text, /Aceita pelo provedor/); assert.match(text, /não comprova entrega/); assert.match(text, /Entrega informada pelo provedor/);
    for (const privateText of [mail.subject, mail.text]) assert.ok(!(await page.content()).includes(privateText));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const close = modal.getByRole("button", { name: "Fechar", exact: true }), bounds = await close.boundingBox(); assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 900);
    const shot = `${process.env.QA_OUTPUT_DIR}/history-detail-${width}.png`; await page.screenshot({ path: shot, fullPage: true }); shots.push(shot); await close.click();
  }
  const legacyRow = page.getByTestId("mail-preview-history").locator("tr").filter({ hasText: `legacy:${legacy}` }); await legacyRow.getByRole("button", { name: "Histórico", exact: true }).click();
  const modal = page.locator('dialog[open][data-testid="mail-message-detail"]'); await modal.getByText(/Registro anterior: uma tentativa antiga/).waitFor(); await modal.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.route("**/api/admin/emails/mensagens?id=*", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) }));
  await row().getByRole("button", { name: "Histórico", exact: true }).click(); await page.locator('dialog[open] [role="alert"]').waitFor(); assert.equal(await row().count(), 1); await page.locator('dialog[open]').getByRole("button", { name: "Fechar", exact: true }).click();
  await page.unroute("**/api/admin/emails/mensagens?id=*"); await row().getByRole("button", { name: "Histórico", exact: true }).click(); await page.locator('dialog[open]').getByText("QA_PROVIDER_ID", { exact: true }).waitFor(); await page.locator('dialog[open]').getByRole("button", { name: "Fechar", exact: true }).click();
  await db.query("UPDATE admin_users SET nivel='leitura' WHERE id=$1", [actors[0].id]); await row().getByRole("button", { name: "Histórico", exact: true }).click(); await page.locator('dialog[open] [role="alert"]').waitFor();
  assert.equal(posts, 0); assert.deepEqual(external, []); assert.deepEqual(errors, []); assert.deepEqual(await saved(), before);
  assert.equal((await db.query("SELECT 1 FROM signatures UNION ALL SELECT 1 FROM mail_outbox")).rowCount, 0); assert.equal((await db.query("SELECT 1 FROM audit_log WHERE event='mail_message_preview'")).rowCount, 0);
  const report = { ok: true, compiledReadOnlyMetadataUi: true, editRoleWithoutContentPreview: true, readRoleDenied: true, anonymousDenied: true, revokedRoleDenied: true, attemptsAndLinkedEvents: true, acceptanceIsNotDelivery: true, legacyNotReconstructed: true, failureRetainsList: true, recoveryByManualRead: true, noPost: true, noContentDecryption: true, originalJournalPreserved: true, noSignerOrQueueWrites: true, widths, shots };
  await writeFile(`${process.env.QA_OUTPUT_DIR}/mail-history-detail.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally {
  if (browser) await browser.close(); if (server) { server.kill("SIGTERM"); const timer = setTimeout(() => server.kill("SIGKILL"), 10000); await stopped; clearTimeout(timer); }
  for (const token of tokens) await U.encerrarSessao(token); await db._closeDbForTests();
}
