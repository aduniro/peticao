/** DRAFT: real compiled Next handlers + isolated PostgreSQL. Never execute outside the pinned QA runner. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const sha = value => createHash("sha256").update(value).digest("hex");
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const button = (scope, name) => scope.getByRole("button", { name, exact: true });
const adminRegion = page => page.getByRole("region", { name: "Assinatura própria do app", exact: true });
const ownRegion = page => page.getByRole("region", { name: "Documento da confirmação própria", exact: true });
const ACTION = "Assinar com certificado A1";
async function enabled(locator) { await locator.waitFor(); await locator.evaluate(el => new Promise(resolve => { let tries = 0; const check = () => el.disabled && tries++ < 500 ? setTimeout(check, 10) : resolve(); check(); })); assert.equal(await locator.isDisabled(), false, "expected an explicitly enabled control"); }

export async function runPresidentRecoveryCompiledExtension({ browser, base, sessionToken, actor, db, store, output, sourceBatchId, issued, documentVersion, profileFingerprint, receiptId, ownPdf }) {
  const site = process.env.QA_SITE_DIR;
  assert.equal(site, "/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site");
  assert.equal(base, "http://127.0.0.1:3055"); assert.equal(output, process.env.QA_OUTPUT_DIR);
  assert.equal(process.env.DATABASE_URL, "postgres://peticao:peticao@127.0.0.1:54379/peticao");
  assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.equal(process.env.MAIL_PROVIDERS, "dev");
  assert.equal(process.env.BATCH_A1_ENABLED, "1"); assert.equal(process.env.A1_VALIDATION_ENABLED, "1");
  assert.ok(!process.env.CRON_SECRET); assert.equal(readdirSync(process.env.SECRETS_DIR).length, 0); assert.equal(readdirSync(process.env.CREDENTIALS_DIRECTORY).length, 0);
  assert.ok(process.env.A1_WORKER_SOCKET?.startsWith(output + "/") && !existsSync(process.env.A1_WORKER_SOCKET));
  assert.ok(actor?.sessaoId && actor.nivel === "total" && issued?.ok && uuid(issued.requestId));
  assert.ok(uuid(receiptId) && ownPdf?.ok && uuid(ownPdf.artifactId) && uuid(ownPdf.requestId));
  const P = await import(pathToFileURL(site + "/src/lib/batch-preparation.ts").href);
  const H = await import(pathToFileURL(site + "/src/lib/batch-document-history.ts").href);
  const A1 = await import(pathToFileURL(site + "/src/lib/batch-a1-jobs.ts").href);
  const source = (await db.query("SELECT * FROM batches WHERE id=$1", [sourceBatchId])).rows[0]; assert.ok(source?.pdf && !source.signed_pdf);
  const coreSnapshot = async () => (await db.query("SELECT (SELECT row_to_json(b)::text FROM batches b WHERE id=$1) batch,(SELECT COALESCE(jsonb_agg(to_jsonb(j) ORDER BY j.id),'[]'::jsonb)::text FROM batch_a1_jobs j WHERE j.batch_id=$1) jobs", [sourceBatchId])).rows[0];
  const mailSnapshot = async () => (await db.query("SELECT (SELECT count(*)::int FROM mail_messages) messages,(SELECT count(*)::int FROM mail_outbox) outbox,(SELECT count(*)::int FROM batch_sends) sends")).rows[0];
  const policyRow = (await db.query("SELECT value FROM settings WHERE key=$1", [A1.BATCH_A1_POLICY_KEY])).rows[0]; assert.ok(policyRow);
  const originalPolicyText = policyRow.value, policy = JSON.parse(originalPolicyText); assert.ok(policy.enabled && policy.credentialActive && Number.isInteger(policy.revision));
  const profileBefore = (await db.query("SELECT value FROM settings WHERE key='president_profile_v1'")).rows[0].value;
  const currentProfile = await store.readPresidentProfile(actor); assert.ok(currentProfile.ok && currentProfile.profile?.fingerprint === profileFingerprint);
  const beforeCore = await coreSnapshot(), beforeMail = await mailSnapshot();
  const alternate = (await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash)SELECT COALESCE(max(id),0)+1,$1,'QA Recovery Alternative','leitura','QA-NOT-A-LOGIN-HASH' FROM admin_users RETURNING id", ["qa-recovery-" + randomUUID() + "@example.test"])).rows[0].id;
  // A fresh original-mode batch, independent from the core combined job; preparation/history exist BEFORE any request.
  const seq = Number((await db.query("SELECT COALESCE(max(seq),0)+1 seq FROM batches")).rows[0].seq);
  const rows = [{ id: 1, name: "QA Recovery Fictitious", category: "apoiador", institution: null, role: null, city: "QA", uf: "RO" }];
  const listHash = sha(Buffer.from(JSON.stringify(rows))), bytes = Buffer.from(source.pdf);
  const batchId = (await db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,n_estrangeiro,list_hash,pdf,pdf_sha256,signature_kind)VALUES($1,'partial','prepared',0,1,0,$2,$3,$4,'none')RETURNING id", [seq, listHash, bytes, sha(bytes)])).rows[0].id;
  assert.notEqual(batchId, sourceBatchId);
  const frozen = P.freezePreparation(rows, { seq, kind: "partial", generatedAt: new Date().toISOString(), listHash, nServidor: 0, nApoiador: 1, nEstrangeiro: 0, signedNote: "", signaturePreparation: "a1" }, { kind: "scheduler" });
  await db.query("INSERT INTO batch_preparations(batch_id,snapshot,snapshot_sha256)VALUES($1,$2,$3)", [batchId, frozen.snapshot, frozen.sha256]);
  await db.audit("batch_created", null, { batchId, snapshotSha256: frozen.sha256, source: "scheduler" });
  await db.tx(c => H.appendDocumentVersion(c, { batchId, variant: "original", bytes, sha256: sha(bytes), listHash, signatureKind: "none", note: null, source: "prepared", authorId: actor.userId, recordedBy: actor.userId }));
  const batchBefore = (await db.query("SELECT row_to_json(b)::text state FROM batches b WHERE id=$1", [batchId])).rows[0].state;
  const preflight = await A1.getA1Availability(batchId, actor); assert.ok(preflight.ok && preflight.available && preflight.documentVersion);
  const context = await browser.newContext({ locale: "pt-BR", viewport: { width: 390, height: 900 } });
  const pageErrors = [], blockedExternal = [], posts = [], reads = [], closePosts = [], closeReads = [], profilePosts = [], issuePosts = [], shots = [];
  let changedPolicy = false, admitted = null, closeResult = null, credentials = null, orphanId = null, oldLease = null, closeCasRejected = false;
  const actorScope = `${actor.userId}:${actor.sessaoId}`;
  try {
    await context.addCookies([{ name: "adm", value: sessionToken, url: base, httpOnly: true, sameSite: "Lax" }]);
    await context.addInitScript(({ batchId }) => {
      window.__recoveryAppPosts = 0; window.__recoveryAppClosePosts = 0;
      const original = window.fetch;
      window.fetch = (...args) => {
        const target = args[0] instanceof Request ? args[0].url : String(args[0]);
        const method = args[1]?.method ?? (args[0] instanceof Request ? args[0].method : "GET");
        const path = new URL(target, location.origin).pathname;
        if (method.toUpperCase() === "POST" && path === `/api/admin/lotes/${batchId}/a1`) window.__recoveryAppPosts++;
        if (method.toUpperCase() === "POST" && path === `/api/admin/lotes/${batchId}/a1/encerrar`) window.__recoveryAppClosePosts++;
        return original.apply(window, args);
      };
    }, { batchId });
    await context.route("**/*", route => { const target = new URL(route.request().url()); return target.origin === base || target.protocol === "blob:" ? route.continue() : (blockedExternal.push(target.hostname), route.abort()); });
    await context.route("**/api/admin/presidente/perfil", route => { if (route.request().method() === "POST") profilePosts.push(route.request().postDataJSON()); return route.continue(); });
    await context.route("**/api/admin/presidente/desafio**", async route => {
      const request = route.request();
      if (request.method() !== "POST") return route.continue();
      issuePosts.push(request.postDataJSON()); const response = await route.fetch({ maxRedirects: 0 });
      assert.equal(response.status(), 200); const data = await response.json(); assert.ok(data.ok && data.token && data.password); credentials = { token: data.token, password: data.password };
      return route.fulfill({ response }); // Real response, never logged or persisted by the test.
    });
    await context.route(`**/api/admin/lotes/${batchId}/a1**`, async route => {
      const request = route.request(), target = new URL(request.url()); assert.ok((await request.allHeaders()).cookie?.includes("adm="));
      if (target.pathname.endsWith("/encerrar")) {
        if (request.method() === "POST") {
          const input = request.postDataJSON(); closePosts.push(input);
          if (closePosts.length > 2) assert.deepEqual(input, closePosts[1], "physical replay of fresh closure must keep its exact nonce/bindings");
          assert.equal(Object.keys(input).sort().join(","), "expectedDocumentVersion,expectedRevision,jobId,requestId");
          if (closePosts.length === 1) {
            // Mutable lease/revision fixture models a worker transition racing the already-read rev1.
            // Authorization binding stays immutable; this is NOT a claim after authorization expiry.
            assert.ok(orphanId && oldLease); assert.equal(input.expectedRevision, 1);
            const advanced = await db.query("UPDATE batch_a1_jobs SET state='running',revision=2,attempts=1,lease_token=$2,lease_until=clock_timestamp()-interval '1 second',updated_at=clock_timestamp() WHERE id=$1 AND revision=1 RETURNING revision", [orphanId, oldLease]); assert.equal(advanced.rowCount, 1);
            const response = await route.fetch({ maxRedirects: 0 }), data = await response.json();
            assert.equal(response.status(), 409); assert.equal(data.error, "conflict"); closeCasRejected = true;
            return route.fulfill({ response });
          }
          const response = await route.fetch({ maxRedirects: 0 }); assert.equal(response.status(), 200);
          const data = await response.json(); assert.ok(data.ok && data.closed && data.job.state === "stale"); closeResult = data;
          // Every physical response for this closure is lost. GET must recover its durable result.
          return route.abort("failed");
        }
        const response = await route.fetch({ maxRedirects: 0 }), data = await response.json();
        closeReads.push({ status: response.status(), requestId: target.searchParams.get("requestId"), state: data.job?.state ?? null });
        return route.fulfill({ response });
      }
      if (request.method() === "POST") {
        const input = request.postDataJSON(); posts.push(input);
        assert.equal(Object.keys(input).sort().join(","), "expectedDocumentVersion,expectedPolicyRevision,requestId");
        assert.equal(input.expectedDocumentVersion, preflight.documentVersion);
        if (!changedPolicy) {
          assert.equal(input.expectedPolicyRevision, policy.revision);
          await db.query("UPDATE settings SET value=$2 WHERE key=$1", [A1.BATCH_A1_POLICY_KEY, JSON.stringify({ ...policy, revision: policy.revision + 1 })]); changedPolicy = true;
        }
        const response = await route.fetch({ maxRedirects: 0 }), data = await response.json();
        if (posts.length === 1) { assert.equal(response.status(), 409); assert.equal(data.error, "policy_conflict"); assert.equal(data.ok, false); }
        else { assert.equal(response.status(), 202); assert.ok(data.ok && data.job && !data.replayed); admitted = data.job; }
        return route.fulfill({ response });
      }
      const response = await route.fetch({ maxRedirects: 0 }), data = await response.json();
      reads.push({ query: target.search, status: response.status(), error: data.error ?? null, policyRevision: data.policyRevision ?? null, jobId: data.job?.jobId ?? data.latestJob?.jobId ?? null });
      return route.fulfill({ response });
    });
    const page = await context.newPage(); page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(`${base}/admin/presidente?lote=${batchId}`); await adminRegion(page).waitFor();
    await button(page, ACTION).first().click(); let modal = page.getByRole("dialog");
    await modal.getByRole("heading", { name: `${ACTION} · ${batchId}`, exact: true }).waitFor(); await enabled(button(modal, ACTION));
    assert.ok(reads.some(r => r.query === "" && r.policyRevision === policy.revision));
    await button(modal, ACTION).click(); await modal.getByRole("alert").waitFor();
    assert.equal(posts.length, 1); assert.equal(await page.evaluate(() => window.__recoveryAppPosts), 1);
    assert.equal((await db.query("SELECT count(*)::int n FROM batch_a1_jobs WHERE batch_id=$1", [batchId])).rows[0].n, 0);
    const rejectedNonce = posts[0].requestId; assert.equal(await button(modal, ACTION).isDisabled(), true);
    await enabled(button(modal, "Conferir possibilidade de nova solicitação")); await button(modal, "Conferir possibilidade de nova solicitação").click();
    await button(modal, "Preparar nova solicitação").waitFor();
    assert.ok(reads.some(r => new URL(r.query, base).searchParams.get("requestId") === rejectedNonce && r.status === 404 && r.error === "not_found"));
    assert.ok(reads.some(r => r.query === "" && r.policyRevision === policy.revision + 1));
    assert.equal(posts.length, 1); await page.waitForTimeout(3_200); assert.equal(posts.length, 1); // No automatic mutation or proof-clearing poll.
    await modal.getByRole("checkbox", { name: "Quero preparar uma nova solicitação sem repetir automaticamente a anterior.", exact: true }).check();
    await button(modal, "Preparar nova solicitação").click(); await enabled(button(modal, ACTION)); assert.equal(posts.length, 1);
    await button(modal, ACTION).click(); await modal.getByRole("status").filter({ hasText: "Aguardando assinatura" }).waitFor();
    assert.equal(posts.length, 2); assert.equal(await page.evaluate(() => window.__recoveryAppPosts), 2); assert.notEqual(posts[1].requestId, rejectedNonce); assert.equal(posts[1].expectedPolicyRevision, policy.revision + 1);
    assert.ok(admitted && admitted.ownArtifactId == null && admitted.state === "queued");
    assert.equal((await db.query("SELECT count(*)::int n FROM batch_a1_jobs WHERE batch_id=$1", [batchId])).rows[0].n, 1);
    // Immutable binding trigger forbids changing admitted authorization timestamps. Use the same CHECK-preserving clone fixture as backend tests; never disable a trigger.
    await db.query("UPDATE batch_a1_jobs SET state='failed',error_code='worker_unavailable' WHERE id=$1", [admitted.jobId]);
    orphanId = randomUUID(); oldLease = randomUUID(); const orphanNonce = randomUUID();
    await db.query(`INSERT INTO batch_a1_jobs SELECT (jsonb_populate_record(NULL::batch_a1_jobs,to_jsonb(j)||jsonb_build_object('id',$2::text,'request_id',$3::text,'authorization_id',$4::text,'authorized_at',clock_timestamp()-interval '5 minutes','authorization_expires_at',clock_timestamp()-interval '1 minute','state','queued','revision',1,'attempts',0,'error_code',NULL,'lease_token',NULL,'lease_until',NULL,'created_at',clock_timestamp(),'updated_at',clock_timestamp()))).* FROM batch_a1_jobs j WHERE id=$1`, [admitted.jobId, orphanId, orphanNonce, randomUUID()]);
    await button(modal, "Conferir possibilidade de nova solicitação").click(); await button(modal, "Encerrar solicitação expirada").waitFor();
    assert.ok(reads.some(r => r.query === "" && r.jobId === orphanId));
    await modal.getByRole("checkbox", { name: "Quero encerrar somente esta solicitação expirada. Esta ação não assina nem envia documentos.", exact: true }).check();
    await button(modal, "Encerrar solicitação expirada").click(); await enabled(button(modal, "Conferir encerramento"));
    assert.equal(await page.evaluate(() => window.__recoveryAppClosePosts), 1); assert.equal(closePosts.length, 1); assert.equal(closeCasRejected, true); assert.equal(closeResult, null);
    await button(modal, "Conferir encerramento").click(); await button(modal, "Descartar somente este pedido local de encerramento").waitFor();
    assert.ok(closeReads.some(r => r.requestId === closePosts[0].requestId && r.status === 404));
    assert.equal(await button(modal, "Descartar somente este pedido local de encerramento").isDisabled(), true);
    await modal.getByRole("checkbox", { name: "Conferi a nova situação e quero descartar somente o pedido local anterior de encerramento.", exact: true }).check();
    await button(modal, "Descartar somente este pedido local de encerramento").click(); assert.equal(closePosts.length, 1); assert.equal(posts.length, 2);
    await button(modal, "Encerrar solicitação expirada").waitFor();
    await modal.getByRole("checkbox", { name: "Quero encerrar somente esta solicitação expirada. Esta ação não assina nem envia documentos.", exact: true }).check();
    await button(modal, "Encerrar solicitação expirada").click(); await enabled(button(modal, "Conferir encerramento"));
    assert.equal(await page.evaluate(() => window.__recoveryAppClosePosts), 2); assert.ok(closePosts.length >= 2 && closeResult);
    assert.notEqual(closePosts[1].requestId, closePosts[0].requestId); assert.equal(closePosts[1].expectedRevision, 2);
    assert.equal(closeResult.job.jobId, orphanId); assert.equal(closeResult.job.requestId, orphanNonce); assert.notEqual(closePosts[0].requestId, orphanNonce); assert.notEqual(closePosts[0].requestId, posts[1].requestId);
    await button(modal, "Conferir encerramento").click(); await modal.getByText("Solicitação expirada encerrada. Confira a possibilidade de uma nova solicitação antes de prosseguir.", { exact: true }).waitFor();
    assert.ok(closeReads.some(r => r.requestId === closePosts[1].requestId && r.status === 200 && r.state === "stale"));
    const closed = (await db.query("SELECT state,revision,attempts,lease_token,lease_until,output_version_id,output_sha256 FROM batch_a1_jobs WHERE id=$1", [orphanId])).rows[0];
    assert.deepEqual(closed, { state: "stale", revision: 3, attempts: 1, lease_token: null, lease_until: null, output_version_id: null, output_sha256: null });
    const lateOldClose = await context.request.post(`${base}/api/admin/lotes/${batchId}/a1/encerrar`, { data: closePosts[0], headers: { origin: base }, maxRedirects: 0 });
    assert.equal(lateOldClose.status(), 409); assert.equal((await lateOldClose.json()).error, "conflict");
    assert.equal((await A1.claimA1Job(orphanId, 2)).error, "conflict"); assert.equal((await A1.failA1Job(orphanId, oldLease, 2, "signing_failed")).error, "conflict");
    assert.equal((await db.query("SELECT count(*)::int n FROM audit_log WHERE event='batch_a1_expired_closed' AND data::jsonb->>'jobId'=$1", [orphanId])).rows[0].n, 1);
    await button(modal, "Conferir possibilidade de nova solicitação").click(); await button(modal, "Preparar nova solicitação").waitFor();
    await modal.getByRole("checkbox", { name: "Quero preparar uma nova solicitação sem repetir automaticamente a anterior.", exact: true }).check(); await button(modal, "Preparar nova solicitação").click(); await enabled(button(modal, ACTION));
    assert.equal(posts.length, 2); assert.equal(await page.evaluate(() => window.__recoveryAppPosts), 2); assert.equal(await page.evaluate(() => window.__recoveryAppClosePosts), 2); // Prepared only; deliberately do NOT click sign again.
    assert.equal((await db.query("SELECT count(*)::int n FROM batch_a1_jobs WHERE batch_id=$1", [batchId])).rows[0].n, 2);
    await button(modal, "Fechar").click();
    // Real credentials issued only to this QA batch. Editing merely hides them; GET restores the same saved profile without mutation.
    await enabled(button(adminRegion(page), "Gerar acesso do presidente")); await button(adminRegion(page), "Gerar acesso do presidente").click();
    await adminRegion(page).getByLabel("Código de acesso", { exact: true }).waitFor(); assert.equal(issuePosts.length, 1); assert.ok(credentials);
    await adminRegion(page).getByLabel("Responsável pela assinatura", { exact: true }).selectOption(String(alternate));
    assert.equal(await button(adminRegion(page), "Gerar acesso do presidente").isDisabled(), true); assert.equal(await adminRegion(page).getByLabel("Código de acesso", { exact: true }).count(), 0); assert.equal(profilePosts.length, 0);
    await button(adminRegion(page), "Conferir configuração").click(); await adminRegion(page).getByLabel("Código de acesso", { exact: true }).waitFor();
    assert.equal(await adminRegion(page).getByLabel("Responsável pela assinatura", { exact: true }).inputValue(), String(currentProfile.profile.responsibleId)); assert.equal(profilePosts.length, 0); assert.equal(issuePosts.length, 1);
    // Existing consumed core receipt/own artifact remains unchanged. Only non-secret context is seeded for metadata recovery.
    await page.evaluate(({ actorScope, sourceBatchId, issuedRequestId, documentVersion, profileFingerprint, receiptId, ownRequestId }) => {
      sessionStorage.setItem(`president-admin-issue:${actorScope}:${sourceBatchId}`, JSON.stringify({ requestId: issuedRequestId, batchId: sourceBatchId, expectedDocumentVersion: documentVersion, expectedProfileFingerprint: profileFingerprint }));
      sessionStorage.setItem(`president-own-pdf:${actorScope}:${sourceBatchId}:${receiptId}:${documentVersion}`, JSON.stringify({ requestId: ownRequestId, batchId: sourceBatchId, receiptId, expectedDocumentVersion: documentVersion }));
    }, { actorScope, sourceBatchId, issuedRequestId: issued.requestId, documentVersion, profileFingerprint, receiptId, ownRequestId: ownPdf.requestId });
    await page.goto(`${base}/admin/presidente?lote=${sourceBatchId}`); await enabled(button(adminRegion(page), "Conferir solicitação")); await button(adminRegion(page), "Conferir solicitação").click(); await ownRegion(page).waitFor();
    await adminRegion(page).getByLabel("Responsável pela assinatura", { exact: true }).selectOption(String(alternate)); assert.equal(await ownRegion(page).count(), 0); assert.equal(profilePosts.length, 0);
    await button(adminRegion(page), "Conferir configuração").click(); await ownRegion(page).waitFor(); assert.equal(profilePosts.length, 0); assert.equal(issuePosts.length, 1);
    for (const width of [320, 390, 768, 992, 1280, 1920]) { await page.setViewportSize({ width, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, `dirty-profile recovery overflow at ${width}`); const path = `${output}/president-recovery-${width}.png`; await page.screenshot({ path, fullPage: true }); shots.push({ width, path }); }
    const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, url: location.href }));
    for (const secret of [issued.token, issued.password, credentials.token, credentials.password, "%PDF-", "52998224725", "2000-01-01"]) assert.equal(storage.includes(secret), false);
    assert.equal((await db.query("SELECT row_to_json(b)::text state FROM batches b WHERE id=$1", [batchId])).rows[0].state, batchBefore);
    assert.deepEqual(await coreSnapshot(), beforeCore); assert.deepEqual(await mailSnapshot(), beforeMail);
    assert.equal((await db.query("SELECT value FROM settings WHERE key='president_profile_v1'")).rows[0].value, profileBefore);
    assert.equal((await db.query("SELECT count(*)::int n FROM batch_document_versions WHERE batch_id=$1 AND source='a1-worker'", [batchId])).rows[0].n, 0);
    assert.ok((await db.verifyAuditChain()).ok); assert.deepEqual(pageErrors, []); assert.deepEqual(blockedExternal, []);
    const result = { ok: true, compiledNextUi: true, realHandlersAndDatabase: true, separateBatchId: batchId, rejectedNonce, admittedJobId: admitted.jobId, orphanJobId: orphanId, closureRequestId: closePosts[1].requestId, applicationSigningPosts: 2, physicalSigningPosts: posts.length, applicationClosingPosts: 2, realCloseCasConflictRecovered: true, lateOldClosureRejected: true, physicalClosingPosts: closePosts.length, real409PolicyConflictWithoutJob: true, real404AndFreshPolicyBeforeReset: true, newSigningNonceOnlyOnClick: true, closureResponseLostRecoveredByGet: true, expiredFixtureClonedWithoutDisablingImmutableTrigger: true, oldLeaseFenced: true, noNewSigningAfterClosure: true, noAutoPostOrProfileMutation: true, credentialsHiddenWhileDirty: true, ownSlotHiddenWhileDirty: true, coreBatchAndJobsUnchanged: true, generatedPdfsUnchanged: true, noWorkerNoValidatorNoCertificate: true, noDispatchOrMail: true, shots, pageErrors, blockedExternal };
    writeFileSync(`${output}/president-recovery-compiled-extension.json`, JSON.stringify(result, null, 2) + "\n"); return result;
  } finally {
    // Global fictitious policy temporarily changed to prove a real rejection; restore exact original bytes even on assertion failure.
    await db.query("UPDATE settings SET value=$2 WHERE key=$1", [A1.BATCH_A1_POLICY_KEY, originalPolicyText]);
    assert.equal((await db.query("SELECT value FROM settings WHERE key=$1", [A1.BATCH_A1_POLICY_KEY])).rows[0].value, originalPolicyText);
    credentials = null; await context.close();
  }
}
