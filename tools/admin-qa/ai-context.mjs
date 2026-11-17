// Real compiled routes, isolated fictitious database, no provider executor.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL ?? "http://missing"), database = new URL(process.env.DATABASE_URL ?? "http://missing");
assert.equal(base.hostname, "127.0.0.1"); assert.equal(base.port, "3032"); assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "54345"); assert.equal(database.pathname, "/peticao");
assert.equal(process.env.PREVIEW_MODE, "1"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0"); assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.ok(process.env.QA_CRON_SECRET); assert.ok(process.env.QA_OUTPUT_DIR);
const bootstrap = await fetch(new URL("/admin", base)); assert.equal(bootstrap.status, 200); assert.ok((await bootstrap.text()).includes("/dev/outbox"));
const dm = await import("../../site/src/lib/db.ts"), um = await import("../../site/src/lib/admin-users.ts"), cm = await import("../../site/src/lib/ai/configuration.ts"), db = dm.default ?? dm, U = um.default ?? um, C = cm.default ?? cm;
const tokens = [];
try {
  assert.equal((await db.query("SELECT 1 FROM contact_messages UNION ALL SELECT 1 FROM contact_replies UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM cpf_lookup_cache")).rowCount, 0);
  const contact = (await db.query("INSERT INTO contact_messages(name,email,kind,message) VALUES('NEVER_PRIVATE_NAME','qa-ai-runtime@example.test','duvida','Meu CPF não confere 123.456.789-09 NEVER_BODY') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,token_hash) VALUES('NEVER_SIGNER_NAME','qa-ai-runtime@example.test','NEVER_EMAIL_HASH','NEVER_CPF_HASH','apoiador','QA',now(),'NEVER_TOKEN')");
  const snapshot = async () => (await db.query("SELECT row_to_json(s)::text data FROM signatures s UNION ALL SELECT row_to_json(r)::text FROM contact_replies r UNION ALL SELECT row_to_json(o)::text FROM mail_outbox o")).rows;
  const before = await snapshot();
  const actor = async nivel => {
    const r = await U.criarUsuario({ email: `qa-ai-${nivel}@example.test`, nome: "QA IA", nivel, senha: "QA-Context-Access-2026-Ficticia" }); assert.ok(r.ok);
    const token = (await U.abrirSessao(r.usuario.id, "127.0.0.1")).token; tokens.push(token); return { token, id: r.usuario.id };
  };
  const total = await actor("total"), editor = await actor("edicao"), reader = await actor("leitura");
  const request = (path, actor, body) => fetch(new URL(path, base), { method: body === undefined ? "GET" : "POST", headers: { origin: base.origin, cookie: actor ? `adm=${actor.token}` : "", "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal((await request("/api/admin/ia/configuracao", null)).status, 401); assert.equal((await request("/api/admin/ia/configuracao", editor)).status, 403);
  assert.equal((await request("/api/admin/contato/triagem", editor, { contato: contact })).status, 200);
  const tick = () => fetch(new URL("/api/cron/fila", base), { method: "POST", headers: { authorization: `Bearer ${process.env.QA_CRON_SECRET}` } }); assert.equal((await tick()).status, 200);
  const input = { uso: "painel", consulta: "Amazonia" }, prepared = await request("/api/admin/ia/contexto", reader, { modo: "preparar", input }); assert.equal(prepared.status, 200); const initial = await prepared.json(); assert.equal(initial.executionAvailable, false); assert.equal(initial.requestedEnabled, false); assert.ok(!("input" in initial)); assert.ok(!("instructions" in initial));
  assert.equal((await request("/api/admin/ia/contexto", reader, { modo: "conferir", input, proof: initial.proof })).status, 200);
  const supportInput = { uso: "atendimento", consulta: "Amazonia", contato: contact };
  assert.equal((await request("/api/admin/ia/contexto", reader, { modo: "preparar", input: supportInput })).status, 403);
  const supportResponse = await request("/api/admin/ia/contexto", editor, { modo: "preparar", input: supportInput }); assert.equal(supportResponse.status, 200); const support = await supportResponse.json(); assert.equal(support.supportContext.contactId, contact);
  const publicity = await request("/api/admin/ia/contexto", editor, { modo: "preparar", input: { uso: "divulgacao", consulta: "Amazonia" } }); assert.equal(publicity.status, 200); assert.notEqual((await publicity.json()).proof, initial.proof);
  const config = C.defaultConfiguration(); config.enabled = true; for (const p of Object.values(config.profiles)) p.model = "qa-explicit-model";
  assert.equal((await request("/api/admin/ia/configuracao", total, { config, expectedRevision: 0 })).status, 403);
  await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=$1", [total.id]);
  const saved = await request("/api/admin/ia/configuracao", total, { config, expectedRevision: 0 }); assert.equal(saved.status, 200); assert.equal((await saved.json()).executionAvailable, false);
  assert.equal((await request("/api/admin/ia/configuracao", total, { config, expectedRevision: 0 })).status, 409);
  assert.equal((await request("/api/admin/ia/configuracao", total, { config, expectedRevision: 1, apiKey: "NEVER" })).status, 400);
  assert.equal((await request("/api/admin/ia/contexto", reader, { modo: "conferir", input, proof: initial.proof })).status, 409);
  assert.equal((await request("/api/admin/ia/contexto", editor, { modo: "conferir", input: supportInput, proof: support.proof })).status, 409);
  const currentResponse = await request("/api/admin/ia/contexto", editor, { modo: "preparar", input: supportInput }); assert.equal(currentResponse.status, 200); const current = await currentResponse.json(); assert.equal(current.requestedEnabled, true); assert.equal(current.executionAvailable, false);
  for (const privateValue of ["NEVER_PRIVATE_NAME", "NEVER_BODY", "123.456.789-09", "NEVER_CPF_HASH", "NEVER_TOKEN"]) assert.ok(!JSON.stringify(current).includes(privateValue));
  assert.equal((await request("/api/admin/contato/triagem", editor, { contato: contact })).status, 200);
  assert.equal((await request("/api/admin/ia/contexto", editor, { modo: "conferir", input: supportInput, proof: current.proof })).status, 409); assert.equal((await tick()).status, 200);
  const next = await request("/api/admin/ia/contexto", editor, { modo: "preparar", input: supportInput }); assert.equal(next.status, 200); assert.notEqual((await next.json()).proof, current.proof);
  assert.deepEqual(await snapshot(), before); assert.ok((await db.verifyAuditChain()).ok);
  const report = { ok: true, compiledHttp: true, threeContexts: true, roleAndStepup: true, explicitProfiles: true, configurationConflict: true, staleContextRejected: true, promptNotExposed: true, executionUnavailable: true, noSignerOrMailWrites: true };
  await mkdir(process.env.QA_OUTPUT_DIR, { recursive: true }); await writeFile(`${process.env.QA_OUTPUT_DIR}/ai-context.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { for (const token of tokens) await U.encerrarSessao(token); await db._closeDbForTests(); }
