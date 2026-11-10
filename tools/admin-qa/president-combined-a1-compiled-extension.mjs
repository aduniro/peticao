/** Draft compiled combined A1 admission/claim proof. Never invokes worker, validator or finish. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const sha = value => createHash("sha256").update(value).digest("hex");
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const adminRegion = page => page.getByRole("region", { name: "Assinatura própria do app", exact: true });
const ownRegion = page => page.getByRole("region", { name: "Documento da confirmação própria", exact: true });
const button = (scope, name) => scope.getByRole("button", { name, exact: true });
const ACTION = "Assinar com certificado A1";

export async function runPresidentCombinedA1Extension({ browser, base, sessionToken, actor, db, store, output, sourceBatchId, issued, documentVersion, profileFingerprint, receiptId, ownPdf }) {
  const site = process.env.QA_SITE_DIR;
  assert.equal(site, "/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site");
  assert.equal(base, "http://127.0.0.1:3055"); assert.equal(output, process.env.QA_OUTPUT_DIR);
  assert.equal(process.env.DATABASE_URL, "postgres://peticao:peticao@127.0.0.1:54379/peticao");
  assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.equal(process.env.MAIL_PROVIDERS, "dev");
  assert.equal(process.env.BATCH_A1_ENABLED, "1"); assert.equal(process.env.A1_VALIDATION_ENABLED, "1");
  assert.ok(!process.env.CRON_SECRET, "QA must not enable the signing scheduler");
  assert.equal(readdirSync(process.env.SECRETS_DIR).length, 0); assert.equal(readdirSync(process.env.CREDENTIALS_DIRECTORY).length, 0);
  assert.ok(process.env.A1_WORKER_SOCKET?.startsWith(output + "/") && !existsSync(process.env.A1_WORKER_SOCKET), "QA worker endpoint must be an absent socket in its isolated output folder");
  assert.ok(actor?.sessaoId && actor.nivel === "total" && issued?.ok && uuid(issued.requestId));
  assert.ok(ownPdf?.ok && uuid(ownPdf.requestId) && uuid(ownPdf.artifactId));
  assert.equal(ownPdf.artifactId, ownPdf.download.artifactId); assert.equal(ownPdf.download.sourceSha256.length, 64);
  const ownArtifactId = ownPdf.artifactId;
  const A1 = await import(pathToFileURL(site + "/src/lib/batch-a1-jobs.ts").href);
  const validation = await import(pathToFileURL(site + "/src/lib/a1-validation.ts").href);
  assert.equal(validation.a1ValidationReady(), true, "readiness is configuration-only; no validator request is performed");
  const source = (await db.query("SELECT * FROM batches WHERE id=$1", [sourceBatchId])).rows[0]; assert.ok(source?.pdf);
  assert.equal(sha(source.pdf), ownPdf.download.sourceSha256);
  const sourceSnapshot = async () => sha((await db.query("SELECT row_to_json(b)::text AS state FROM batches b WHERE id=$1", [sourceBatchId])).rows[0].state);
  const profileSnapshot = async () => sha((await db.query("SELECT value FROM settings WHERE key='president_profile_v1'")).rows[0].value);
  const mailSnapshot = async () => (await db.query("SELECT (SELECT count(*)::int FROM mail_messages) AS messages,(SELECT count(*)::int FROM mail_outbox) AS outbox,(SELECT count(*)::int FROM batch_sends) AS sends")).rows[0];
  const beforeSource = await sourceSnapshot(), beforeProfile = await profileSnapshot(), beforeMail = await mailSnapshot();
  const currentProfile = await store.readPresidentProfile(actor); assert.ok(currentProfile.ok && currentProfile.profile); assert.equal(currentProfile.profile.fingerprint, profileFingerprint);
  const ownRows = (await db.query("SELECT a.id,a.batch_id,a.receipt_id,a.document_version,a.bytes,a.sha256,a.source_sha256,i.request_id,r.state FROM president_own_document_artifacts a JOIN president_own_document_results r ON r.artifact_id=a.id JOIN president_own_document_intents i ON i.id=r.intent_id WHERE a.id=$1 AND i.requested_by=$2 AND i.request_id=$3", [ownArtifactId, actor.userId, ownPdf.requestId])).rows;
  assert.equal(ownRows.length, 1); const own = ownRows[0];
  assert.equal(own.state, "completed"); assert.equal(own.batch_id, sourceBatchId); assert.equal(own.receipt_id, receiptId); assert.equal(own.document_version, documentVersion);
  assert.equal(sha(own.bytes), ownPdf.download.sha256); assert.equal(own.sha256, ownPdf.download.sha256); assert.equal(own.source_sha256, sha(source.pdf));
  // Preconditions are seeded BEFORE issuing the president challenge; never change the list afterwards.
  assert.equal((await db.query("SELECT count(*)::int n FROM batch_preparations WHERE batch_id=$1", [sourceBatchId])).rows[0].n, 1, "seed valid A1 preparation before the external scenario");
  const prepared = (await db.query("SELECT id,bytes,sha256,list_hash FROM batch_document_versions WHERE batch_id=$1 AND source='prepared' AND variant='original' AND sha256=$2", [sourceBatchId, source.pdf_sha256])).rows;
  assert.equal(prepared.length, 1); assert.equal(sha(prepared[0].bytes), sha(source.pdf));
  const initialJobs = (await db.query("SELECT count(*)::int n FROM batch_a1_jobs WHERE batch_id=$1", [sourceBatchId])).rows[0].n; assert.equal(initialJobs, 0);
  const initialOwnHistory = (await db.query("SELECT count(*)::int n FROM batch_document_versions WHERE batch_id=$1 AND source='president-own'", [sourceBatchId])).rows[0].n;
  // Fictitious policy identifiers only. No credential files, PFX or real trust material are loaded.
  const policy = { version: 1, revision: 1, enabled: true, credentialActive: true, credentialVersionId: randomUUID(), profileVersion: "pades-basic-unhomologated-v1", trustStoreVersion: "b".repeat(64), expectedCnpj: "15883671000115", certificateFingerprintSha256: "c".repeat(64) };
  await db.query("INSERT INTO settings(key,value)VALUES($1,$2)ON CONFLICT(key)DO UPDATE SET value=EXCLUDED.value", [A1.BATCH_A1_POLICY_KEY, JSON.stringify(policy)]);
  const preflight = await A1.getA1Availability(sourceBatchId, actor, ownArtifactId);
  assert.ok(preflight.ok && preflight.available, "own-artifact preflight requires valid current preparation/profile/receipt/source");
  assert.equal(preflight.ownArtifactId, ownArtifactId);
  assert.equal((await db.query("SELECT count(*)::int n FROM batch_document_versions WHERE batch_id=$1 AND source='president-own'", [sourceBatchId])).rows[0].n, initialOwnHistory, "availability must not freeze a signing input");
  const actorScope = `${actor.userId}:${actor.sessaoId}`;
  const adminIntent = { requestId: issued.requestId, batchId: sourceBatchId, expectedDocumentVersion: documentVersion, expectedProfileFingerprint: profileFingerprint };
  const ownIntent = { requestId: ownPdf.requestId, batchId: sourceBatchId, receiptId, expectedDocumentVersion: documentVersion };
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, locale: "pt-BR" });
  const posts = [], reads = [], pageErrors = [], blockedExternal = [], shots = [];
  let admittedJob = null, droppedNonce = null;
  try {
    await context.addCookies([{ name: "adm", value: sessionToken, url: base, httpOnly: true, sameSite: "Lax" }]);
    await context.addInitScript(({ adminKey, adminValue, ownKey, ownValue, batchId }) => {
      sessionStorage.setItem(adminKey, JSON.stringify(adminValue)); sessionStorage.setItem(ownKey, JSON.stringify(ownValue));
      const original = window.fetch; window.__combinedA1PostCalls = 0;
      window.fetch = (...args) => {
        const target = args[0] instanceof Request ? args[0].url : String(args[0]);
        const method = args[1]?.method ?? (args[0] instanceof Request ? args[0].method : "GET");
        if (new URL(target, location.origin).pathname === `/api/admin/lotes/${batchId}/a1` && method.toUpperCase() === "POST") window.__combinedA1PostCalls++;
        return original.apply(window, args);
      };
    }, { adminKey: `president-admin-issue:${actorScope}:${sourceBatchId}`, adminValue: adminIntent, ownKey: `president-own-pdf:${actorScope}:${sourceBatchId}:${receiptId}:${documentVersion}`, ownValue: ownIntent, batchId: sourceBatchId });
    await context.route("**/*", route => { const target = new URL(route.request().url()); return target.origin === base || target.protocol === "blob:" ? route.continue() : (blockedExternal.push(target.hostname), route.abort()); });
    await context.route(`**/api/admin/lotes/${sourceBatchId}/a1**`, async route => {
      const request = route.request(), target = new URL(request.url());
      assert.ok((await request.allHeaders()).cookie?.includes("adm="));
      if (request.method() === "POST") {
        const input = request.postDataJSON(); posts.push(input);
        assert.equal(Object.keys(input).sort().join(","), "expectedDocumentVersion,expectedOwnArtifactId,expectedPolicyRevision,requestId");
        assert.equal(input.expectedOwnArtifactId, ownArtifactId); assert.equal(input.expectedDocumentVersion, preflight.documentVersion); assert.equal(input.expectedPolicyRevision, policy.revision);
        if (droppedNonce === null) droppedNonce = input.requestId;
        assert.equal(input.requestId, droppedNonce, "any browser-level replay must retain its original intent UUID");
        const response = await route.fetch({ maxRedirects: 0 });
        assert.ok([200, 202].includes(response.status())); const result = await response.json(); assert.ok(result.ok && result.job);
        assert.equal(result.job.ownArtifactId, ownArtifactId); assert.equal(result.job.requestId, input.requestId);
        assert.equal(result.job.inputSha256, own.sha256); assert.equal(result.job.outputVersionId, null);
        admittedJob = result.job;
        // Drop every physical response for this logical intent, so a browser retry cannot accidentally reveal success.
        return route.abort("failed");
      }
      const response = await route.fetch({ maxRedirects: 0 }); const data = await response.json();
      assert.equal(response.status(), 200); assert.equal(data.ok, true);
      reads.push({ available: data.available ?? null, error: data.error ?? null, query: target.search, ownArtifactId: data.ownArtifactId ?? null, latestOwnArtifactId: data.latestJob?.ownArtifactId ?? null, jobId: data.job?.jobId ?? null });
      return route.fulfill({ response });
    });
    const page = await context.newPage(); page.on("pageerror", error => pageErrors.push(error.message));
    const reopenOwn = async () => {
      await page.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find(e => e.textContent === "Conferir solicitação"); return b && !b.disabled; });
      await button(adminRegion(page), "Conferir solicitação").click(); await ownRegion(page).waitFor();
      await page.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find(e => e.textContent === "Conferir geração do PDF"); return b && !b.disabled; });
      await button(ownRegion(page), "Conferir geração do PDF").click(); await ownRegion(page).getByRole("link", { name: "Baixar PDF da confirmação", exact: true }).waitFor();
    };
    await page.goto(`${base}/admin/presidente?lote=${sourceBatchId}`); await reopenOwn();
    await button(ownRegion(page), ACTION).click();
    let modal = page.getByRole("dialog"); await modal.waitFor();
    await modal.getByRole("heading", { name: `${ACTION} · ${sourceBatchId} · confirmação própria`, exact: true }).waitFor();
    try {
      await page.waitForFunction(() => { const opened = document.querySelector("dialog[open]"); const b = [...(opened?.querySelectorAll("button") ?? [])].find(e => e.textContent === "Assinar com certificado A1"); return b && !b.disabled; });
    } catch (error) {
      writeFileSync(`${output}/combined-a1-readiness-debug.json`, JSON.stringify({ reads, controls: await modal.locator("button").evaluateAll(buttons => buttons.map(b => ({ text: b.textContent, disabled: b.disabled }))) }, null, 2), { mode: 0o600 });
      await page.screenshot({ path: `${output}/combined-a1-readiness-debug.png`, fullPage: true });
      throw error;
    }
    assert.ok(reads.some(r => new URL(r.query, base).searchParams.get("expectedOwnArtifactId") === ownArtifactId));
    await button(modal, ACTION).click(); await modal.getByRole("alert").waitFor();
    assert.equal(await page.evaluate(() => window.__combinedA1PostCalls), 1); assert.ok(posts.length >= 1 && admittedJob);
    assert.equal(await button(modal, ACTION).isDisabled(), true);
    const nonce = posts[0].requestId;
    let durable = (await db.query("SELECT j.id,j.request_id,j.state,j.revision,j.attempts,j.input_artifact_version_id,j.input_sha256,j.input_byte_length,j.output_version_id,j.output_sha256,v.source,v.variant,v.signature_kind,v.bytes,v.sha256,i.own_artifact_id,i.original_version_id FROM batch_a1_jobs j JOIN batch_document_versions v ON v.id=j.input_artifact_version_id JOIN president_own_a1_inputs i ON i.input_version_id=v.id WHERE j.actor_id=$1 AND j.request_id=$2", [actor.userId, nonce])).rows;
    assert.equal(durable.length, 1); const frozen = durable[0];
    assert.equal(frozen.state, "queued"); assert.equal(frozen.attempts, 0); assert.equal(frozen.own_artifact_id, ownArtifactId);
    assert.equal(frozen.source, "president-own"); assert.equal(frozen.variant, "signed"); assert.equal(frozen.signature_kind, "own-confirmation");
    assert.equal(frozen.input_sha256, own.sha256); assert.equal(frozen.sha256, own.sha256); assert.equal(sha(frozen.bytes), own.sha256); assert.ok(frozen.bytes.equals(own.bytes));
    assert.equal(frozen.original_version_id, prepared[0].id); assert.notEqual(frozen.input_artifact_version_id, prepared[0].id);
    assert.equal(frozen.output_version_id, null); assert.equal(frozen.output_sha256, null);
    assert.equal((await db.query("SELECT count(*)::int n FROM audit_log WHERE event='batch_a1_job_admitted' AND data::jsonb->>'jobId'=$1", [frozen.id])).rows[0].n, 1);
    await page.reload(); await reopenOwn();
    assert.equal(await page.evaluate(() => window.__combinedA1PostCalls), 0);
    await button(ownRegion(page), ACTION).click(); modal = page.getByRole("dialog");
    await modal.getByRole("status").filter({ hasText: "Aguardando assinatura" }).waitFor();
    assert.ok(reads.some(r => new URL(r.query, base).searchParams.get("requestId") === nonce && r.jobId === frozen.id));
    assert.equal(await modal.getByRole("link", { name: "Baixar PDF assinado", exact: true }).count(), 0);
    const afterReloadPhysicalPosts = posts.length;
    for (const width of [320, 390, 768, 992, 1280, 1920]) {
      await page.setViewportSize({ width, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, `combined A1 overflow at ${width}`);
      const path = `${output}/president-own-a1-${width}.png`; await page.screenshot({ path, fullPage: true }); shots.push({ width, path });
    }
    assert.equal(await page.evaluate(() => window.__combinedA1PostCalls), 0); assert.equal(posts.length, afterReloadPhysicalPosts);
    await button(modal, "Fechar").click();
    // The existing original control precedes the native own control. Its exact modal title and empty-mode GET prove which button was opened.
    const originalRead = page.waitForResponse(response => { const url = new URL(response.url()); return response.request().method() === "GET" && url.pathname === `/api/admin/lotes/${sourceBatchId}/a1` && url.search === ""; });
    await page.getByRole("button", { name: ACTION, exact: true }).first().click(); await originalRead; modal = page.getByRole("dialog");
    await modal.getByRole("heading", { name: `${ACTION} · ${sourceBatchId}`, exact: true }).waitFor();
    await modal.getByRole("status").filter({ hasText: "—" }).waitFor();
    assert.equal(await button(modal, ACTION).isDisabled(), true);
    assert.equal(await modal.getByRole("link", { name: "Baixar PDF assinado", exact: true }).count(), 0);
    assert.ok(reads.some(r => r.query === "" && r.latestOwnArtifactId === ownArtifactId));
    await button(modal, "Fechar").click();
    const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, url: location.href }));
    for (const forbidden of [issued.token, issued.password, "%PDF-", "52998224725", "2000-01-01"]) if (forbidden) assert.equal(stored.includes(forbidden), false);
    assert.ok(stored.includes(ownArtifactId) && stored.includes(nonce));
    // Trusted in-process claim only: inspect the selected bytes under the real CAS, without calling a signer, broker, validator or finish.
    const claimed = await A1.claimA1Job(frozen.id, frozen.revision); assert.ok(claimed.ok, "fictitious admission must remain claimable with its current profile/receipt/source");
    assert.equal(claimed.job.state, "running"); assert.equal(claimed.job.attempts, 1);
    assert.equal(claimed.job.ownArtifactId, ownArtifactId); assert.equal(claimed.binding.inputArtifactVersionId, frozen.input_artifact_version_id); assert.equal(claimed.binding.inputSha256, own.sha256);
    assert.ok(claimed.bytes.equals(own.bytes)); assert.equal(sha(claimed.bytes), own.sha256);
    const require = createRequire(site + "/package.json"), { PDFDocument } = require("pdf-lib");
    const inputPdf = await PDFDocument.load(claimed.bytes, { updateMetadata: false }), sourcePdf = await PDFDocument.load(source.pdf, { updateMetadata: false });
    assert.equal(inputPdf.getPageCount(), sourcePdf.getPageCount() + 1);
    assert.equal(inputPdf.getPageCount(), ownPdf.download.outputPages);
    const finalJob = (await db.query("SELECT state,attempts,output_version_id,output_sha256 FROM batch_a1_jobs WHERE id=$1", [frozen.id])).rows[0];
    assert.deepEqual(finalJob, { state: "running", attempts: 1, output_version_id: null, output_sha256: null });
    assert.equal((await db.query("SELECT count(*)::int n FROM batch_a1_jobs WHERE batch_id=$1", [sourceBatchId])).rows[0].n, initialJobs + 1);
    assert.equal((await db.query("SELECT count(*)::int n FROM batch_document_versions WHERE batch_id=$1 AND source='president-own'", [sourceBatchId])).rows[0].n, initialOwnHistory + 1);
    assert.equal((await db.query("SELECT count(*)::int n FROM batch_document_versions WHERE batch_id=$1 AND source='a1-worker'", [sourceBatchId])).rows[0].n, 0);
    assert.equal(await sourceSnapshot(), beforeSource); assert.equal(await profileSnapshot(), beforeProfile); assert.deepEqual(await mailSnapshot(), beforeMail);
    assert.ok((await db.verifyAuditChain()).ok); assert.deepEqual(pageErrors, []); assert.deepEqual(blockedExternal, []);
    const result = {
      ok: true, compiledCombinedA1Ui: true, ownArtifactId, jobId: frozen.id, requestId: nonce,
      realHandlersAdmissionAndClaim: true, applicationPostCallsBeforeReload: 1, applicationPostCallsAfterReload: 0,
      physicalPostRequests: posts.length, oneDurableJobAndAdmissionAudit: true, noAutomaticApplicationPostRetry: true,
      originalControlDoesNotPresentOwnJob: true, input: { versionId: frozen.input_artifact_version_id, originalVersionId: prepared[0].id, sha256: own.sha256, ownArtifactId, sourcePages: sourcePdf.getPageCount(), inputPages: inputPdf.getPageCount() },
      claimOnly: true, signingWorkerInvoked: false, validatorInvoked: false, signingPerformed: false, signatureOutputCreated: false,
      realCertificateUsed: false, realCryptoHomologation: false, batchUnchanged: true, presidentProfileUnchanged: true, mailAndDispatchTablesUnchanged: true,
      fictitiousCredentialVersionId: policy.credentialVersionId, declaredProducerProfile: policy.profileVersion, shots, pageErrors, blockedExternal,
    };
    writeFileSync(`${output}/combined-a1-browser-result.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
    return result;
  } finally { await context.close(); }
}
