import fs from "node:fs";
import http from "node:http";
import assert from "node:assert/strict";
import { build } from "/mnt/apps/peticao-final/peticao-release/site/node_modules/esbuild/lib/main.js";
import { chromium } from "/home/barre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const root = process.env.QA_OUTPUT_DIR || "/mnt/apps/peticao-final/_ops/a1-habilitacao-20261112/credential-browser";
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const site = "/mnt/apps/peticao-final/peticao-release/site";
fs.writeFileSync(root + "/entry.tsx", `import React from '${site}/node_modules/react/index.js'; import {createRoot} from '${site}/node_modules/react-dom/client.js'; import A1Credencial from '${site}/src/components/admin/A1Credencial'; import '${site}/src/app/admin/admin.css'; import '${site}/src/app/admin/v2.css'; createRoot(document.getElementById('root')!).render(<div className="adm v2 adm-solo"><div className="adm-content v2-main"><main className="v2-pagina"><A1Credencial actorScope="123:456" /></main></div></div>);`);
await build({ entryPoints: [root + "/entry.tsx"], outfile: root + "/bundle.js", bundle: true, platform: "browser", jsx: "automatic", nodePaths: [site + "/node_modules"], define: { "process.env.NODE_ENV": '"production"' } });
const server = http.createServer((req, res) => {
  if (req.url === "/bundle.js" || req.url === "/bundle.css") { res.setHeader("content-type", req.url.endsWith("js") ? "text/javascript" : "text/css"); res.end(fs.readFileSync(root + req.url)); return; }
  res.setHeader("content-type", "text/html"); res.end('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundle.css"><div id="root"></div><script src="/bundle.js"></script></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const result = { checks: [], errors: [], fakeBackendOnly: true, productionChanged: false, secretsInEvidence: false };
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: "/home/barre/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome", args: ["--disable-dev-shm-usage"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage(); page.on("pageerror", e => result.errors.push(e.message));
  const metadata = { credentialVersionId: "11111111-1111-4111-8111-111111111111", certificateFingerprintSha256: "a".repeat(64), cnpj: "15883671000115", notBefore: "2026-11-11T00:00:00Z", notAfter: "2028-11-11T00:00:00Z", profileVersion: "pades-ad-rb-declared-unhomologated-v1", trustStoreVersion: "b".repeat(64), activatedAt: null };
  let state = "empty", intent = null, posts = [], reads = 0;
  const receipts = new Map();
  await page.route("**/api/admin/presidente/a1/credencial**", async route => {
    const req = route.request();
    if (req.method() === "GET") {
      reads++; const id = new URL(req.url()).searchParams.get("requestId");
      const found = id && receipts.get(id), current = state === "active" && (!found || id === metadata.credentialVersionId);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, configured: current, credential: found || (state === "empty" ? null : metadata), ...(id ? { intent: { requestId: id, state: found ? "completed" : "not_found", activated: current && !!found } } : {}) }) });
    }
    const body = req.postDataJSON(); posts.push(body); intent = body.requestId;
    if (body.pfxBase64) { metadata.credentialVersionId = intent; receipts.set(intent, { ...metadata }); state = "stored"; return route.abort("connectionreset"); }
    assert.deepEqual(Object.keys(body), ["requestId"]); state = "active"; metadata.activatedAt = "2026-11-12T18:00:00Z";
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, requestId: intent, credential: metadata, activated: true, replayed: true }) });
  });
  await page.goto(origin); await page.getByText("Assinatura A1 habilitada. Cadastre o certificado da ADUNIR para começar.").waitFor();
  assert.equal(posts.length, 0); result.checks.push("initial-hydration-performs-only-read-and-shows-enabled-awaiting-certificate");
  await page.getByLabel("Arquivo do certificado A1").setInputFiles({ name: "wrong.txt", mimeType: "text/plain", buffer: Buffer.from("fake-qa-certificate") });
  await page.getByLabel("Senha do certificado", { exact: true }).fill("QA-PASSWORD-NEVER-PERSIST");
  await page.getByLabel("Autorizo cadastrar este certificado para assinatura pela ADUNIR.", { exact: true }).check();
  await page.getByRole("button", { name: "Cadastrar certificado A1", exact: true }).click();
  await page.getByText("Escolha um certificado .pfx ou .p12 de até 2 MB e informe a senha.").waitFor(); assert.equal(posts.length, 0); result.checks.push("invalid-file-extension-does-not-post");
  await page.getByLabel("Arquivo do certificado A1").setInputFiles({ name: "qa.pfx", mimeType: "application/x-pkcs12", buffer: Buffer.from("QA-CERTIFICATE-NEVER-PERSIST") });
  await page.getByLabel("Autorizo cadastrar este certificado para assinatura pela ADUNIR.", { exact: true }).check();
  await page.getByRole("button", { name: "Cadastrar certificado A1", exact: true }).click();
  await page.getByText(/A resposta do cadastro não foi confirmada/).waitFor();
  assert.equal(posts.length, 1); assert.equal(await page.getByLabel("Senha do certificado", { exact: true }).count(), 0);
  const stored = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage }, href: location.href, html: document.body.innerText }));
  for (const secret of ["QA-PASSWORD-NEVER-PERSIST", "QA-CERTIFICATE-NEVER-PERSIST", Buffer.from("QA-CERTIFICATE-NEVER-PERSIST").toString("base64")]) assert.equal(JSON.stringify(stored).includes(secret), false);
  assert.equal(Object.keys(stored.session).length, 1); assert.match(Object.values(stored.session)[0], /^[a-f0-9-]{36}$/); assert.equal(Object.keys(stored.local).length, 0);
  result.checks.push("lost-post-response-clears-secrets-and-persists-only-bound-request-id-with-no-auto-retry");
  await page.reload(); await page.getByRole("button", { name: "Concluir ativação", exact: true }).waitFor();
  assert.equal(posts.length, 1); assert.equal((await page.getByRole("button", { name: "Concluir ativação", exact: true }).isEnabled()), false);
  result.checks.push("reload-recovers-metadata-by-get-without-resending-certificate-or-password");
  await page.getByLabel("Confirmo a ativação deste certificado para assinatura.", { exact: true }).check();
  await page.getByRole("button", { name: "Concluir ativação", exact: true }).click();
  await page.getByText("Certificado cadastrado e ativado. Você já pode solicitar a assinatura A1.").waitFor();
  assert.equal(posts.length, 2); assert.deepEqual(Object.keys(posts[1]), ["requestId"]); assert.equal(posts[0].requestId, posts[1].requestId);
  assert.deepEqual(await page.evaluate(() => ({ ...sessionStorage })), {}); assert.equal(await page.getByRole("button", { name: "Substituir certificado A1", exact: true }).isEnabled(), false);
  result.checks.push("explicit-completion-post-contains-only-request-id-and-replacement-requires-new-consent");
  for (const width of [360, 390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); assert.equal(overflow, false, "horizontal overflow at " + width);
    if (width === 390) await page.screenshot({ path: root + "/mobile.png", fullPage: true });
  }
  result.checks.push("six-responsive-widths-without-horizontal-overflow");
  const prior = intent;
  metadata.credentialVersionId = "22222222-2222-4222-8222-222222222222";
  await page.evaluate(id => sessionStorage.setItem("a1-credential-intent:v1:123:456", id), prior);
  await page.reload(); await page.getByRole("button", { name: "Concluir ativação", exact: true }).waitFor();
  await page.getByRole("button", { name: "Consultar certificado atual", exact: true }).click();
  await page.getByLabel("Conferi o certificado atual e quero encerrar o acompanhamento do pedido anterior.", { exact: true }).check();
  await page.getByRole("button", { name: "Encerrar acompanhamento anterior", exact: true }).click();
  await page.getByRole("button", { name: "Substituir certificado A1", exact: true }).waitFor();
  assert.equal(posts.length, 2); assert.deepEqual(await page.evaluate(() => ({ ...sessionStorage })), {});
  result.checks.push("superseded-intent-can-be-retired-after-explicit-current-certificate-read-without-reapplying-old-certificate");
  assert.deepEqual(result.errors, []); result.reads = reads; result.postCount = posts.length; result.exit = 0;
} catch (error) { result.exit = 1; result.error = String(error.stack || error); }
finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); fs.writeFileSync(root + "/result.json", JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); }
process.exitCode = result.exit;
