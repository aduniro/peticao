// Real compiled SSR list with independent filters/cursor. No delivery or source mutation.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL ?? "http://missing"), database = new URL(process.env.DATABASE_URL ?? "http://missing");
assert.equal(base.hostname, "127.0.0.1"); assert.equal(database.hostname, "127.0.0.1");
assert.ok(base.port === "3033" && database.port === "54349" || base.port === "3038" && database.port === "54358", "Somente pares de portas QA explícitos");
assert.equal(database.pathname, "/peticao"); assert.equal(process.env.DEV_DB_PORT, database.port);
assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.equal(process.env.PREVIEW_MODE, "1"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0");
const output = process.env.QA_OUTPUT_DIR; assert.ok(output); await mkdir(output, { recursive: true });
const [db, U] = await Promise.all([import("../../site/src/lib/db.ts"), import("../../site/src/lib/admin-users.ts")]).then(ms => ms.map(m => m.default ?? m));
let browser; const tokens = [];
try {
  const empty = (await db.query("SELECT 'contacts' kind,count(*)::int n FROM contact_messages UNION ALL SELECT 'signers',count(*)::int FROM signatures UNION ALL SELECT 'drafts',count(*)::int FROM contact_drafts UNION ALL SELECT 'replies',count(*)::int FROM contact_replies UNION ALL SELECT 'messages',count(*)::int FROM mail_messages UNION ALL SELECT 'outbox',count(*)::int FROM mail_outbox UNION ALL SELECT 'users',count(*)::int FROM admin_users")).rows;
  assert.ok(empty.every(row => row.n === 0), "QA exige banco novo sem dados cadastrais, mensagens ou contas anteriores");
  await db.query("INSERT INTO contact_messages(name,email,kind,message) SELECT 'QA Pessoa '||n,'qa-list-'||n||'@example.test',CASE WHEN n%2=0 THEN 'bug' ELSE 'duvida' END,'QA ORIGINAL '||n FROM generate_series(1,60)n");
  const original = (await db.query("SELECT row_to_json(c)::text raw FROM contact_messages c ORDER BY id")).rows;
  for (const nivel of ["edicao", "leitura"]) { const created = await U.criarUsuario({ email: `qa-list-${nivel}@example.test`, nome: "QA Lista", nivel, senha: "Ficticia-Lista-2026" }); assert.ok(created.ok); tokens.push((await U.abrirSessao(created.usuario.id, "127.0.0.1")).token); }
  const denied = await fetch(new URL("/admin/contato", base), { headers: { cookie: `adm=${tokens[1]}` }, redirect: "manual" }); assert.ok([303, 307].includes(denied.status)); assert.match(denied.headers.get("location"), /erro=nivel/);
  const { chromium } = await import(process.env.QA_PLAYWRIGHT_MODULE);
  browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROMIUM });
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } }); await context.addCookies([{ name: "adm", value: tokens[0], url: base.origin, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage(), errors = [], external = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("**/*", route => {
    const target = route.request().url();
    if (target.startsWith(base.origin + "/") || target.startsWith("data:")) return route.continue();
    external.push(target); return route.abort("blockedbyclient");
  });
  const ids = () => page.locator("[data-contact-id]").evaluateAll(nodes => nodes.map(n => Number(n.dataset.contactId)));
  await page.goto(new URL("/admin/contato", base).href); assert.equal((await ids()).length, 25); assert.equal(await page.getByRole("button", { name: "Responder", exact: true }).count(), 0);
  const filters = page.getByTestId("contact-list-filters"); await filters.getByLabel("Tipo", { exact: true }).selectOption("bug"); await filters.getByLabel("Nome ou e-mail", { exact: true }).fill("QA");
  await Promise.all([page.waitForURL(url => url.searchParams.get("tipo") === "bug" && url.searchParams.get("busca") === "QA"), filters.getByRole("button", { name: "Filtrar", exact: true }).click()]);
  const first = await ids(); assert.equal(first.length, 25); assert.ok(first.every(n => n % 2 === 0));
  await db.query("INSERT INTO contact_messages(name,email,kind,message) VALUES('QA Nova','qa-new@example.test','bug','QA NEW INSERT')");
  await Promise.all([page.waitForURL(url => url.searchParams.has("antes")), page.getByRole("link", { name: "Próximas mensagens", exact: true }).click()]);
  assert.equal(new URL(page.url()).searchParams.get("tipo"), "bug"); assert.equal(new URL(page.url()).searchParams.get("busca"), "QA");
  const last = await ids(); assert.equal(last.length, 5); assert.ok(last.every(n => n % 2 === 0)); assert.equal(new Set([...first, ...last]).size, 30);
  assert.equal(await page.getByRole("link", { name: "Próximas mensagens", exact: true }).count(), 0);
  const shots = [];
  for (const width of [320, 390, 1280]) { await page.setViewportSize({ width, height: 900 }); const path = `${output}/contact-list-${width}.png`; await page.screenshot({ path, fullPage: true }); shots.push(path); }
  await Promise.all([page.waitForURL(url => !url.searchParams.has("antes")), page.getByRole("link", { name: "Primeira página", exact: true }).click()]); assert.equal((await ids())[0], 61);
  await page.goto(new URL("/admin/contato?tipo=bug&busca=qa-list-2%40example.test", base).href); assert.deepEqual(await ids(), [2]);
  await page.goto(new URL("/admin/contato?busca=ABSENT", base).href); assert.deepEqual(await ids(), []); assert.match(await page.locator("main").innerText(), /Nenhuma mensagem encontrada/);
  await page.goto(new URL("/admin/contato?tipo=invalid&antes=01", base).href); assert.match(await page.getByRole("alert").innerText(), /Não foi possível aplicar os filtros/);
  await db.query("ALTER TABLE contact_messages RENAME TO qa_contact_list_unavailable");
  try { await page.goto(new URL("/admin/contato", base).href); assert.match(await page.getByRole("alert").innerText(), /Não foi possível carregar as mensagens/); assert.ok(!(await page.locator("main").innerText()).includes("0 mensagem(ns)")); }
  finally { await db.query("ALTER TABLE qa_contact_list_unavailable RENAME TO contact_messages"); }
  await page.goto(new URL("/admin/contato", base).href); assert.equal((await ids()).length, 25);
  assert.deepEqual((await db.query("SELECT row_to_json(c)::text raw FROM contact_messages c WHERE email<>'qa-new@example.test' ORDER BY id")).rows, original);
  assert.equal((await db.query("SELECT 1 FROM signatures UNION ALL SELECT 1 FROM contact_replies UNION ALL SELECT 1 FROM contact_drafts UNION ALL SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox")).rowCount, 0); assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const report = { ok: true, compiledSsr: true, editRoleCanReadWithoutReplyPermission: true, readOnlyRoleDenied: true, cumulativeFilters: true, keysetPagesNoDuplicatesAfterNewContact: true, filtersRetainedAcrossPages: true, firstPageShowsNewContact: true, emptyAndInvalidFiltersVisible: true, sourceFailureAndRecovery: true, originalContactsPreserved: true, noSignerDraftOrMailWrites: true, noExternalBrowserRequests: true, shots };
  await writeFile(`${output}/contact-list.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ ...report, shots: shots.length }));
} finally { if (browser) await browser.close(); for (const token of tokens) await U.encerrarSessao(token); await db._closeDbForTests(); }
