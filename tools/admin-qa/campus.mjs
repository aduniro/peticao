// Compiled HTTP + real database curation, exclusively on an isolated fictitious loopback preview.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL ?? "http://missing"), database = new URL(process.env.DATABASE_URL ?? "http://missing");
assert.equal(base.hostname, "127.0.0.1"); assert.equal(base.port, "3032"); assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "54345"); assert.equal(database.pathname, "/peticao");
assert.equal(process.env.PREVIEW_MODE, "1"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0"); assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.ok(process.env.QA_CRON_SECRET); assert.ok(process.env.QA_OUTPUT_DIR);
const bootstrap = await fetch(new URL("/admin", base)); assert.equal(bootstrap.status, 200); assert.ok((await bootstrap.text()).includes("/dev/outbox"));
const dm = await import("../../site/src/lib/db.ts"), um = await import("../../site/src/lib/admin-users.ts"), db = dm.default ?? dm, U = um.default ?? um;
const tokens = [];
try {
  assert.equal((await db.query("SELECT 1 FROM contact_messages UNION ALL SELECT 1 FROM contact_campus_reviews UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM contact_replies UNION ALL SELECT 1 FROM cpf_lookup_cache")).rowCount, 0, "Use a fresh fixture database only");
  const contact = (await db.query("INSERT INTO contact_messages(name,email,kind,message) VALUES('QA Campus Runtime','qa-campus-runtime@example.test','duvida','Não achei meu campus. 123.456.789-09 NEVER_COPY_BODY') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at) VALUES('QA Campus Runtime','qa-campus-runtime@example.test','qa-campus-email','qa-campus-cpf','apoiador','QA',now())");
  const snapshot = async () => (await db.query("SELECT row_to_json(s)::text data FROM signatures s UNION ALL SELECT row_to_json(r)::text FROM contact_replies r UNION ALL SELECT row_to_json(o)::text FROM mail_outbox o")).rows;
  const before = await snapshot(), publicData = new URL("../../site/public/data/ifes.json", import.meta.url), publicBefore = await readFile(publicData);
  const actor = async nivel => {
    const r = await U.criarUsuario({ email: `qa-campus-${nivel}@example.test`, nome: `QA Campus ${nivel}`, nivel, senha: "QA-Campus-Runtime-2026-Ficticia" }); assert.ok(r.ok);
    const token = (await U.abrirSessao(r.usuario.id, "127.0.0.1")).token; tokens.push(token); return { token, id: r.usuario.id };
  };
  const editor = await actor("edicao"), total = await actor("total"), reader = await actor("leitura");
  const request = (actor, method = "GET", body) => fetch(new URL(`/api/admin/contato/campus?contato=${contact}`, base), { method, headers: { origin: base.origin, cookie: actor ? `adm=${actor.token}` : "", "content-type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await request(null)).status, 401); assert.equal((await request(reader)).status, 403);
  const asked = await fetch(new URL("/api/admin/contato/triagem", base), { method: "POST", headers: { origin: base.origin, cookie: `adm=${editor.token}`, "content-type": "application/json" }, body: JSON.stringify({ contato: contact }) }); assert.equal(asked.status, 200);
  const tick = await fetch(new URL("/api/cron/fila", base), { method: "POST", headers: { authorization: `Bearer ${process.env.QA_CRON_SECRET}` } }); assert.equal(tick.status, 200);
  assert.equal((await db.query("SELECT analysis->>'category' category FROM contact_triage_jobs WHERE contact_id=$1", [contact])).rows[0].category, "campus");
  const input = { contato: contact, proposal: { institution: "unir", cityIbge: 1200401, campusName: "QA Campus Fictício", sourceUrl: "https://www.unir.br/qa-campus-ficticio" }, decision: "approved", sourceReviewed: true, expectedDecisionId: null };
  const preview = async (actor, data) => { const r = await request(actor, "POST", { modo: "preview", input: data }); assert.equal(r.status, 200); return r.json(); };
  const record = (actor, data, proof) => request(actor, "POST", { modo: "record", input: data, proof });
  const editorPreview = await preview(editor, input); assert.equal((await record(editor, input, editorPreview.proof)).status, 403);
  const proposed = await preview(total, input); assert.equal(proposed.published, false); assert.equal(proposed.requiresHumanReview, true); assert.equal((await db.query("SELECT 1 FROM contact_campus_reviews")).rowCount, 0);
  assert.equal((await record(total, input, proposed.proof)).status, 403);
  await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=$1", [total.id]);
  assert.equal((await record(total, input, editorPreview.proof)).status, 409);
  assert.equal((await request(total, "POST", { modo: "record", input, proof: proposed.proof, actor: "forged" })).status, 400);
  const firstResponse = await record(total, input, proposed.proof); assert.equal(firstResponse.status, 200); const first = await firstResponse.json(); assert.equal(first.existing, false);
  const retry = await record(total, input, proposed.proof); assert.equal(retry.status, 200); assert.equal((await retry.json()).id, first.id);
  const originalHistory = await (await request(editor)).json(); assert.equal(originalHistory.records.length, 1); assert.equal(originalHistory.records[0].created_by, total.id);
  const correction = { ...input, decision: "rejected", sourceReviewed: false, expectedDecisionId: first.id }, corrected = await preview(total, correction);
  assert.equal((await record(total, correction, corrected.proof)).status, 200); assert.equal((await record(total, input, proposed.proof)).status, 409);
  const history = await (await request(editor)).json(); assert.equal(history.records.length, 2); assert.deepEqual(history.records[1], originalHistory.records[0]); assert.equal(history.records[0].previous_id, first.id); assert.equal(history.published, false);
  for (const secret of ["NEVER_COPY_BODY", "123.456.789-09", "qa-campus-cpf", "intent_hash"]) assert.ok(!JSON.stringify(history).includes(secret));
  assert.deepEqual(await snapshot(), before); assert.deepEqual(await readFile(publicData), publicBefore); assert.ok((await db.verifyAuditChain()).ok);
  const report = { ok: true, compiledHttp: true, rolesAndStepup: true, redactionDoesNotChangeCategory: true, previewReadOnly: true, reviewerBoundProof: true, idempotent: true, appendOnlyCorrection: true, oldIntentCannotRevive: true, noSignerOrMailWrites: true, noPublicCampusWrite: true };
  await mkdir(process.env.QA_OUTPUT_DIR, { recursive: true }); await writeFile(`${process.env.QA_OUTPUT_DIR}/campus.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally {
  for (const token of tokens) await U.encerrarSessao(token);
  await db._closeDbForTests();
}
