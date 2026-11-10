/** Compiled Next/real PostgreSQL pagination extension, no real validator or messages. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
const sha = v => createHash("sha256").update(v).digest("hex");
const cursorPattern = /^pbase1:(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z):([a-f0-9-]{36})$/;
export async function runGovbrPaginationCompiledExtension({ page, context, base, db, output, basePdf, uploadArtifact, actorUserId = 1, posts, effect }) {
  assert.equal(base, "http://127.0.0.1:3053");assert.equal(process.env.DATABASE_URL, "postgres://peticao:peticao@127.0.0.1:54378/peticao");
  assert.equal(process.env.QA_SITE_DIR, "/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site");assert.equal(output, process.env.QA_OUTPUT_DIR);
  assert.equal(process.env.MAIL_PROVIDER, "dev");assert.equal(process.env.MAIL_PROVIDERS, "dev");assert.equal(process.version, "v20.19.2");assert.ok(Buffer.isBuffer(basePdf));
  assert.equal((await db.query("SELECT count(*)::int n FROM petition_base_artifacts")).rows[0].n, 1);
  const existing = (await db.query("SELECT id,sha256 FROM petition_base_artifacts WHERE id=$1", [uploadArtifact])).rows[0];assert.ok(existing && existing.sha256 === sha(basePdf));
  // Synthetic inventory fixtures only. They are not validated, selected, packaged, or represented as signatures.
  const seeded = [];
  for (let n = 1; n <= 44; n++) { const id = randomUUID();seeded.push(id);await db.query("INSERT INTO petition_base_artifacts(id,bytes,sha256,uploaded_by,uploaded_at)VALUES($1,$2,$3,$4,'2026-11-01 00:00:00+00'::timestamptz+$5::int*interval '1 microsecond')", [id, basePdf, sha(basePdf), actorUserId, n]); }
  assert.equal((await db.query("SELECT count(*)::int n FROM petition_base_artifacts")).rows[0].n, 45);
  const selectionSnapshot = async () => sha(JSON.stringify((await db.query("SELECT row_to_json(s)::text value FROM petition_base_selections s ORDER BY revision")).rows));
  const packagesSnapshot = async () => sha(JSON.stringify((await db.query("SELECT row_to_json(p)::text value FROM batch_packages p ORDER BY id")).rows));
  const originalRows = async () => sha(JSON.stringify((await db.query("SELECT id,sha256,octet_length(bytes) byte_length,to_char(uploaded_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') uploaded_at FROM petition_base_artifacts WHERE id<>$1::uuid ORDER BY id", [concurrentId])).rows));
  const validationSnapshot = async () => (await db.query("SELECT (SELECT count(*)::int FROM petition_base_validation_attempts) attempts,(SELECT count(*)::int FROM petition_base_validation_results) results,(SELECT count(*)::int FROM petition_base_validations) validations")).rows[0];
  const beforeValidation = await validationSnapshot();
  const beforeSelection = await selectionSnapshot(), beforePackages = await packagesSnapshot(), beforeMail = await effect(), beforePosts = { ...posts };
  let concurrentId = randomUUID(), loseFirstCursor = true;
  const cursorReads = [], apiRequests = [], pages = [], shots = [], inventoryWaiters = [];
  // Capture DTO bytes through the isolated APIRequestContext before browser navigation can discard CDP bodies.
  const pattern = url => url.origin === base && url.pathname === "/api/admin/documentos/base" && (!url.search || url.searchParams.size === 1 && url.searchParams.has("cursor"));
  const nextInventory = () => new Promise((resolve, reject) => {
    const waiter = { resolve, reject, timer: null };
    waiter.timer = setTimeout(() => { const index = inventoryWaiters.indexOf(waiter);if (index >= 0) inventoryWaiters.splice(index, 1);reject(new Error("Inventory GET was not captured within the QA deadline")); }, 30_000);
    inventoryWaiters.push(waiter);
  });
  const intercept = async route => {
    const request = route.request(), url = new URL(request.url());
    assert.equal(request.method(), "GET");assert.equal(url.origin, base);
    const cursor = url.searchParams.get("cursor");if (cursor !== null) assert.match(cursor, cursorPattern);
    const response = await route.fetch({ maxRedirects: 0 });assert.equal(response.status(), 200);
    const bytes = await response.body(), value = JSON.parse(bytes.toString("utf8"));
    assert.ok(value.ok && value.artifacts.length <= 20);pages.push(value);
    assert.equal(await selectionSnapshot(), beforeSelection, "a real inventory GET must not select a version");
    if (cursor !== null) {
      cursorReads.push({ cursor, status: response.status(), dropped: loseFirstCursor });
      if (loseFirstCursor) { loseFirstCursor = false;return route.abort("failed"); }
    }
    await route.fulfill({ response, body: bytes });
    if (cursor === null) { const waiter = inventoryWaiters.shift();if (waiter) { clearTimeout(waiter.timer);waiter.resolve(value); } }
  };
  const observe = request => { const u = new URL(request.url());if (u.origin === base && u.pathname.startsWith("/api/")) apiRequests.push({ method: request.method(), path: u.pathname, query: u.search }); };
  const dialog = page.locator("dialog[open]"), button = name => dialog.getByRole("button", { name, exact: true }), rows = () => dialog.locator("tbody tr");
  const settled = () => page.waitForFunction(() => document.querySelector("dialog[open] .in")?.getAttribute("aria-busy") === "false");
  const selectedHref = () => dialog.getByRole("link", { name: "Petição-base gov.br", exact: true }).getAttribute("href");
  const rowIds = () => rows().locator("a").evaluateAll(links => links.map(a => a.getAttribute("href").split("/").at(-1)));
  await context.route(pattern, intercept);page.on("request", observe);
  try {
    assert.equal(await dialog.count(), 0, "parent must call after approval navigation, while the modal is closed");
    const initialWait = nextInventory();
    const [first] = await Promise.all([initialWait, page.getByRole("button", { name: "Petição-base gov.br", exact: true }).click()]);
    await settled();assert.equal(await rows().count(), 20);assert.equal(first.hasMore, true);assert.match(first.nextCursor, cursorPattern);
    assert.equal(first.artifacts.length, 20);assert.equal(first.artifacts[0].artifactId, uploadArtifact);assert.equal(first.artifacts.at(-1).uploadedAt, "2026-11-01T00:00:00.000026Z");
    assert.equal(cursorPattern.exec(first.nextCursor)[1], first.artifacts.at(-1).uploadedAt);
    const chosenHref = await selectedHref();assert.equal(chosenHref, `/api/admin/documentos/base/${uploadArtifact}`);
    const beforeIds = await rowIds();assert.equal(new Set(beforeIds).size, 20);
    // New upload concurrent with pagination must be absent from older pages and appear only after refresh.
    await db.query("INSERT INTO petition_base_artifacts(id,bytes,sha256,uploaded_by,uploaded_at)VALUES($1,$2,$3,$4,clock_timestamp()+interval '1 second')", [concurrentId, basePdf, sha(basePdf), actorUserId]);
    assert.equal((await db.query("SELECT count(*)::int n FROM petition_base_artifacts")).rows[0].n, 46);
    const stableArtifacts = await originalRows();
    await button("Carregar mais").evaluate(el => { el.click();el.click(); });await settled();
    await dialog.getByRole("status").filter({ hasText: "Não foi possível carregar mais documentos. Tente novamente." }).waitFor();
    assert.deepEqual(await rowIds(), beforeIds);assert.equal(cursorReads.length, 1);
    await page.waitForTimeout(150);assert.equal(cursorReads.length, 1, "no automatic GET retry after a lost response");
    await button("Carregar mais").click();await settled();assert.equal(await rows().count(), 40);assert.equal(cursorReads.length, 2);assert.equal(cursorReads[0].cursor, cursorReads[1].cursor, "manual retry uses the preserved cursor");
    await button("Carregar mais").click();await settled();assert.equal(await rows().count(), 45);assert.equal(await button("Carregar mais").count(), 0);
    const allIds = await rowIds();assert.equal(new Set(allIds).size, 45);assert.deepEqual(new Set(allIds), new Set([uploadArtifact, ...seeded]));assert.equal(allIds.includes(concurrentId), false);assert.equal(await selectedHref(), chosenHref);
    assert.ok(pages.flatMap(p => p.artifacts).some(a => a.uploadedAt === "2026-11-01T00:00:00.000001Z"));
    assert.equal(await selectionSnapshot(), beforeSelection);assert.equal(await packagesSnapshot(), beforePackages);assert.deepEqual(await effect(), beforeMail);assert.deepEqual(posts, beforePosts);
    const refreshWait = nextInventory();
    const [refreshed] = await Promise.all([refreshWait, button("Atualizar").click()]);await settled();assert.equal(await rows().count(), 20);assert.equal(refreshed.artifacts[0].artifactId, concurrentId);assert.equal((await rowIds())[0], concurrentId);assert.equal(await selectedHref(), chosenHref);
    for (const width of [320, 390, 1280]) { await page.setViewportSize({ width, height: 900 });await button("Carregar mais").scrollIntoViewIfNeeded();assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);const path = `${output}/govbr-pagination-${width}.png`;await page.screenshot({ path, fullPage: false });shots.push({ width, path }); }
    await button("Fechar").click();assert.equal(await originalRows(), stableArtifacts);assert.equal(await selectionSnapshot(), beforeSelection);assert.equal(await packagesSnapshot(), beforePackages);assert.deepEqual(await effect(), beforeMail);assert.deepEqual(posts, beforePosts);assert.ok(apiRequests.every(r => r.method === "GET"));assert.deepEqual(await validationSnapshot(), beforeValidation);assert.equal((await db.query("SELECT count(*)::int n FROM petition_base_artifacts")).rows[0].n, 46);assert.ok((await db.verifyAuditChain()).ok);
    const result = { ok: true, compiledNextUi: true, realGetHandlersPostgres: true, syntheticInventoryOnly: true, existingValidatorContractUntouched: true, artifactsBefore: 1, inventorySeeded: 44, concurrentSeeded: 1, artifactsAfter: 46, pagesLoadedWithoutConcurrent: 45, pageSize: 20, microsecondsPreserved: true, firstCursorTimestamp: cursorPattern.exec(first.nextCursor)[1], responseLostListPreserved: true, dtoBytesCapturedBeforeBrowserFulfill: true, manualRetrySameCursor: true, noAutomaticGetRetry: true, noPostFromExtension: true, selectionPackagesAndMailUnchanged: true, refreshIncludesConcurrent: true, cursorReads, apiRequests, shots, realCryptoHomologation: false };
    writeFileSync(`${output}/govbr-pagination-browser-result.json`, JSON.stringify(result, null, 2), { mode: 0o600 });return result;
  } finally { page.off("request", observe);await context.unroute(pattern, intercept);for (const waiter of inventoryWaiters.splice(0)) { clearTimeout(waiter.timer);waiter.reject(new Error("QA inventory capture closed")); } }
}
