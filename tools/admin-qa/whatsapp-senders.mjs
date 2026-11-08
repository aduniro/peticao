// Compiled local app, fictitious catalogue only. No WhatsApp transport is configured or called.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL ?? "http://missing"), database = new URL(process.env.DATABASE_URL ?? "http://missing");
assert.equal(base.hostname, "127.0.0.1"); assert.equal(base.port, "3033");
assert.equal(database.hostname, "127.0.0.1"); assert.ok(["54346", "54349"].includes(database.port));
assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.equal(process.env.MAIL_PROVIDERS, "dev");
assert.equal(process.env.PREVIEW_MODE, "1"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0");
assert.equal(process.env.DATA_ENCRYPTION_KEY, "QA-SENDERS-KEY-NOT-PRODUCTION");
const dm = await import("../../site/src/lib/db.ts"), um = await import("../../site/src/lib/admin-users.ts");
const db = dm.default ?? dm, U = um.default ?? um;
assert.equal((await db.query("SELECT 1 FROM whatsapp_senders")).rowCount, 0);
const owner = await U.criarUsuario({ email: "qa-senders-owner@example.test", nome: "Gestor QA", nivel: "total", senha: "QA-Sender-Compiled-2026" }); assert.ok(owner.ok);
const token = (await U.abrirSessao(owner.usuario.id, "127.0.0.1")).token;
const post = (acao, fields = {}, origin = base.origin) => fetch(new URL("/api/admin/whatsapp/remetentes", base), { method: "POST", redirect: "manual", headers: { origin, cookie: `adm=${token}`, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ acao, rotulo: "QA Browser Sender", ddi: "55", numero: "69999990000", ...fields }) });
const proof = async () => (await db.query("SELECT row_to_json(s)::text raw FROM signatures s ORDER BY id")).rows;
const before = await proof(), mailBefore = (await db.query("SELECT count(*)::int n FROM mail_outbox")).rows[0].n;
let browser;
try {
  assert.equal((await post("add")).status, 403);
  await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=$1", [owner.usuario.id]);
  assert.equal((await post("add", {}, "https://other.example.test")).status, 403);
  await db.query("CREATE FUNCTION qa_fail_sender_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='whatsapp_sender_added' THEN RAISE EXCEPTION 'QA expected sender audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_sender_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_fail_sender_audit()");
  try { assert.equal((await post("add")).status, 500); assert.equal((await db.query("SELECT 1 FROM whatsapp_senders")).rowCount, 0); }
  finally { await db.query("DROP TRIGGER qa_fail_sender_audit ON audit_log; DROP FUNCTION qa_fail_sender_audit()"); }
  assert.equal((await post("add")).status, 303);
  const sender = (await db.query("SELECT * FROM whatsapp_senders")).rows[0];
  const { chromium } = await import(process.env.QA_PLAYWRIGHT_MODULE);
  browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROMIUM, args: ["--disable-dev-shm-usage"] });
  const checks = [], errors = [], archives = [];
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.addCookies([{ name: "adm", value: token, url: base.origin }]);
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.name));
    assert.equal((await page.goto(new URL("/admin/whatsapp", base).href, { waitUntil: "networkidle" })).status(), 200);
    const row = page.getByRole("row").filter({ hasText: "QA Browser Sender" });
    const initial = (await db.query("SELECT revision,active FROM whatsapp_senders WHERE id=$1", [sender.id])).rows[0];
    assert.equal(await row.count(), 1); assert.equal(await row.locator('input[name="revision"]').inputValue(), String(initial.revision));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    {
      await Promise.all([page.waitForURL(url => url.pathname === "/admin/whatsapp" && url.searchParams.get("msg") === "Remetente atualizado."), row.getByRole("button", { name: initial.active ? "Pausar" : "Ativar", exact: true }).click()]);
      assert.equal(await row.locator('input[name="revision"]').inputValue(), String(initial.revision + 1));
      await Promise.all([page.waitForURL(url => url.pathname === "/admin/whatsapp" && url.searchParams.get("msg") === "Remetente removido."), row.getByRole("button", { name: "Remover", exact: true }).click()]);
      assert.equal(await row.count(), 0);
      const archived = (await db.query("SELECT * FROM whatsapp_senders WHERE id=$1", [sender.id])).rows[0];
      assert.ok(archived.archived_at); assert.equal(archived.active, !initial.active); archives.push(archived);
      const archiveFilter = page.getByLabel("Arquivados", { exact: true }); await archiveFilter.check();
      const form = page.locator("form").filter({ has: archiveFilter });
      await Promise.all([page.waitForURL(url => url.searchParams.get("arquivados") === "1"), form.getByRole("button", { name: "Filtrar", exact: true }).click()]);
      assert.equal(await row.count(), 1); assert.equal(await row.getByRole("button", { name: "Remover", exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
      await Promise.all([page.waitForURL(url => url.searchParams.get("msg") === "Remetente restaurado."), row.getByRole("button", { name: "Restaurar", exact: true }).click()]);
      assert.equal(await row.count(), 1); assert.equal(await row.locator('input[name="revision"]').inputValue(), String(initial.revision + 3));
      assert.equal(new URL(page.url()).searchParams.get("arquivados"), null);
    }
    checks.push({ width, read: true, versionField: true, noOverflow: true, mutationThroughNativeForm: true, archiveFilterAndRestore: true });
    await context.close();
  }
  assert.equal(errors.length, 0);
  const restored = (await db.query("SELECT * FROM whatsapp_senders")).rows[0];
  assert.equal(restored.archived_at, null); assert.equal(restored.revision, 7); assert.equal(restored.active, sender.active);
  for (const archived of [...archives, restored]) {
    assert.equal(archived.id, sender.id); assert.equal(archived.phone_cipher, sender.phone_cipher);
    assert.equal(new Date(archived.created_at).toISOString(), new Date(sender.created_at).toISOString());
  }
  assert.equal((await post("toggle", { id: String(sender.id), revision: "1" })).status, 303);
  assert.equal((await db.query("SELECT revision FROM whatsapp_senders")).rows[0].revision, 7);
  await db.query("UPDATE admin_users SET nivel='leitura' WHERE id=$1", [owner.usuario.id]);
  assert.equal((await post("add")).status, 403);
  assert.deepEqual(await proof(), before);
  assert.equal((await db.query("SELECT count(*)::int n FROM mail_outbox")).rows[0].n, mailBefore);
  assert.equal((await db.query("SELECT count(*)::int n FROM whatsapp_messages")).rows[0].n, 0);
  assert.ok((await db.verifyAuditChain()).ok);
  assert.ok(process.env.QA_OUTPUT_DIR); await mkdir(process.env.QA_OUTPUT_DIR, { recursive: true });
  const result = { checks, errors, archivePreservesRecord: true, restorePreservesRecord: true, auditRollback: true, stepupAndOrigin: true, staleVersionRejected: true, revokedRoleRejected: true, signaturesPreserved: true, noMailOrWhatsApp: true };
  await writeFile(`${process.env.QA_OUTPUT_DIR}/whatsapp-senders.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser?.close(); await U.encerrarSessao(token); await db._closeDbForTests(); }
