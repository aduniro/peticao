import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL ?? "http://missing"), database = new URL(process.env.DATABASE_URL ?? "http://missing");
assert.equal(base.hostname, "127.0.0.1"); assert.equal(database.hostname, "127.0.0.1");
assert.ok(base.port === "3033" && database.port === "54346" || base.port === "3043" && database.port === "54363", "Somente pares QA explícitos");
assert.equal(process.env.PREVIEW_MODE, "1"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0");
assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.equal(process.env.MAIL_PROVIDERS, "dev");
const dm = await import("../../site/src/lib/db.ts"), um = await import("../../site/src/lib/admin-users.ts");
const db = dm.default ?? dm, U = um.default ?? um;
assert.equal((await db.query("SELECT 1 FROM contact_messages UNION ALL SELECT 1 FROM signatures UNION ALL SELECT 1 FROM mail_outbox")).rowCount, 0);
const contact = (await db.query("INSERT INTO contact_messages(name,email,kind,message) VALUES('QA Triagem Visual','qa-triage-ui@example.test','duvida','Não recebi o e-mail de confirmação. <strong>QA_HTML_TEXT</strong>') RETURNING id")).rows[0].id;
await db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,status,text_version,consent_at,created_at) VALUES('QA Signer','qa-other-signer@example.test','QA_HASH_EMAIL','QA_HASH_CPF','apoiador','pending','QA','2026-10-01T10:00:00Z','2026-10-01T10:00:00Z')");
const signatures = async () => (await db.query("SELECT row_to_json(s)::text raw FROM signatures s ORDER BY id")).rows;
const before = await signatures();
const editor = await U.criarUsuario({ email: "qa-triage-ui-editor@example.test", nome: "QA Triagem Editor", nivel: "edicao", senha: "QA-Triagem-Visual-2026" }); assert.ok(editor.ok);
const { token } = await U.abrirSessao(editor.usuario.id, "127.0.0.1");
const jobs = async () => (await db.query("SELECT id,revision,status,analysis,evidence,created_at,finished_at FROM contact_triage_jobs WHERE contact_id=$1 ORDER BY revision DESC", [contact])).rows;
const jm = await import("../../site/src/lib/contact-triage/jobs.ts"), J = jm.default ?? jm;
const tick = async () => assert.equal((await J.processTriage()).status, "complete");
const { chromium } = await import(process.env.QA_PLAYWRIGHT_MODULE);
const browser = await chromium.launch({ executablePath: process.env.QA_CHROMIUM, headless: true, args: ["--no-sandbox"] });
const results = [], output = process.env.QA_OUTPUT_DIR; assert.ok(output); await mkdir(output, { recursive: true });
try {
  for (const [index, width] of [390, 320, 768, 992, 1280, 1920].entries()) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": `198.18.0.${index + 30}` } });
    await context.addCookies([{ name: "adm", value: token, url: base.href }]);
    const page = await context.newPage(), exceptions = [], otherWrites = [], external = [];
    await page.route("**/*", route => { const u = route.request().url(); if (u.startsWith(base.origin + "/") || u.startsWith("data:")) return route.continue(); external.push(u); return route.abort(); });
    page.on("pageerror", error => exceptions.push(error.message));
    page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname !== "/api/admin/contato/triagem") otherWrites.push(new URL(request.url()).pathname); });
    let reads = 0, posts = 0, mode = "normal", started, release;
    let began, gate;
    await page.route("**/api/admin/contato/triagem**", async route => {
      if (route.request().method() === "GET") {
        reads++;
        if (mode === "read_error") { await route.abort("failed"); return; }
        if (mode === "malformed") { await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, history: [{ id: 1, contact_id: contact + 99 }] }) }); return; }
      } else {
        posts++;
        if (mode === "hold") { started(); await gate; }
        if (mode === "lost_response") { await route.fetch(); await route.abort("failed"); return; }
      }
      await route.continue();
    });
    await page.route("**/api/admin/contato/minuta**", route => mode === "stale" ? route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ ok: false, error: "analysis_stale" }) }) : route.continue());
    try {
      assert.equal((await page.goto(new URL("/admin/contato", base).href, { waitUntil: "networkidle" })).status(), 200);
      const box = page.getByTestId(`contact-triage-${contact}`), summary = box.locator("summary").first(), action = box.getByRole("button", { name: "Reanalisar", exact: true });
      assert.equal(reads, 0); assert.equal(posts, 0);
      const idle = () => page.waitForFunction(selector => document.querySelector(selector)?.getAttribute("aria-busy") === "false", `[data-testid="contact-triage-${contact}"] > div`);
      if (index === 0) {
        mode = "read_error"; await summary.click(); await box.getByRole("alert").filter({ hasText: "Não foi possível atualizar a análise." }).waitFor(); await idle();
        assert.equal(await action.isEnabled(), true); assert.equal(posts, 0);
        await summary.click(); mode = "normal"; await summary.click(); await idle();
        began = new Promise(resolve => { started = resolve; }); gate = new Promise(resolve => { release = resolve; });
        mode = "hold"; await action.click(); await began;
        try { await action.dispatchEvent("click"); await action.dispatchEvent("click"); } finally { release(); }
        await box.locator("section").first().getByText("Em fila", { exact: true }).waitFor(); await idle(); assert.equal(posts, 1); assert.equal((await jobs()).length, 1);
        mode = "normal"; await tick(); await summary.click(); await summary.click();
        await box.locator("section").first().getByText("Concluída", { exact: true }).waitFor(); await idle();
        const proposal = box.locator("details").filter({ has: page.locator("summary", { hasText: "Sugestão de resposta" }) }); await proposal.locator("summary").waitFor(); assert.equal(await proposal.count(), 1);
        const old = (await jobs())[0];
        const previousReads = reads; await proposal.locator("summary").click(); await page.waitForTimeout(150); assert.equal(reads, previousReads, "Nested expansion must not reload the parent or erase the proposal");
        assert.ok(!(await box.innerText()).includes("lease_token"));
        assert.ok((await box.innerText()).includes("Confirmação por e-mail")); assert.ok((await box.innerText()).includes("Inconclusivo")); assert.ok(!(await box.innerText()).includes("no_registration_for_email"));
        const evidence = box.locator("section").first().locator("details").filter({ has: page.locator("summary", { hasText: "Evidências" }) }); await evidence.locator("summary").click(); assert.match(await evidence.innerText(), /no_registration_for_email/); await evidence.locator("summary").click();
        await action.click(); await box.locator("section").first().getByText("Em fila", { exact: true }).waitFor(); await idle(); await tick();
        await summary.click(); await summary.click(); await box.locator("section").first().getByText("Concluída", { exact: true }).waitFor(); await idle();
        assert.deepEqual((await jobs())[1], old); assert.equal(posts, 2);
        mode = "lost_response"; await action.click(); await box.getByRole("alert").filter({ hasText: "Não foi possível atualizar a análise." }).waitFor(); await idle();
        assert.equal((await jobs()).length, 3); assert.equal(posts, 3); // server committed, browser lost the response; no POST retry.
        mode = "normal"; await tick(); await summary.click(); await summary.click(); await box.locator("section").first().getByText("Concluída", { exact: true }).waitFor(); await idle();
        await summary.click(); mode = "malformed"; await summary.click(); await box.getByRole("alert").filter({ hasText: "Não foi possível atualizar a análise." }).waitFor(); await idle();
        assert.equal((await jobs()).length, 3); await summary.click(); mode = "stale";
        await summary.click(); await box.getByRole("alert").filter({ hasText: "Os dados mudaram. Solicite uma nova análise." }).waitFor(); await idle(); assert.equal(posts, 3);
        await summary.click(); mode = "normal";
        await db.query("UPDATE contact_triage_jobs SET status='failed',error_code='evidence_failure' WHERE contact_id=$1 AND revision=3", [contact]);
        await summary.click(); await box.locator("section").first().getByText("Falha técnica", { exact: true }).waitFor(); await idle(); assert.ok(!(await box.innerText()).includes("evidence_failure"));
        await summary.click(); await db.query("UPDATE contact_triage_jobs SET status='complete',error_code=NULL WHERE contact_id=$1 AND revision=3", [contact]);
        await db.query("UPDATE admin_users SET nivel='leitura' WHERE id=$1", [editor.usuario.id]);
        await summary.click(); await box.getByRole("alert").filter({ hasText: "Não foi possível atualizar a análise." }).waitFor(); await idle(); assert.equal(posts, 3);
        await summary.click(); await db.query("UPDATE admin_users SET nivel='edicao' WHERE id=$1", [editor.usuario.id]);
      }
      await summary.click(); await box.locator("section").first().getByText("Concluída", { exact: true }).waitFor(); await idle();
      const readyProposal = box.locator("details").filter({ has: page.locator("summary", { hasText: "Sugestão de resposta" }) });
      await readyProposal.locator("summary").waitFor(); assert.equal(await readyProposal.count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
      assert.deepEqual(exceptions, []); assert.deepEqual(otherWrites, []); assert.deepEqual(external, []); assert.deepEqual(await signatures(), before);
      assert.equal((await db.query("SELECT 1 FROM contact_replies UNION ALL SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox")).rowCount, 0);
      await page.screenshot({ path: `${output}/contact-triage-${width}.png`, fullPage: true });
      results.push({ width, ok: true, lazyRead: true, revisions: true, readOnlySuggestion: true, noReplyOrSignerWrites: true });
    } finally { await context.close(); }
  }
} finally { await browser.close(); await U.encerrarSessao(token); await db._closeDbForTests(); }
await writeFile(`${output}/contact-triage-ui.json`, JSON.stringify({ results, responseLossReconciledWithoutPostRetry: true, approvedLabels: true, technicalEvidenceCollapsed: true, staleWarning: true, failedJobWarning: true, revokedPermission: true, noExternalRequests: true, nestedExpansionStable: true, oldRevisionPreserved: true }, null, 2));
console.log(JSON.stringify(results));
