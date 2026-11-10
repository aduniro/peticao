/** Draft compiled ADMIN own-PDF scenario. Execute only after store/schema/UI are integrated. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, chmodSync } from "node:fs";

const sha = value => createHash("sha256").update(value).digest("hex");
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const region = page => page.getByRole("region", { name: "Assinatura própria do app", exact: true });
const ownRegion = page => page.getByRole("region", { name: "Documento da confirmação própria", exact: true });
const button = (scope, name) => scope.getByRole("button", { name, exact: true });

export async function runPresidentOwnPdfExtension({ browser, base, sessionToken, actor, db, store, output, sourceBatchId, issued, documentVersion, profileFingerprint, receiptId }) {
  assert.equal(base, "http://127.0.0.1:3055");
  assert.equal(process.env.DATABASE_URL, "postgres://peticao:peticao@127.0.0.1:54379/peticao");
  assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.equal(process.env.MAIL_PROVIDERS, "dev");
  assert.equal(process.env.QA_SITE_DIR, "/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site");
  assert.equal(output, process.env.QA_OUTPUT_DIR);
  assert.ok(actor?.sessaoId && actor.nivel === "total");
  assert.ok(issued?.ok && uuid(issued.id) && uuid(issued.requestId));
  assert.ok(uuid(receiptId) && /^[a-f0-9]{64}$/.test(documentVersion) && /^[a-f0-9]{64}$/.test(profileFingerprint));
  const currentProfile = await store.readPresidentProfile(actor);
  assert.ok(currentProfile.ok && currentProfile.profile);
  assert.equal(currentProfile.profile.fingerprint, profileFingerprint, "run before any extension that changes the president profile");
  const challengeBefore = (await db.query("SELECT id,batch_id,issued_by,request_id,state,receipt_id,document_version,attempts,confirmed_at FROM president_challenges WHERE id=$1", [issued.id])).rows[0];
  assert.ok(challengeBefore);
  assert.equal(challengeBefore.state, "consumed"); assert.equal(challengeBefore.receipt_id, receiptId);
  assert.equal(challengeBefore.request_id, issued.requestId); assert.equal(challengeBefore.batch_id, sourceBatchId);
  assert.equal(challengeBefore.issued_by, actor.userId); assert.equal(challengeBefore.document_version, documentVersion);
  const source = (await db.query("SELECT pdf,pdf_sha256 FROM batches WHERE id=$1", [sourceBatchId])).rows[0];
  assert.ok(source?.pdf && sha(source.pdf) === source.pdf_sha256);
  const batchSnapshot = async () => sha((await db.query("SELECT row_to_json(b)::text AS state FROM batches b WHERE id=$1", [sourceBatchId])).rows[0].state);
  const profileSnapshot = async () => sha((await db.query("SELECT value FROM settings WHERE key='president_profile_v1'")).rows[0].value);
  const mailSnapshot = async () => (await db.query("SELECT (SELECT count(*)::int FROM mail_messages) AS messages,(SELECT count(*)::int FROM mail_outbox) AS outbox,(SELECT count(*)::int FROM batch_sends) AS sends")).rows[0];
  const beforeBatch = await batchSnapshot(), beforeProfile = await profileSnapshot(), beforeMail = await mailSnapshot();
  const countsBefore = (await db.query("SELECT (SELECT count(*)::int FROM president_own_document_intents WHERE batch_id=$1) AS intents,(SELECT count(*)::int FROM president_own_document_artifacts WHERE batch_id=$1) AS artifacts", [sourceBatchId])).rows[0];
  const actorScope = `${actor.userId}:${actor.sessaoId}`;
  const adminStorageKey = `president-admin-issue:${actorScope}:${sourceBatchId}`;
  const ownStorageKey = `president-own-pdf:${actorScope}:${sourceBatchId}:${receiptId}:${documentVersion}`;
  const adminIntent = { requestId: issued.requestId, batchId: sourceBatchId, expectedDocumentVersion: documentVersion, expectedProfileFingerprint: profileFingerprint };
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, locale: "pt-BR" });
  const pageErrors = [], blockedExternal = [], postRequests = [], readbacks = [], artifactDownloads = [], shots = [];
  let dropFirstGeneration = true, committed = null;
  try {
    await context.addCookies([{ name: "adm", value: sessionToken, url: base, httpOnly: true, sameSite: "Lax" }]);
    // The only seeded storage value is a legitimate nonsecret issuance intent bound to the consumed DB challenge.
    await context.addInitScript(({ key, intent }) => {
      sessionStorage.setItem(key, JSON.stringify(intent));
      const original = window.fetch;
      window.__ownPdfPostCalls = 0;
      window.fetch = (...args) => {
        const target = args[0] instanceof Request ? args[0].url : String(args[0]);
        const method = args[1]?.method ?? (args[0] instanceof Request ? args[0].method : "GET");
        if (new URL(target, location.origin).pathname === "/api/admin/presidente/documentos-proprios" && method.toUpperCase() === "POST") window.__ownPdfPostCalls++;
        return original.apply(window, args);
      };
    }, { key: adminStorageKey, intent: adminIntent });
    await context.route("**/*", route => {
      const target = new URL(route.request().url());
      return target.origin === base || target.protocol === "blob:" ? route.continue() : (blockedExternal.push(target.hostname), route.abort());
    });
    await context.route("**/api/admin/presidente/documentos-proprios**", async route => {
      const request = route.request(), target = new URL(request.url());
      assert.ok((await request.allHeaders()).cookie?.includes("adm="), "own-PDF request must retain its admin cookie");
      if (request.method() === "POST") {
        const intent = request.postDataJSON(); postRequests.push(intent);
        assert.equal(Object.keys(intent).sort().join(","), "batchId,expectedDocumentVersion,receiptId,requestId");
        assert.equal(intent.batchId, sourceBatchId); assert.equal(intent.receiptId, receiptId); assert.equal(intent.expectedDocumentVersion, documentVersion); assert.ok(uuid(intent.requestId));
        const response = await route.fetch({ maxRedirects: 0 });
        if (dropFirstGeneration) {
          assert.equal(response.status(), 200, "first generation must finish durably before dropping its response");
          const value = await response.json(); assert.ok(value.ok && value.document?.state === "completed");
          assert.equal(value.document.requestId, intent.requestId); assert.ok(uuid(value.document.artifactId));
          committed = value.document; dropFirstGeneration = false;
          return route.abort("failed");
        }
        return route.fulfill({ response });
      }
      const response = await route.fetch({ maxRedirects: 0 });
      if (target.pathname === "/api/admin/presidente/documentos-proprios") {
        assert.equal(target.searchParams.size, 1); assert.ok(uuid(target.searchParams.get("requestId")));
        const data = await response.json(); assert.equal(response.status(), 200); assert.ok(data.ok && data.document);
        assert.equal(data.document.source, "president-own"); assert.equal(data.document.dispatchAllowed, false); assert.equal(data.document.icpBrasil, false); assert.equal(data.document.govBr, false);
        readbacks.push(data.document);
      } else {
        assert.equal(target.search, "");
        assert.ok(uuid(target.pathname.split("/").at(-1)));
        assert.equal(response.status(), 200); assert.equal(response.headers()["content-type"], "application/pdf");
        const bytes = await response.body();
        assert.equal(response.headers()["x-document-sha256"], sha(bytes));
        assert.equal(response.headers()["x-source-document-sha256"], source.pdf_sha256);
        artifactDownloads.push({ artifactId: target.pathname.split("/").at(-1), sha256: sha(bytes), byteLength: bytes.byteLength });
      }
      return route.fulfill({ response });
    });
    const page = await context.newPage(); page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(`${base}/admin/presidente?lote=${sourceBatchId}`); await region(page).waitFor();
    await page.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find(e => e.textContent === "Conferir solicitação"); return b && !b.disabled; });
    await button(region(page), "Conferir solicitação").click(); await ownRegion(page).waitFor();
    await button(ownRegion(page), "Gerar PDF da confirmação").click();
    await ownRegion(page).getByText("Não foi possível confirmar o resultado. Confira a geração antes de tentar outra ação.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__ownPdfPostCalls), 1); assert.equal(postRequests.length, 1); assert.ok(committed);
    assert.equal(await button(ownRegion(page), "Gerar PDF da confirmação").isDisabled(), true);
    const ownIntent = postRequests[0];
    assert.equal(committed.requestId, ownIntent.requestId); assert.equal(committed.documentVersion, documentVersion); assert.equal(committed.receiptId, receiptId);
    const durable = (await db.query("SELECT i.request_id,i.batch_id,i.receipt_id,i.document_version,r.state,r.artifact_id,a.source,a.bytes,a.sha256,a.source_sha256 FROM president_own_document_intents i JOIN president_own_document_results r ON r.intent_id=i.id JOIN president_own_document_artifacts a ON a.id=r.artifact_id WHERE i.requested_by=$1 AND i.request_id=$2", [actor.userId, ownIntent.requestId])).rows;
    assert.equal(durable.length, 1); assert.equal(durable[0].state, "completed"); assert.equal(durable[0].artifact_id, committed.artifactId);
    assert.equal(durable[0].source, "president-own"); assert.equal(durable[0].source_sha256, source.pdf_sha256); assert.equal(durable[0].sha256, sha(durable[0].bytes));
    assert.equal(durable[0].sha256, committed.sha256);
    // Reload clears view metadata. Reopening the consumed issuance and its own intent is explicit readback only.
    await page.reload(); await region(page).waitFor();
    await page.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find(e => e.textContent === "Conferir solicitação"); return b && !b.disabled; });
    assert.equal(await page.evaluate(() => window.__ownPdfPostCalls), 0);
    await button(region(page), "Conferir solicitação").click(); await ownRegion(page).waitFor();
    await page.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find(e => e.textContent === "Conferir geração do PDF"); return b && !b.disabled; });
    assert.equal(await button(ownRegion(page), "Gerar PDF da confirmação").isDisabled(), true);
    assert.equal(postRequests.length, 1); assert.equal(readbacks.length, 0);
    await button(ownRegion(page), "Conferir geração do PDF").click();
    const downloadLink = ownRegion(page).getByRole("link", { name: "Baixar PDF da confirmação", exact: true }); await downloadLink.waitFor();
    assert.equal(readbacks.length, 1); assert.equal(readbacks[0].requestId, ownIntent.requestId); assert.equal(readbacks[0].artifactId, committed.artifactId); assert.equal(readbacks[0].sha256, committed.sha256);
    assert.equal(await downloadLink.getAttribute("href"), `/api/admin/presidente/documentos-proprios/${committed.artifactId}`);
    assert.equal(artifactDownloads.length, 0, "PDF bytes must not be fetched until the download click");
    const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, url: location.href }));
    for (const secret of [issued.token, issued.password, "%PDF-", "52998224725", "2000-01-01"]) if (secret) assert.equal(stored.includes(secret), false);
    const savedOwn = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), ownStorageKey);
    assert.deepEqual(savedOwn, ownIntent);
    const downloadWait = page.waitForEvent("download"); await downloadLink.click(); const downloaded = await downloadWait;
    const pdfPath = `${output}/president-own-confirmation.pdf`; await downloaded.saveAs(pdfPath); chmodSync(pdfPath, 0o600);
    const actualPdf = readFileSync(pdfPath); assert.equal(sha(actualPdf), committed.sha256); assert.equal(sha(actualPdf), sha(durable[0].bytes));
    assert.equal(artifactDownloads.length, 1); assert.equal(artifactDownloads[0].artifactId, committed.artifactId);
    const require = createRequire(`${process.env.QA_SITE_DIR}/package.json`), { PDFDocument } = require("pdf-lib");
    const sourcePdf = await PDFDocument.load(source.pdf, { updateMetadata: false }), resultPdf = await PDFDocument.load(actualPdf, { updateMetadata: false });
    assert.equal(resultPdf.getPageCount(), sourcePdf.getPageCount() + 1);
    for (let n = 0; n < sourcePdf.getPageCount(); n++) assert.deepEqual(resultPdf.getPage(n).getSize(), sourcePdf.getPage(n).getSize());
    for (const width of [320, 390, 768, 992, 1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, `own-PDF ADMIN page overflow at ${width}`);
      const path = `${output}/president-own-admin-${width}.png`; await page.screenshot({ path, fullPage: true }); shots.push({ width, path });
    }
    const countsAfter = (await db.query("SELECT (SELECT count(*)::int FROM president_own_document_intents WHERE batch_id=$1) AS intents,(SELECT count(*)::int FROM president_own_document_artifacts WHERE batch_id=$1) AS artifacts", [sourceBatchId])).rows[0];
    assert.equal(countsAfter.intents, countsBefore.intents + 1); assert.equal(countsAfter.artifacts, countsBefore.artifacts + 1);
    assert.equal(await page.evaluate(() => window.__ownPdfPostCalls), 0); assert.equal(postRequests.length, 1);
    assert.equal(await batchSnapshot(), beforeBatch); assert.equal(await profileSnapshot(), beforeProfile); assert.deepEqual(await mailSnapshot(), beforeMail);
    assert.deepEqual((await db.query("SELECT id,batch_id,issued_by,request_id,state,receipt_id,document_version,attempts,confirmed_at FROM president_challenges WHERE id=$1", [issued.id])).rows[0], challengeBefore);
    assert.ok((await db.verifyAuditChain()).ok); assert.deepEqual(pageErrors, []); assert.deepEqual(blockedExternal, []);
    const result = {
      ok: true, requestId: ownIntent.requestId, artifactId: committed.artifactId, compiledAdminOwnPdfUi: true, actualHandlersPostgresAndPdfRenderer: true,
      consumedReceiptRecoveredFromLegitimateIssuance: true, generationCommittedThenResponseLost: true,
      applicationGenerationCallsBeforeReload: 1, applicationGenerationCallsAfterReload: 0,
      physicalGenerationRequests: postRequests.length, durableIntentsAdded: 1, immutableArtifactsAdded: 1,
      metadataReadbacks: readbacks.length, noAutomaticGenerationRetry: true,
      download: { artifactId: committed.artifactId, path: pdfPath, sha256: committed.sha256, sourceSha256: source.pdf_sha256, sourcePages: sourcePdf.getPageCount(), outputPages: resultPdf.getPageCount() },
      downloadOnlyAfterClick: true, nonceAndContextOnlyInStorage: true,
      sourceBatchUnchanged: true, profileUnchanged: true, consumedChallengeUnchanged: true, mailAndDispatchTablesUnchanged: true,
      icpBrasil: false, govBr: false, dispatchAllowed: false, realCryptoHomologation: false,
      shots, pageErrors, blockedExternal,
    };
    writeFileSync(`${output}/own-pdf-browser-result.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
    return result;
  } finally { await context.close(); }
}
