/** Compiled Next real-handler QA. Ordered phases are controlled by the parent harness. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
const sha = value => createHash("sha256").update(value).digest("hex");
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const inventory = page => page.getByRole("region", { name: "Histórico de confirmações e documentos próprios", exact: true });
const button = (scope, name) => scope.getByRole("button", { name, exact: true });
function guard(ctx) {
  assert.equal(ctx.base, "http://127.0.0.1:3055");
  assert.equal(process.env.DATABASE_URL, "postgres://peticao:peticao@127.0.0.1:54379/peticao");
  assert.equal(process.env.MAIL_PROVIDER, "dev");assert.equal(process.env.MAIL_PROVIDERS, "dev");
  assert.equal(process.env.QA_SITE_DIR, "/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site");
  assert.equal(ctx.output, process.env.QA_OUTPUT_DIR);
  assert.ok(ctx.actor?.nivel === "total" && ctx.actor?.sessaoId && Number.isInteger(ctx.sourceBatchId));
  assert.ok(ctx.U?.abrirSessao && ctx.U?.sessaoPorToken && ctx.U?.encerrarSessao);
  assert.ok(uuid(ctx.ownPdf?.artifactId));assert.match(ctx.ownPdf?.download?.sha256 ?? "", /^[a-f0-9]{64}$/);
}
async function snapshots(db, batchId, artifactId) {
  const batch = (await db.query("SELECT row_to_json(b)::text value FROM batches b WHERE id=$1", [batchId])).rows[0];
  const artifact = (await db.query("SELECT row_to_json(a)::text value FROM president_own_document_artifacts a WHERE id=$1 AND batch_id=$2", [artifactId, batchId])).rows[0];
  assert.ok(batch && artifact);
  const profile = (await db.query("SELECT value FROM settings WHERE key='president_profile_v1'")).rows[0];
  const counts = (await db.query("SELECT (SELECT count(*)::int FROM president_challenges WHERE batch_id=$1) challenges,(SELECT count(*)::int FROM president_own_document_intents WHERE batch_id=$1) intents,(SELECT count(*)::int FROM president_own_document_artifacts WHERE batch_id=$1) artifacts,(SELECT count(*)::int FROM mail_messages) messages,(SELECT count(*)::int FROM mail_outbox) outbox,(SELECT count(*)::int FROM batch_sends) sends", [batchId])).rows[0];
  return { batch: sha(batch.value), artifact: sha(artifact.value), profile: sha(profile.value), counts };
}
async function runPhase(ctx, phase) {
  guard(ctx);
  const { browser, base, actor, db, U, sourceBatchId, ownPdf, output } = ctx;
  const artifact = (await db.query("SELECT id,receipt_id,document_version,bytes,sha256,source_sha256 FROM president_own_document_artifacts WHERE id=$1 AND batch_id=$2", [ownPdf.artifactId, sourceBatchId])).rows[0];
  assert.ok(artifact && sha(artifact.bytes) === artifact.sha256 && artifact.sha256 === ownPdf.download.sha256);
  const before = await snapshots(db, sourceBatchId, artifact.id);
  // New durable admin session, not the session that issued the challenge/generated the own PDF.
  const session = await U.abrirSessao(actor.userId, "127.0.0.1");
  const fresh = await U.sessaoPorToken(session.token);assert.ok(fresh && fresh.nivel === "total");assert.notEqual(fresh.sessaoId, actor.sessaoId);
  await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE id=$1 AND user_id=$2", [fresh.sessaoId, actor.userId]);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, locale: "pt-BR" });
  const errors = [], external = [], requests = [], shots = [];
  try {
    await context.addCookies([{ name: "adm", value: session.token, url: base, httpOnly: true, sameSite: "Lax" }]);
    // No init script, storage state or recovered UUIDs: the only seeded value is a fresh admin cookie.
    await context.route("**/*", route => { const u = new URL(route.request().url());return u.origin === base || u.protocol === "blob:" ? route.continue() : (external.push(u.hostname), route.abort()); });
    const page = await context.newPage();page.on("pageerror", e => errors.push(e.message));
    page.on("request", request => { const u = new URL(request.url());if (u.origin === base && u.pathname.startsWith("/api/")) requests.push({ method: request.method(), path: u.pathname, query: u.search }); });
    await page.goto(`${base}/admin/presidente?lote=${sourceBatchId}`);await inventory(page).waitFor();
    const storageBefore = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
    assert.deepEqual(storageBefore, { local: {}, session: {} }, "fresh browser must not contain prior issuance/generation UUIDs");
    assert.equal(requests.filter(r => r.path.endsWith("/presidente/historico")).length, 0, "inventory remains explicit GET");
    const readKind = async (kind, refresh = false) => {
      const responseWait = page.waitForResponse(response => { const u = new URL(response.url());return u.pathname === `/api/admin/lotes/${sourceBatchId}/presidente/historico` && u.searchParams.get("kind") === kind; });
      // Initially two identical buttons; after receipts are loaded only artifacts retains the initial label.
      await button(inventory(page), refresh ? "Atualizar histórico" : "Consultar histórico").first().click();
      const response = await responseWait;assert.equal(response.status(), 200);assert.equal(response.headers()["cache-control"], "private, no-store");
      const value = await response.json();assert.ok(value.ok && value.batchId === sourceBatchId && value.kind === kind);
      await inventory(page).getByRole("button", { name: "Atualizar histórico", exact: true }).first().waitFor();
      const headingId = await inventory(page).getAttribute("aria-labelledby");
      await page.waitForFunction(id => document.getElementById(id)?.closest("section")?.getAttribute("aria-busy") === "false", headingId);
      return value;
    };
    const receipts = await readKind("receipts");
    const receipt = receipts.receipts.find(row => row.receiptId === artifact.receipt_id);assert.ok(receipt, "consumed receipt must be discoverable without an issuance UUID");
    assert.equal(receipt.documentVersion, artifact.document_version);assert.equal(receipt.isCurrent, phase === "current");
    const row = inventory(page).locator("li").filter({ hasText: artifact.receipt_id });assert.equal(await row.count(), 1);
    const prepare = button(row, "Preparar documento desta confirmação");assert.equal(await prepare.isEnabled(), phase === "current");
    if (phase === "current") {
      await prepare.click();const ownRegion = inventory(page).getByRole("region", { name: "Documento da confirmação própria", exact: true });await ownRegion.waitFor();
      const generate = button(ownRegion, "Gerar PDF da confirmação");await generate.waitFor();
      await generate.evaluate(el => new Promise(resolve => { let n = 0;const check = () => el.disabled && n++ < 500 ? setTimeout(check, 10) : resolve();check(); }));
      assert.equal(await button(ownRegion, "Gerar PDF da confirmação").isEnabled(), true);
      // Opening preparation is not consent to create: no click on Generate, no POST, no nonce persisted.
      assert.equal(requests.filter(r => r.method === "POST").length, 0);
      // A reversible local edit must remove mutation controls immediately, without hiding historical reads.
      const admin = page.getByRole("region", { name: "Assinatura própria do app", exact: true });
      await admin.getByLabel("CPF do responsável", { exact: true }).fill("1");
      assert.equal(await prepare.isDisabled(), true);
      assert.equal(await inventory(page).getByRole("region", { name: "Documento da confirmação própria", exact: true }).count(), 0);
      await inventory(page).waitFor();
      const dirtyRead = await readKind("receipts", true);
      assert.ok(dirtyRead.receipts.find(r => r.receiptId === artifact.receipt_id)?.isCurrent, "server remains current while client profile edit is unsaved");
      assert.equal(await prepare.isDisabled(), true, "a GET during dirty profile cannot enable mutations");
    } else {
      assert.ok(receipts.receipts.every(r => r.isCurrent === false));
      assert.equal(await inventory(page).getByRole("region", { name: "Documento da confirmação própria", exact: true }).count(), 0);
      assert.equal(await inventory(page).getByRole("button", { name: "Assinar com certificado A1", exact: true }).count(), 0, "own A1 control cannot be mounted from historical receipts");
    }
    const artifacts = await readKind("artifacts");const own = artifacts.documents.find(row => row.artifactId === artifact.id);assert.ok(own);
    assert.equal(own.sha256, artifact.sha256);assert.equal(own.source, "president-own");assert.equal(own.icpBrasil, false);assert.equal(own.govBr, false);assert.equal(own.dispatchAllowed, false);
    const noSecrets = JSON.stringify({ receipts, artifacts });for (const key of ["password_hash", "token_hash", "responsible_fingerprint", "cpfHash", "evidence_canonical", "52998224725", "2000-01-01"]) assert.equal(noSecrets.includes(key), false);
    const target = inventory(page).locator(`a[href="/api/admin/presidente/documentos-proprios/${artifact.id}"]`);assert.equal(await target.count(), 1);
    const responseWait = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/presidente/documentos-proprios/${artifact.id}`);
    const downloadWait = page.waitForEvent("download");await target.click();
    const response = await responseWait;assert.equal(response.status(), 200);assert.equal(response.headers()["x-document-sha256"], artifact.sha256);
    assert.equal(response.headers()["x-source-document-sha256"], artifact.source_sha256);
    assert.equal(response.headers()["content-type"], "application/pdf");assert.equal(response.headers()["cache-control"], "private, no-store");
    assert.equal(response.headers()["referrer-policy"], "no-referrer");assert.equal(response.headers()["x-content-type-options"], "nosniff");
    assert.match(response.headers()["content-disposition"] ?? "", /^attachment;/);
    const download = await downloadWait;const path = `${output}/president-own-history-${phase}.pdf`;await download.saveAs(path);chmodSync(path, 0o600);assert.equal(sha(readFileSync(path)), artifact.sha256);
    if (phase === "current") {
      const admin = page.getByRole("region", { name: "Assinatura própria do app", exact: true });
      await admin.getByLabel("CPF do responsável", { exact: true }).fill("");
      assert.equal(await prepare.isDisabled(), true, "clearing the local field cannot clear the edited latch");
      const profileWait = page.waitForResponse(r => new URL(r.url()).pathname === "/api/admin/presidente/perfil" && r.request().method() === "GET");
      await button(admin, "Conferir configuração").click();assert.equal((await profileWait).status(), 200);
      await page.waitForFunction(() => ![...document.querySelectorAll('[role="status"]')].some(e => e.textContent === 'Há alterações não salvas. Salve ou confira a configuração antes de gerar ou compartilhar um acesso.'));
      assert.equal(await prepare.isDisabled(), true, "confirmed profile read still requires a fresh receipt inventory read");
      await readKind("receipts", true);assert.equal(await prepare.isEnabled(), true);
    }
    for (const width of [320, 390, 1280]) { await page.setViewportSize({ width, height: 900 });assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);const shot = `${output}/president-own-history-${phase}-${width}.png`;await page.screenshot({ path: shot, fullPage: true });shots.push({ width, path: shot }); }
    assert.deepEqual(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })), { local: {}, session: {} });
    assert.equal(requests.filter(r => r.method !== "GET").length, 0);assert.deepEqual(await snapshots(db, sourceBatchId, artifact.id), before);
    assert.ok((await db.verifyAuditChain()).ok);assert.deepEqual(errors, []);assert.deepEqual(external, []);
    const result = { ok: true, phase, compiledNextRealHandlers: true, freshAdminSession: true, emptyBrowserStorage: true, noIntentUuidSeed: true, receiptDiscovered: true, receiptCurrent: receipt.isCurrent, ownPdfDiscovered: true, preparationEnabled: phase === "current", ownA1UnavailableForHistorical: phase === "historical", noMutations: true, dirtyProfileBlocksOwnPreparation: phase === "current", downloadAvailableDuringDirtyProfile: phase === "current", profileReadRequiresFreshReceiptRead: phase === "current", sourceProfileArtifactsMailUnchanged: true, download: { artifactId: artifact.id, path, sha256: artifact.sha256 }, requests, shots, errors, external };
    writeFileSync(`${output}/own-history-${phase}-browser-result.json`, JSON.stringify(result, null, 2), { mode: 0o600 });return result;
  } finally { try { await context.close(); } finally { await U.encerrarSessao(session.token); } }
}
/** Call immediately after ownPdfExtension; before combined A1 or profile-changing admin extensions. */
export const runPresidentOwnHistoryCurrentExtension = ctx => runPhase(ctx, "current");
/** Call after the admin extension has changed the current president profile. Creates another clean session. */
export const runPresidentOwnHistoryHistoricalExtension = ctx => runPhase(ctx, "historical");
