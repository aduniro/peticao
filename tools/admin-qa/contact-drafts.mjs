// Compiled routes + real React editor, own fictitious schema and development delivery only.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL ?? "http://missing"), database = new URL(process.env.DATABASE_URL ?? "http://missing");
assert.equal(base.origin, "http://127.0.0.1:3033"); assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "54349");
assert.equal(process.env.PREVIEW_MODE, "1"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0"); assert.equal(process.env.MAIL_PROVIDER, "dev");
const output = process.env.QA_OUTPUT_DIR; assert.ok(output); await mkdir(output, { recursive: true });
const [db, U, R] = await Promise.all([import("../../site/src/lib/db.ts"), import("../../site/src/lib/admin-users.ts"), import("../../site/src/lib/admin-content-retention.ts")]).then(ms => ms.map(m => m.default ?? m));
let browser; const tokens = [];
try {
  assert.equal((await db.query("SELECT count(*)::int n FROM contact_messages WHERE email NOT LIKE '%@example.test'")).rows[0].n, 0);
  const contacts = (await db.query("INSERT INTO contact_messages(name,email,kind,message,created_at) VALUES('QA Rascunho','qa-draft-contact@example.test','duvida','QA ORIGINAL RECEBIDO: nunca substituir','2026-11-08T10:00:00.123456Z'),('QA Outro','qa-draft-other@example.test','duvida','QA OUTRO CONTATO',now()) RETURNING id")).rows;
  const id = contacts[0].id, original = (await db.query("SELECT row_to_json(c)::text raw FROM contact_messages c ORDER BY id")).rows;
  const actors = [];
  for (const n of [1, 2]) {
    const created = await U.criarUsuario({ email: `qa-draft-browser-${n}@example.test`, nome: `QA Autor ${n}`, nivel: "total", senha: "Ficticia-Draft-Browser-2026" }); assert.ok(created.ok);
    const session = await U.abrirSessao(created.usuario.id, "127.0.0.1"); tokens.push(session.token); actors.push(created.usuario);
  }
  const api = (token, body) => fetch(new URL(`/api/admin/contato/rascunho${body ? "" : `?contato=${id}`}`, base), { method: body ? "POST" : "GET", headers: { origin: base.origin, cookie: `adm=${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await api(tokens[0])).status, 403);
  await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=ANY($1::int[])", [actors.map(a => a.id)]);
  const { chromium } = await import(process.env.QA_PLAYWRIGHT_MODULE);
  browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROMIUM });
  const errors = [], external = [], contexts = [], pages = [];
  for (const [index, width] of [390, 1280].entries()) {
    const context = await browser.newContext({ viewport: { width, height: 900 } }); contexts.push(context);
    await context.addCookies([{ name: "adm", value: tokens[index], url: base.origin, httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage(); pages.push(page); page.on("pageerror", e => errors.push(e.message));
    page.on("request", r => { if (!r.url().startsWith(base.origin) && !r.url().startsWith("data:")) external.push(r.url()); });
  }
  const [first, second] = pages;
  const editor = page => page.getByTestId(`contact-editor-${id}`);
  const open = async (page, expectEnabled = true) => {
    await page.goto(new URL("/admin/contato", base).href);
    const row = page.locator("section.box").filter({ has: page.getByText("QA ORIGINAL RECEBIDO: nunca substituir", { exact: true }) });
    await row.getByRole("button", { name: "Responder", exact: true }).click();
    await editor(page).getByLabel("Assunto", { exact: true }).waitFor();
    if (expectEnabled) await editor(page).getByLabel("Assunto", { exact: true }).isEnabled().then(async enabled => { if (!enabled) await page.waitForFunction(id => !document.querySelector(`[data-testid="contact-editor-${id}"] input`)?.disabled, id); });
    else await editor(page).getByRole("alert").filter({ hasText: "Não foi possível abrir o rascunho salvo." }).waitFor();
  };
  const set = async (page, subject, body) => { await editor(page).getByLabel("Assunto", { exact: true }).fill(subject); await editor(page).locator("textarea").first().fill(body); };
  const save = async page => { await editor(page).getByRole("button", { name: "Salvar rascunho", exact: true }).click(); await editor(page).getByRole("status").filter({ hasText: "Rascunho salvo." }).waitFor(); };
  await open(first); await set(first, "QA Assunto compartilhado", "QA PRIVATE PRIMEIRO RASCUNHO\n\nJosé"); await save(first);
  const deadline = (await db.query("SELECT expires_at FROM contact_drafts WHERE contact_id=$1", [id])).rows[0].expires_at;
  await open(second); assert.equal(await editor(second).locator("textarea").first().inputValue(), "QA PRIVATE PRIMEIRO RASCUNHO\n\nJosé"); assert.match(await editor(second).innerText(), /QA Autor 1/);
  await set(first, "QA Revisão nova", "QA PRIVATE VERSAO NOVA"); await save(first);
  await set(second, "QA Texto local", "QA PRIVATE TEXTO LOCAL PRESERVADO");
  await editor(second).getByRole("button", { name: "Salvar rascunho", exact: true }).click(); await editor(second).getByTestId("draft-conflict").waitFor();
  assert.equal(await editor(second).locator("textarea").first().inputValue(), "QA PRIVATE TEXTO LOCAL PRESERVADO"); assert.match(await editor(second).getByTestId("draft-conflict").innerText(), /QA PRIVATE VERSAO NOVA/);
  await editor(second).getByRole("button", { name: "Salvar meu texto sobre a versão exibida", exact: true }).click(); await editor(second).getByRole("status").waitFor();
  assert.equal((await db.query("SELECT revision FROM contact_drafts WHERE contact_id=$1", [id])).rows[0].revision, 3);
  assert.deepEqual((await db.query("SELECT expires_at FROM contact_drafts WHERE contact_id=$1", [id])).rows[0].expires_at, deadline);
  await open(first); await set(first, "QA Resposta perdida", "QA PRIVATE READBACK");
  let mutationRequests = 0;
  const loseResponse = async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    mutationRequests++; const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort("failed");
  };
  await first.route("**/api/admin/contato/rascunho", loseResponse); await save(first); await first.unroute("**/api/admin/contato/rascunho", loseResponse);
  assert.equal(mutationRequests, 1); assert.equal((await db.query("SELECT revision FROM contact_drafts WHERE contact_id=$1", [id])).rows[0].revision, 4);
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_log WHERE event='contact_draft_saved'")).rows[0].n, 4);
  await db.query("UPDATE contact_drafts SET expires_at=now()-interval '1 second' WHERE contact_id=$1", [id]);
  await open(second); assert.equal(await editor(second).locator("textarea").first().inputValue(), ""); assert.match(await editor(second).innerText(), /rascunho anterior expirou/);
  assert.equal((await R.purgeAdminContent()).drafts, 1);
  await set(first, "QA Antigo", "QA PRIVATE ABA ANTIGA"); await editor(first).getByRole("button", { name: "Salvar rascunho", exact: true }).click(); await editor(first).getByTestId("draft-conflict").waitFor();
  assert.equal(await editor(first).locator("textarea").first().inputValue(), "QA PRIVATE ABA ANTIGA"); assert.ok(!(await editor(first).getByTestId("draft-conflict").innerText()).includes("QA PRIVATE READBACK"));
  await open(second); await set(second, "QA Novo ciclo", "QA PRIVATE NOVO CICLO"); await save(second);
  assert.equal((await db.query("SELECT revision FROM contact_drafts WHERE contact_id=$1", [id])).rows[0].revision, 6);
  const widths = [320, 390, 768, 992, 1280, 1920], shots = [];
  for (const width of widths) { await second.setViewportSize({ width, height: 900 }); const path = `${output}/contact-draft-${width}.png`; await second.screenshot({ path, fullPage: true }); shots.push(path); }
  await editor(second).getByRole("button", { name: "Descartar rascunho", exact: true }).click(); await editor(second).getByRole("status").filter({ hasText: "Rascunho descartado." }).waitFor();
  assert.equal((await db.query("SELECT content_cipher FROM contact_drafts WHERE contact_id=$1", [id])).rows[0].content_cipher, null);
  assert.equal((await api(tokens[0], { contactId: id, revision: 7, input: { assunto: "QA Decifragem", corpo: "QA PRIVATE CIPHER RETRY" } })).status, 200);
  const cipher = (await db.query("SELECT content_cipher FROM contact_drafts WHERE contact_id=$1", [id])).rows[0].content_cipher;
  await db.query("UPDATE contact_drafts SET content_cipher='QA-CIPHER-UNAVAILABLE' WHERE contact_id=$1", [id]);
  await second.setViewportSize({ width: 390, height: 900 }); await open(second, false);
  assert.equal(await editor(second).getByRole("button", { name: "Salvar rascunho", exact: true }).isDisabled(), true);
  assert.equal(await editor(second).getByRole("button", { name: "Ver a prévia dos e-mails", exact: true }).isDisabled(), true);
  assert.equal(await editor(second).getByRole("button", { name: "Descartar rascunho", exact: true }).isEnabled(), true);
  const retryResponse = second.waitForResponse(r => r.url().includes("/api/admin/contato/rascunho?contato=") && r.request().method() === "GET");
  await editor(second).getByRole("button", { name: "Carregar rascunho", exact: true }).click(); assert.equal((await retryResponse).status(), 200);
  await editor(second).getByRole("alert").filter({ hasText: "O conteúdo foi preservado." }).waitFor();
  assert.deepEqual((await db.query("SELECT content_cipher,revision FROM contact_drafts WHERE contact_id=$1", [id])).rows[0], { content_cipher: "QA-CIPHER-UNAVAILABLE", revision: 8 });
  const unavailableShot = `${output}/contact-draft-unavailable-390.png`; await second.screenshot({ path: unavailableShot, fullPage: true }); shots.push(unavailableShot);
  await db.query("UPDATE contact_drafts SET content_cipher=$2 WHERE contact_id=$1", [id, cipher]);
  await editor(second).getByRole("button", { name: "Carregar rascunho", exact: true }).click();
  await second.waitForFunction(id => !document.querySelector(`[data-testid="contact-editor-${id}"] input`)?.disabled, id);
  assert.equal(await editor(second).locator("textarea").first().inputValue(), "QA PRIVATE CIPHER RETRY");
  await editor(second).getByRole("button", { name: "Descartar rascunho", exact: true }).click(); await editor(second).getByRole("status").filter({ hasText: "Rascunho descartado." }).waitFor();
  await open(second); await set(second, "QA Revogado", "QA PRIVATE REVOGADO");
  await db.query("UPDATE admin_users SET ativo=false WHERE id=$1", [actors[1].id]); await editor(second).getByRole("button", { name: "Salvar rascunho", exact: true }).click();
  await editor(second).getByRole("alert").waitFor(); assert.equal(await editor(second).locator("textarea").first().inputValue(), "QA PRIVATE REVOGADO");
  assert.equal((await db.query("SELECT revision FROM contact_drafts WHERE contact_id=$1", [id])).rows[0].revision, 9);
  assert.deepEqual((await db.query("SELECT row_to_json(c)::text raw FROM contact_messages c ORDER BY id")).rows, original);
  assert.equal((await db.query("SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM contact_replies UNION ALL SELECT 1 FROM signatures")).rowCount, 0);
  assert.ok(!JSON.stringify((await db.query("SELECT data FROM audit_log")).rows).includes("QA PRIVATE")); assert.ok((await db.verifyAuditChain()).ok); assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const report = { ok: true, compiledHttp: true, realEditor: true, sharedDraftAndAuthor: true, staleVersionConflictPreservesTypedText: true, explicitConflictResolution: true, lostResponseReadbackWithoutPostRetry: true, fixedDeadline: true, expiryAndTombstone: true, newCycleVersionMonotonic: true, discardClearsCipher: true, unavailableCipherPreservedAndRetry: true, revokedActorRejected: true, originalContactsUnchanged: true, noMailOrSignerWrites: true, noPlaintextAudit: true, widths, shots };
  await writeFile(`${output}/contact-drafts.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ ...report, shots: shots.length }));
} finally { if (browser) await browser.close(); for (const token of tokens) await U.encerrarSessao(token); await db._closeDbForTests(); }
