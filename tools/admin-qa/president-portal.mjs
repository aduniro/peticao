// Compiled portal contract. Fictitious fresh local database; no delivery or external services.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const base = new URL(process.env.QA_BASE_URL), database = new URL(process.env.DATABASE_URL);
assert.equal(base.origin, "http://127.0.0.1:3039"); assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "54360");
assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.equal(process.env.PREVIEW_MODE, "0"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0");
const output = process.env.QA_OUTPUT_DIR; assert.ok(output);
const [db, U, B] = await Promise.all([import("../../site/src/lib/db.ts"), import("../../site/src/lib/admin-users.ts"), import("../../site/src/lib/batches.ts")]).then(ms => ms.map(m => m.default ?? m));
let browser; const tokens = [];
const req = (path, token, body, origin = base.origin) => fetch(new URL(path, base), { redirect: "manual", headers: { cookie: `adm=${token ?? ""}`, ...(body !== undefined ? { origin, "content-type": "application/x-www-form-urlencoded" } : {}) }, ...(body !== undefined ? { method: "POST", body } : {}) });
try {
  assert.equal((await db.query("SELECT 1 FROM signatures UNION ALL SELECT 1 FROM batches UNION ALL SELECT 1 FROM admin_users UNION ALL SELECT 1 FROM mail_messages")).rowCount, 0);
  const users = {};
  for (const nivel of ["total", "edicao", "leitura"]) { const c = await U.criarUsuario({ email: `qa-president-${nivel}@example.test`, nome: "QA Presidente", nivel, senha: "Ficticia-Portal-2026" }); assert.ok(c.ok); users[nivel] = c.usuario; tokens.push((await U.abrirSessao(c.usuario.id, "127.0.0.1")).token); }
  const token = tokens[0], actor = { userId: users.total.id, email: users.total.email };
  for (const t of [tokens[1], tokens[2]]) { assert.match((await req("/admin/presidente", t)).headers.get("location"), /erro=nivel/); assert.equal((await req("/api/admin/lotes/1/pdf", t)).status, 403); }
  assert.equal((await req("/api/admin/lotes/1/pdf")).status, 401);
  assert.match((await req("/admin/presidente", token)).headers.get("location"), /confirmar/);
  assert.equal((await req("/api/admin/lotes/1/preparar", token, "")).status, 403);
  await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE user_id=$1", [actor.userId]);
  await db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,city,uf,text_version,consent_at,status,confirmed_at) VALUES('Pessoa Original QA','qa-original@example.test','QA-E','QA-C','apoiador','Porto Velho','RO','QA',now(),'confirmed',now())");
  await db.query("CREATE FUNCTION qa_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='batch_prepared' THEN RAISE EXCEPTION 'QA preparation fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fault BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_fault()");
  await assert.rejects(B.createBatchForAdmin("final", actor), /QA preparation fault/);
  await db.query("DROP TRIGGER qa_fault ON audit_log; DROP FUNCTION qa_fault()");
  const frozen = (await db.query("SELECT snapshot,snapshot_sha256 FROM batch_preparations WHERE batch_id=1")).rows;
  await db.query("UPDATE signatures SET name='Pessoa posterior QA' WHERE id=1");
  const originalSigners = (await db.query("SELECT row_to_json(s)::text raw FROM signatures s ORDER BY id")).rows;
  await db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash) VALUES(2,'partial','preparing',0,1,'QA-LEGACY')");
  for (const [path, body, status] of [["/api/admin/lotes/1/preparar", "userId=9", 400], ["/api/admin/lotes/01/preparar", "", 400]]) assert.equal((await req(path, token, body)).status, status);
  assert.equal((await req("/api/admin/lotes/1/preparar", token, "", "https://foreign.example.test")).status, 403);
  const { chromium } = await import(process.env.QA_PLAYWRIGHT_MODULE); browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROMIUM });
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } }); await context.addCookies([{ name: "adm", value: token, url: base.origin, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage(), errors = [], external = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("**/*", route => { const u = route.request().url(); if (u.startsWith(base.origin + "/") || u.startsWith("data:")) return route.continue(); external.push(u); return route.abort(); });
  await page.goto(new URL("/admin/presidente?lote=2", base).href); assert.match(await page.locator("main").innerText(), /lote antigo não tem snapshot/); assert.equal(await page.getByRole("button", { name: "Retomar preparo do PDF", exact: true }).count(), 0);
  await page.goto(new URL("/admin/presidente?lote=1", base).href); assert.equal(await page.getByRole("button", { name: "Fechar lote final agora", exact: true }).isDisabled(), true);
  await Promise.all([page.waitForURL(url => url.searchParams.has("msg")), page.getByRole("button", { name: "Retomar preparo do PDF", exact: true }).click()]);
  assert.match(await page.locator("main").innerText(), /PDF preparado com a lista reservada/);
  const row = (await db.query("SELECT * FROM batches WHERE id=1")).rows[0]; assert.equal(row.status, "prepared"); assert.equal(row.n_apoiador, 1); assert.equal(row.pdf.subarray(0, 5).toString(), "%PDF-");
  assert.deepEqual((await db.query("SELECT snapshot,snapshot_sha256 FROM batch_preparations WHERE batch_id=1")).rows, frozen);
  await writeFile(`${output}/portal-original.pdf`, row.pdf);
  const downloads = [];
  for (const query of ["", "?previa=1"]) { const r = await req(`/api/admin/lotes/1/pdf${query}`, token); assert.equal(r.status, 200); assert.deepEqual(Buffer.from(await r.arrayBuffer()), row.pdf); const cache = r.headers.get("cache-control").split(",").map(v => v.trim()); assert.ok(cache.includes("private") && cache.includes("no-store")); assert.ok(!cache.includes("public")); assert.equal(r.headers.get("x-content-type-options"), "nosniff"); assert.match(r.headers.get("content-disposition"), new RegExp(query ? "^inline" : "^attachment")); downloads.push(query); }
  assert.equal((await req("/api/admin/lotes/1/pdf?assinado=1", token)).status, 404);
  for (const name of ["Enviar código ao aprovador", "Aprovar e enviar"]) assert.equal(await page.getByRole("button", { name, exact: true }).isDisabled(), true);
  const alternate = Buffer.concat([row.pdf, Buffer.from("\n% QA technical stored variant; NOT A SIGNATURE\n")]);
  await db.query("UPDATE batches SET signed_pdf=$2 WHERE id=$1", [1, alternate]);
  const signed = await req("/api/admin/lotes/1/pdf?assinado=1", token); assert.equal(signed.status, 200); assert.deepEqual(Buffer.from(await signed.arrayBuffer()), alternate); assert.match(signed.headers.get("content-disposition"), /lote-1-assinado/);
  await db.query("UPDATE batches SET signed_pdf=NULL WHERE id=1");
  for (const name of ["Assinatura própria do app", "gov.br"]) assert.equal(await page.getByRole("button", { name, exact: true }).isDisabled(), true);
  const guard = await req("/api/admin/lotes/1/aprovar?portal=presidente", token, "code=123456"); assert.equal(guard.status, 303); assert.match(new URL(guard.headers.get("location")).searchParams.get("msg"), /ICP-Brasil/);
  await db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf,pdf_sha256,signature_kind) SELECT n,'partial','prepared',0,1,'QA-'||n,$1,$2,'none' FROM generate_series(3,56)n", [row.pdf, createHash("sha256").update(row.pdf).digest("hex")]);
  await page.goto(new URL("/admin/presidente", base).href); assert.equal(await page.locator("main tbody tr").count(), 50); assert.match(await page.locator("main").innerText(), /Lote 1/);
  const shots = [];
  for (const width of [320,390,768,1024,1280,1440]) { await page.setViewportSize({ width, height: 900 }); const path = `${output}/president-${width}.png`; await page.screenshot({ path, fullPage: true }); shots.push(path); }
  await page.getByRole("link", { name: "Mais antigos", exact: true }).click(); assert.equal(await page.locator("main tbody tr").count(), 6);
  const open = page.getByRole("link", { name: "Abrir documento", exact: true }).first(); const selected = new URL(await open.getAttribute("href"), base); await open.click(); assert.equal(new URL(page.url()).searchParams.get("lote"), selected.searchParams.get("lote"));
  assert.equal((await req("/admin/presidente?lote=01", token)).status, 404); assert.equal((await req("/admin/presidente?lote=2147483647", token)).status, 404);
  await db.query("UPDATE admin_users SET ativo=false WHERE id=$1", [actor.userId]); assert.equal((await req("/api/admin/lotes/1/pdf", token)).status, 401);
  assert.deepEqual((await db.query("SELECT row_to_json(s)::text raw FROM signatures s ORDER BY id")).rows, originalSigners);
  assert.equal((await db.query("SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM batch_sends")).rowCount, 0);
  assert.ok((await db.verifyAuditChain()).ok); assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const report = { ok: true, compiled: true, rolesAndStepup: true, invalidBodiesAndOrigin: true, legacyFailsClosed: true, recoveryUsesFrozenSnapshot: true, exactPdfBytesAndHeaders: true, icpProductionGuard: true, inactiveAccountRevalidated: true, paginationAndSelection: true, originalSignersUnchanged: true, noMailWritesOrExternalRequests: true, shots };
  await writeFile(`${output}/president-portal.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { if (browser) await browser.close(); for (const token of tokens) await U.encerrarSessao(token); await db._closeDbForTests(); }
