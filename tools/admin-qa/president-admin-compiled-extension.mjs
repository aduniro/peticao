/** Actual compiled ADMIN UI extension. Call only inside the isolated president runner. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const hash = value => createHash("sha256").update(value).digest("hex");
const button = (region, name) => region.getByRole("button", { name, exact: true });
const snapshot = row => ({ pdf: hash(row.pdf), pdfSha256: row.pdf_sha256, signedPdf: row.signed_pdf ? hash(row.signed_pdf) : null, approvedAt: row.approved_at?.toISOString() ?? null, sentAt: row.sent_at?.toISOString() ?? null });

export async function runPresidentAdminCompiledExtension({ browser, base, sessionToken, actor, db, store, output, sourceBatchId }) {
  assert.equal(base, "http://127.0.0.1:3055");
  assert.equal(process.env.DATABASE_URL, "postgres://peticao:peticao@127.0.0.1:54379/peticao");
  assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.equal(process.env.MAIL_PROVIDERS, "dev");
  assert.equal(process.env.QA_SITE_DIR, "/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site");
  assert.equal(output, process.env.QA_OUTPUT_DIR);
  assert.ok(actor?.sessaoId && actor.nivel === "total");
  const sourceSql = "SELECT pdf,pdf_sha256,signed_pdf,approved_at,sent_at FROM batches WHERE id=$1";
  const sourceBefore = snapshot((await db.query(sourceSql, [sourceBatchId])).rows[0]);
  const mailBefore = (await db.query("SELECT (SELECT count(*)::int FROM mail_messages) AS messages,(SELECT count(*)::int FROM mail_outbox) AS outbox,(SELECT count(*)::int FROM batch_sends) AS sends")).rows[0];
  const originalProfile = await store.readPresidentProfile(actor); assert.ok(originalProfile.ok && originalProfile.profile);
  // Extra fixtures have no connection to real participants and never alter the external scenario's batch.
  const responsible = (await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash)SELECT COALESCE(max(id),0)+1,'qa-president-alternate@example.test','Responsavel Alternativo Ficticio QA','leitura','QA-NOT-A-LOGIN-HASH' FROM admin_users RETURNING id")).rows[0].id;
  const insertBatch = async signed => (await db.query(`INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,n_estrangeiro,list_hash,pdf,pdf_sha256,signed_pdf,signed_pdf_sha256,signature_kind)
    SELECT (SELECT COALESCE(max(seq),0)+1 FROM batches),'partial','prepared',0,1,0,list_hash,pdf,pdf_sha256,
      CASE WHEN $2::boolean THEN pdf ELSE NULL END,CASE WHEN $2::boolean THEN pdf_sha256 ELSE NULL END,
      CASE WHEN $2::boolean THEN 'icp-brasil' ELSE 'none' END FROM batches WHERE id=$1 RETURNING id`, [sourceBatchId, signed])).rows[0].id;
  const batchId = await insertBatch(false), signedBatchId = await insertBatch(true);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "pt-BR" });
  const pageErrors = [], blockedExternal = [], shots = [], issueRequests = [], recoveryResponses = [], profileRequests = [];
  let dropFirstIssue = true, lostCredentials = null;
  const scope = page => page.getByRole("region", { name: "Assinatura própria do app", exact: true });
  const url = id => `${base}/admin/presidente?lote=${id}`;
  const readStoredProfile = async () => JSON.parse((await db.query("SELECT value FROM settings WHERE key='president_profile_v1'")).rows[0].value);
  try {
    await context.addCookies([{ name: "adm", value: sessionToken, url: base, httpOnly: true, sameSite: "Lax" }]);
    await context.route("**/*", route => {
      const target = new URL(route.request().url());
      return target.origin === base || target.protocol === "blob:" ? route.continue() : (blockedExternal.push(target.hostname), route.abort());
    });
    await context.route("**/api/admin/presidente/perfil", async route => {
      if (route.request().method() === "POST") profileRequests.push(route.request().postDataJSON());
      return route.continue();
    });
    await context.route("**/api/admin/presidente/desafio**", async route => {
      const request = route.request();
      if (request.method() === "POST") {
        const intent = request.postDataJSON(); issueRequests.push(intent);
        assert.ok(request.headers().cookie?.includes("adm="), "admin transport must include its session cookie");
        const response = await route.fetch({ maxRedirects: 0 });
        if (dropFirstIssue) {
          assert.equal(response.status(), 200, "first issue must commit before losing its response");
          const data = await response.json(); assert.ok(data.ok && data.token && data.password);
          lostCredentials = { token: data.token, password: data.password };
          dropFirstIssue = false;
          return route.abort("failed");
        }
        return route.fulfill({ response });
      }
      const response = await route.fetch({ maxRedirects: 0 });
      const data = await response.json();
      if (response.ok()) {
        assert.equal(data.credentialsRecoverable, false);
        assert.equal(Object.hasOwn(data, "token"), false); assert.equal(Object.hasOwn(data, "password"), false);
        recoveryResponses.push(data);
      }
      return route.fulfill({ response });
    });
    const page = await context.newPage(), stale = await context.newPage();
    for (const p of [page, stale]) p.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(url(batchId)); await scope(page).waitFor();
    await stale.goto(url(batchId)); await scope(stale).waitFor();
    const region = scope(page), staleRegion = scope(stale);
    // Two real SSR pages share the same revision. Only the first explicit edit may win.
    const oldRevision = originalProfile.profile.revision;
    await region.getByLabel("Responsável pela assinatura", { exact: true }).selectOption(String(responsible));
    assert.equal(await region.getByLabel("CPF do responsável", { exact: true }).getAttribute("required"), "");
    await region.getByLabel("CPF do responsável", { exact: true }).fill("52998224725");
    await button(region, "Salvar responsável").click();
    await region.getByText("Configuração conferida.", { exact: true }).waitFor();
    assert.equal(await region.getByLabel("CPF do responsável", { exact: true }).inputValue(), "");
    assert.equal(profileRequests.length, 1); assert.equal(profileRequests[0].expectedRevision, oldRevision);
    assert.equal(profileRequests[0].responsibleId, responsible);
    const afterWinner = await readStoredProfile();
    assert.equal(afterWinner.revision, oldRevision + 1); assert.equal(afterWinner.responsibleId, responsible);
    await button(staleRegion, "Salvar responsável").click();
    await staleRegion.getByText("Não foi possível salvar. Confira a configuração antes de editar novamente.", { exact: true }).waitFor();
    assert.equal(await button(staleRegion, "Salvar responsável").isDisabled(), true);
    assert.equal(profileRequests.length, 2); assert.equal(profileRequests[1].expectedRevision, oldRevision);
    assert.deepEqual(await readStoredProfile(), afterWinner, "stale UI must not overwrite the winning profile");
    await button(staleRegion, "Conferir configuração").click();
    await staleRegion.getByText("Configuração conferida.", { exact: true }).waitFor();
    assert.equal(await staleRegion.getByLabel("Responsável pela assinatura", { exact: true }).inputValue(), String(responsible));
    await stale.close();
    // One actual handler admission, then a lost browser response. No fake API outcome is substituted.
    const beforeIssueCount = (await db.query("SELECT count(*)::int n FROM president_challenges WHERE batch_id=$1", [batchId])).rows[0].n;
    await button(region, "Gerar acesso do presidente").click();
    await region.getByText("Não foi possível confirmar o resultado. Confira a solicitação antes de tentar outra ação.", { exact: true }).waitFor();
    assert.equal(issueRequests.length, 1); assert.ok(lostCredentials);
    const intent = issueRequests[0];
    assert.equal(intent.batchId, batchId); assert.equal(Object.keys(intent).sort().join(","), "batchId,expectedDocumentVersion,expectedProfileFingerprint,requestId");
    assert.equal(await button(region, "Gerar acesso do presidente").isDisabled(), true);
    const persistedBefore = (await db.query("SELECT id,request_id,document_version,token_hash,password_hash,expires_at,state,attempts FROM president_challenges WHERE batch_id=$1 AND issued_by=$2 AND request_id=$3", [batchId, actor.userId, intent.requestId])).rows;
    assert.equal(persistedBefore.length, 1); assert.equal(persistedBefore[0].state, "issued"); assert.equal(persistedBefore[0].attempts, 0);
    assert.equal(persistedBefore[0].document_version, intent.expectedDocumentVersion);
    assert.equal((await db.query("SELECT count(*)::int n FROM president_challenges WHERE batch_id=$1", [batchId])).rows[0].n, beforeIssueCount + 1);
    await page.reload(); await scope(page).waitFor();
    await page.waitForFunction(() => {
      const region = [...document.querySelectorAll("section[aria-labelledby]")].find(s => s.querySelector("h3")?.textContent === "Assinatura própria do app");
      const check = region && [...region.querySelectorAll("button")].find(b => b.textContent === "Conferir solicitação");
      return check && !check.disabled;
    });
    assert.equal(issueRequests.length, 1, "reload must not POST or mint a new nonce");
    assert.equal(await button(scope(page), "Gerar acesso do presidente").isDisabled(), true);
    assert.equal(await scope(page).getByLabel("Senha temporária", { exact: true }).count(), 0);
    await button(scope(page), "Conferir solicitação").click();
    await scope(page).getByText("Solicitação conferida. A senha e o código não são recuperados por esta consulta.", { exact: true }).waitFor();
    assert.equal(recoveryResponses.length, 1); assert.equal(recoveryResponses[0].requestId, intent.requestId);
    assert.equal(recoveryResponses[0].challengeId, persistedBefore[0].id); assert.equal(recoveryResponses[0].documentVersion, intent.expectedDocumentVersion);
    assert.equal(recoveryResponses[0].isCurrent, true);
    const persistedAfter = (await db.query("SELECT id,request_id,document_version,token_hash,password_hash,expires_at,state,attempts FROM president_challenges WHERE batch_id=$1 AND issued_by=$2 AND request_id=$3", [batchId, actor.userId, intent.requestId])).rows;
    assert.deepEqual(persistedAfter, persistedBefore, "recovery must not rotate secrets, expiry, attempts or state");
    const local = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, url: location.href }));
    assert.ok(local.includes(intent.requestId), "nonsecret intent must survive reload");
    for (const secret of [lostCredentials.token, lostCredentials.password, "52998224725"]) assert.equal(local.includes(secret), false);
    for (const width of [320, 390, 768, 992, 1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, `admin page overflow at ${width}`);
      const path = `${output}/president-admin-${width}.png`;
      await page.screenshot({ path, fullPage: true }); shots.push({ width, path });
    }
    // The source is a deliberately synthetic signed-state fixture, not cryptographic validation.
    await page.goto(url(signedBatchId)); await scope(page).waitFor();
    assert.equal(await button(scope(page), "Gerar acesso do presidente").isDisabled(), true);
    const requestsBeforeSigned = issueRequests.length;
    await page.getByRole("heading", { name: "Assinatura própria do app", exact: true }).click();
    assert.equal(issueRequests.length, requestsBeforeSigned);
    assert.equal((await db.query("SELECT count(*)::int n FROM president_challenges WHERE batch_id=$1", [signedBatchId])).rows[0].n, 0);
    assert.deepEqual(snapshot((await db.query(sourceSql, [sourceBatchId])).rows[0]), sourceBefore);
    assert.deepEqual((await db.query("SELECT (SELECT count(*)::int FROM mail_messages) AS messages,(SELECT count(*)::int FROM mail_outbox) AS outbox,(SELECT count(*)::int FROM batch_sends) AS sends")).rows[0], mailBefore);
    assert.ok((await db.verifyAuditChain()).ok); assert.deepEqual(pageErrors, []);
    const result = {
      ok: true, compiledAdminUi: true, actualHandlersAndPostgres: true,
      extraFixtureBatchIds: [batchId, signedBatchId], profileCasAcrossTwoPages: true,
      ownerProfileRevisionAdvancedOnce: true, cpfClearedAfterSave: true,
      issuanceCommittedThenResponseLost: true, physicalIssueRequests: issueRequests.length,
      reloadReusesIntentWithoutPost: true, metadataRecoveryWithoutSecrets: true,
      recoveryPreservesCredentialsExpiryAttempts: true, signedPdfDisablesOwnIssue: true,
      externalScenarioBatchPreserved: true, mailAndDispatchTablesPreserved: true,
      signedFixtureIsNotCryptoHomologation: true, shots, pageErrors, blockedExternal,
    };
    writeFileSync(`${output}/admin-browser-result.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
    return result;
  } finally {
    lostCredentials = null;
    await context.close();
  }
}
