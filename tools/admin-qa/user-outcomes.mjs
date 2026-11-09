// Compiled account result UI. Fresh local database, fictional recipients, dev mail only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
const base = new URL(process.env.QA_BASE_URL), database = new URL(process.env.DATABASE_URL);
assert.equal(base.origin, "http://127.0.0.1:3039"); assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "54359");
assert.equal(process.env.DATABASE_SCHEMA, "qa_user_outcomes"); assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.equal(process.env.MAIL_PROVIDERS, "dev");
assert.equal(process.env.PREVIEW_MODE, "1"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0");
const { Pool } = createRequire(new URL("../../site/package.json", import.meta.url))("pg");
const pool = new Pool({ connectionString: database.href });
try { await pool.query('CREATE SCHEMA "qa_user_outcomes"'); } finally { await pool.end(); }
const [db, U] = await Promise.all([import("../../site/src/lib/db.ts"), import("../../site/src/lib/admin-users.ts")]).then(ms => ms.map(m => m.default ?? m));
let browser, server, stopped; const tokens = [];
try {
  assert.equal((await db.query("SELECT 1 FROM signatures UNION ALL SELECT 1 FROM admin_users")).rowCount, 0);
  const accounts = [];
  for (const nivel of ["total", "leitura"]) {
    const u = await U.criarUsuario({ email: `qa-outcomes-${nivel}@example.test`, nome: "QA Contas", nivel, senha: "QA-Senha-8" }); assert.ok(u.ok); accounts.push(u.usuario);
    tokens.push((await U.abrirSessao(u.usuario.id, "127.0.0.1")).token);
  }
  await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE user_id=$1", [accounts[0].id]);
  const target = await U.criarUsuario({ email: "qa-outcomes-quota@example.test", nome: "QA Quota", nivel: "leitura", senha: "QA-Senha-8" }); assert.ok(target.ok);
  for (let i = 0; i < 3; i++) assert.equal((await U.pedirReset(target.usuario.email, { origin: base.origin, enviar: async () => "sent" })).estado, "sent");
  const resetCount = async () => (await db.query("SELECT count(*)::int n FROM admin_reset WHERE user_id=$1", [target.usuario.id])).rows[0].n;
  const out = createWriteStream(`${process.env.QA_OUTPUT_DIR}/server.log`);
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3039"], { env: process.env }); stopped = once(server, "exit"); server.stdout.pipe(out); server.stderr.pipe(out);
  let ready = false;
  for (let i = 0; i < 120; i++) { assert.equal(server.exitCode, null); try { ready = (await fetch(new URL("/admin", base))).status === 200; } catch {} if (ready) break; await new Promise(r => setTimeout(r, 500)); }
  assert.ok(ready);
  const { chromium } = await import(process.env.QA_PLAYWRIGHT_MODULE); browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROMIUM });
  const context = await browser.newContext(); await context.addCookies([{ name: "adm", value: tokens[0], url: base.origin }]);
  const page = await context.newPage(), errors = [], external = []; let posts = 0;
  page.on("pageerror", e => errors.push(e.message)); page.on("request", r => { if (r.method() === "POST") posts++; if (!r.url().startsWith(base.origin) && !r.url().startsWith("data:")) external.push(r.url()); });
  const queued = "Solicitação registrada. O e-mail está na fila de envio.", uncertain = "Não foi possível confirmar o envio do e-mail. Confira a situação do usuário antes de tentar novamente.";
  const widths = [320, 390, 768, 992, 1280, 1920], shots = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 }); await page.goto(new URL("/admin/usuarios?msg=email_fila", base).href);
    assert.equal(await page.getByRole("status").innerText(), queued);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.goto(new URL("/admin/usuarios?erro=email_incerto", base).href);
    assert.equal(await page.getByRole("alert").filter({ hasText: uncertain }).innerText(), uncertain);
    const shot = `${process.env.QA_OUTPUT_DIR}/user-outcome-${width}.png`; await page.screenshot({ path: shot, fullPage: true }); shots.push(shot);
  }
  await page.setViewportSize({ width: 390, height: 900 }); await page.goto(new URL("/admin/usuarios", base).href);
  await page.locator("tbody tr").filter({ hasText: target.usuario.email }).getByRole("button", { name: "Enviar link de nova senha", exact: true }).click();
  await page.waitForURL("**/admin/usuarios?erro=email_incerto"); assert.equal(await page.getByRole("alert").filter({ hasText: uncertain }).innerText(), uncertain); assert.equal(await resetCount(), 3); assert.equal(posts, 1);
  const create = async email => {
    const form = page.locator('form').filter({ has: page.locator('input[name="acao"][value="criar"]') });
    await form.locator('input[name="nome"]').fill("QA Pessoa"); await form.locator('input[name="email"]').fill(email);
    await form.getByRole("button", { name: "Criar e enviar o convite", exact: true }).click();
  };
  await create("qa-outcomes-created@example.test"); await page.waitForURL("**/admin/usuarios?msg=criado"); assert.equal(posts, 2);
  await db.query("CREATE FUNCTION qa_fail_invite_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='admin_convite_enviado' THEN RAISE EXCEPTION 'QA expected outcome failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_invite_result BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_fail_invite_result()");
  try {
    await create("qa-outcomes-uncertain@example.test"); await page.waitForURL("**/admin/usuarios?erro=email_incerto"); assert.equal(await page.getByRole("alert").filter({ hasText: uncertain }).innerText(), uncertain); assert.equal(posts, 3);
    assert.equal((await db.query("SELECT 1 FROM admin_users WHERE email='qa-outcomes-uncertain@example.test'")).rowCount, 1);
  } finally { await db.query("DROP TRIGGER qa_fail_invite_result ON audit_log; DROP FUNCTION qa_fail_invite_result()"); }
  await context.addCookies([{ name: "adm", value: tokens[1], url: base.origin }]); await page.goto(new URL("/admin/usuarios", base).href); assert.equal(new URL(page.url()).pathname, "/admin");
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.equal((await db.query("SELECT 1 FROM signatures")).rowCount, 0); assert.equal((await db.query("SELECT 1 FROM mail_outbox")).rowCount, 0);
  const result = { ok: true, widths, shots, actualQuotaNoNewToken: true, actualCreation: true, uncertainAfterCreationPreserved: true, queueNotice: "rendered; queue handler proven in directed tests", noAutomaticResubmit: posts === 3, nonOwnerDenied: true, noExternalRequests: true, noSignerWrites: true };
  await writeFile(`${process.env.QA_OUTPUT_DIR}/user-outcomes.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  if (server) { server.kill("SIGTERM"); const timer = setTimeout(() => server.kill("SIGKILL"), 10000); await stopped; clearTimeout(timer); }
  for (const token of tokens) await U.encerrarSessao(token);
  await db._closeDbForTests();
}
