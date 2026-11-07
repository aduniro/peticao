import test from "node:test";
import assert from "node:assert/strict";
import { defaultConfiguration, parseConfiguration, CONFIG_KEY } from "./ai/configuration";
import { openAiDraft, openAiRequest } from "./ai/openai-protocol";
(process.env as Record<string,string>).NODE_ENV = "test"; process.env.MAIL_PROVIDER = "dev"; process.env.AI_EXECUTION_ENABLED = "0";
async function setup() {
  const db = await import("./db"); await db._openForTests("t_ai_context");
  const C = await import("./ai/configuration"), A = await import("./ai/context"), J = await import("./contact-triage/jobs"), U = await import("./admin-users");
  const user = await U.criarUsuario({ email: "qa-ai-total@example.test", nome: "QA IA", nivel: "total", senha: "QA-Ai-Context-2026-Ficticia" }); assert.ok(user.ok);
  const actor = { userId: user.usuario.id, email: user.usuario.email };
  const contact = (await db.query("INSERT INTO contact_messages(name,email,kind,message) VALUES('NEVER_PRIVATE_NAME','private@example.test','duvida','Meu CPF não confere 123.456.789-09 NEVER_BODY') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,token_hash) VALUES('NEVER_SIGNER_NAME','private@example.test','NEVER_EMAIL_HASH','NEVER_CPF_HASH','apoiador','QA',now(),'NEVER_TOKEN')");
  await J.requestTriage(contact, actor.email); await J.processTriage();
  const enabled = () => { const c = defaultConfiguration(); c.enabled = true; for (const p of Object.values(c.profiles)) p.model = "qa-explicit-model"; return c; };
  return { db, C, A, J, U, actor, contact, enabled };
}
const unchanged = async (db: Awaited<ReturnType<typeof setup>>["db"]) => (await db.query("SELECT row_to_json(s)::text data FROM signatures s UNION ALL SELECT row_to_json(c)::text FROM contact_messages c UNION ALL SELECT row_to_json(j)::text FROM contact_triage_jobs j UNION ALL SELECT row_to_json(r)::text FROM contact_replies r UNION ALL SELECT row_to_json(q)::text FROM mail_outbox q")).rows;

test("configuração inicia desativada e valida perfis/limites sem aceitar chaves ou endpoints", () => {
  const c = defaultConfiguration(); assert.equal(c.enabled, false); assert.ok(parseConfiguration(c)); assert.ok(Object.values(c.profiles).every(p => p.model === null));
  assert.equal(parseConfiguration({ ...c, enabled: true }), null);
  assert.equal(parseConfiguration({ ...c, apiKey: "NEVER_KEY" }), null);
  assert.equal(parseConfiguration({ ...c, profiles: { ...c.profiles, painel: { ...c.profiles.painel, provider: "unknown" } } }), null);
  assert.equal(parseConfiguration({ ...c, profiles: { ...c.profiles, painel: { ...c.profiles.painel, model: "sk-NEVER-KEY" } } }), null);
  assert.equal(parseConfiguration({ ...c, limits: { ...c.limits, maxOutputTokens: 0 } }), null);
  assert.equal(parseConfiguration({ ...c, limits: { ...c.limits, dailyOutputTokens: 16 } }), null);
});

test("configuração tem autoria, concorrência por revisão e permissão atual sem alterar dados de assinantes", async () => {
  const c = await setup(); try {
    const before = await unchanged(c.db); assert.equal((await c.C.aiConfiguration()).ok, true); assert.equal((await c.db.query("SELECT 1 FROM settings WHERE key=$1", [CONFIG_KEY])).rowCount, 0);
    const results = await Promise.all([c.C.saveAiConfiguration(c.enabled(), 0, c.actor), c.C.saveAiConfiguration(defaultConfiguration(), 0, c.actor)]); assert.equal(results.filter(r => r.ok).length, 1);
    const config = await c.C.aiConfiguration(); assert.ok(config.ok); assert.equal(config.revision, 1); assert.equal(config.executionAvailable, false);
    await c.db.query("UPDATE admin_users SET ativo=false WHERE id=$1", [c.actor.userId]); assert.ok(!(await c.C.saveAiConfiguration(defaultConfiguration(), 1, c.actor)).ok);
    assert.deepEqual(await unchanged(c.db), before); assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("falha de auditoria reverte configuração e estado inválido não é sobrescrito silenciosamente", async () => {
  const c = await setup(); try {
    await c.db.query("CREATE FUNCTION fail_ai_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='admin_ai_configuration_changed' THEN RAISE EXCEPTION 'QA'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_ai_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_ai_audit()");
    await assert.rejects(c.C.saveAiConfiguration(c.enabled(), 0, c.actor)); assert.equal((await c.db.query("SELECT 1 FROM settings WHERE key=$1", [CONFIG_KEY])).rowCount, 0);
    await c.db.query("DROP TRIGGER fail_ai_audit ON audit_log; INSERT INTO settings(key,value) VALUES('admin_ai_profiles_v1','malformed')");
    const bad = await c.C.aiConfiguration(); assert.ok(!bad.ok); assert.equal(bad.error, "configuration_invalid"); assert.ok(!(await c.C.saveAiConfiguration(defaultConfiguration(), 0, c.actor)).ok);
    assert.equal((await c.db.query("SELECT value FROM settings WHERE key=$1", [CONFIG_KEY])).rows[0].value, "malformed");
  } finally { await c.db._closeDbForTests(); }
});

test("três contextos separados são somente leitura; atendimento não copia dados pessoais ou relato", async () => {
  const c = await setup(); try {
    const before = await unchanged(c.db), proofs: string[] = [];
    for (const uso of ["painel", "divulgacao", "atendimento"] as const) {
      const input = uso === "atendimento" ? { uso, consulta: "Amazonia", contato: c.contact } : { uso, consulta: "Amazonia" };
      const r = await c.A.prepareAiContext(input); assert.ok(r.ok); assert.equal(r.executionAvailable, false); assert.equal(r.requestedEnabled, false); proofs.push(r.proof);
      assert.ok((await c.A.validateAiContext(input, r.proof)).ok);
      if (uso === "atendimento") assert.ok(JSON.parse(r.input).support.analysis.category === "cpf");
      for (const hidden of ["NEVER_PRIVATE_NAME", "NEVER_SIGNER_NAME", "NEVER_BODY", "123.456.789-09", "private@example.test", "NEVER_TOKEN", "NEVER_CPF_HASH", "NEVER_EMAIL_HASH", "contactId"]) assert.ok(!r.input.includes(hidden));
    }
    assert.equal(new Set(proofs).size, 3); assert.deepEqual(await unchanged(c.db), before);
  } finally { await c.db._closeDbForTests(); }
});

test("mudança de configuração ou triagem invalida contexto; prova de preparação não autoriza envio", async () => {
  const c = await setup(); try {
    const input = { uso: "atendimento", consulta: "Amazonia", contato: c.contact }, first = await c.A.prepareAiContext(input); assert.ok(first.ok);
    assert.ok((await c.C.saveAiConfiguration(c.enabled(), 0, c.actor)).ok); assert.ok(!(await c.A.validateAiContext(input, first.proof)).ok);
    const next = await c.A.prepareAiContext(input); assert.ok(next.ok);
    await c.J.requestTriage(c.contact, c.actor.email); assert.ok(!(await c.A.validateAiContext(input, next.proof)).ok); await c.J.processTriage(); assert.ok(!(await c.A.validateAiContext(input, next.proof)).ok);
    assert.equal((await c.db.query("SELECT 1 FROM contact_replies UNION ALL SELECT 1 FROM mail_outbox")).rowCount, 0);
  } finally { await c.db._closeDbForTests(); }
});

test("tamanho, ausência de fonte e parâmetros privados não produzem contexto silenciosamente cortado", async () => {
  const c = await setup(); try {
    assert.ok(!(await c.A.prepareAiContext({ uso: "painel", consulta: "zzzznotfound" })).ok);
    assert.ok(!(await c.A.prepareAiContext({ uso: "painel", consulta: "12345678909" })).ok);
    assert.ok(!(await c.A.prepareAiContext({ uso: "painel", consulta: "Amazonia", contato: c.contact })).ok);
    const cfg = defaultConfiguration(); cfg.limits.maxInputBytes = 1024; await c.C.saveAiConfiguration(cfg, 0, c.actor);
    const big = await c.A.prepareAiContext({ uso: "painel", consulta: "Amazonia" }); assert.ok(!big.ok); assert.equal(big.error, "context_too_large");
  } finally { await c.db._closeDbForTests(); }
});

test("protocolo OpenAI é offline, conserva modelo explícito e impede ferramentas, conversa persistente e saída parcial", async () => {
  const c = await setup(); try {
    const input = { uso: "painel", consulta: "Amazonia" }, disabled = await c.A.prepareAiContext(input); assert.ok(disabled.ok); assert.ok(!openAiRequest(disabled).ok);
    const cfg = c.enabled(); cfg.profiles.painel.effort = "high"; await c.C.saveAiConfiguration(cfg, 0, c.actor);
    const context = await c.A.prepareAiContext(input); assert.ok(context.ok); const request = openAiRequest(context); assert.ok(request.ok);
    assert.equal(request.url, "https://api.openai.com/v1/responses"); assert.equal(request.body.model, "qa-explicit-model"); assert.equal(request.body.store, false); assert.deepEqual(request.body.tools, []); assert.equal(request.body.tool_choice, "none"); assert.equal(request.body.max_output_tokens, cfg.limits.maxOutputTokens); assert.equal(request.body.reasoning?.effort, "high"); assert.ok(!("previous_response_id" in request.body)); assert.ok(!("headers" in request));
    const citation = context.sources[0], payload = { text: "QA minuta com fonte para revisão", needsReview: true, citations: [citation] };
    const response = (body: unknown = payload) => ({ status: "completed", output: [{ type: "reasoning", summary: ["NEVER_REASONING"] }, { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(body) }] }], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
    const valid = openAiDraft(response(), context); assert.ok(valid.ok); assert.equal(valid.draft.requiresHumanReview, true); assert.ok(!JSON.stringify(valid).includes("NEVER_REASONING"));
    for (const body of [{ ...payload, needsReview: false }, { ...payload, executar: true }, { ...payload, citations: [] }, { ...payload, citations: [{ ...citation, version: "0".repeat(64) }] }]) assert.ok(!openAiDraft(response(body), context).ok);
    assert.ok(!openAiDraft({ ...response(), status: "incomplete" }, context).ok); assert.ok(!openAiDraft({ ...response(), output: [{ type: "function_call", name: "send_email" }] }, context).ok); assert.ok(!openAiDraft({ ...response(), usage: { input_tokens: 100, output_tokens: 50000, total_tokens: 50100 } }, context).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("API separa leitura/preparação e configuração Total com confirmação extra, sem retornar prompt ou executar", async () => {
  const c = await setup(), old = { preview: process.env.PREVIEW_MODE, noPassword: process.env.ADMIN_NO_PASSWORD }; delete process.env.PREVIEW_MODE; delete process.env.ADMIN_NO_PASSWORD;
  try {
    const { NextRequest } = await import("next/server"), settings = await import("../app/api/admin/ia/configuracao/route"), context = await import("../app/api/admin/ia/contexto/route");
    const req = (path: string, body?: unknown, token = "", origin = "http://localhost") => new NextRequest(`http://localhost/api/admin/ia/${path}`, { method: body === undefined ? "GET" : "POST", headers: { host: "localhost", origin, cookie: `adm=${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
    assert.equal((await settings.GET(req("configuracao"))).status, 401);
    const reader = await c.U.criarUsuario({ email: "qa-ai-reader@example.test", nome: "QA", nivel: "leitura", senha: "QA-Context-Access-2026-Ficticia" }); assert.ok(reader.ok); const readerToken = (await c.U.abrirSessao(reader.usuario.id, "127.0.0.1")).token;
    assert.equal((await settings.GET(req("configuracao", undefined, readerToken))).status, 403);
    const prepared = { modo: "preparar", input: { uso: "painel", consulta: "Amazonia" } };
    assert.equal((await context.POST(req("contexto", prepared, readerToken, "https://other.example.test"))).status, 403);
    const r = await context.POST(req("contexto", prepared, readerToken)); assert.equal(r.status, 200); const p = await r.json(); assert.equal(p.executionAvailable, false); assert.ok(!("input" in p)); assert.ok(!("instructions" in p)); assert.ok((await context.POST(req("contexto", { modo: "conferir", input: prepared.input, proof: p.proof }, readerToken))).ok);
    assert.equal((await context.POST(req("contexto", { modo: "preparar", input: { uso: "atendimento", consulta: "Amazonia", contato: c.contact } }, readerToken))).status, 403);
    assert.equal((await context.POST(req("contexto", "x".repeat(4097), readerToken))).status, 413);
    const token = (await c.U.abrirSessao(c.actor.userId, "127.0.0.1")).token, change = { config: c.enabled(), expectedRevision: 0 };
    assert.equal((await settings.POST(req("configuracao", change, token))).status, 403);
    await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=$1", [c.actor.userId]);
    assert.equal((await settings.POST(req("configuracao", change, token))).status, 200); assert.equal((await settings.POST(req("configuracao", change, token))).status, 409);
    assert.equal((await settings.POST(req("configuracao", { ...change, apiKey: "NEVER" }, token))).status, 400);
  } finally {
    if (old.preview === undefined) delete process.env.PREVIEW_MODE; else process.env.PREVIEW_MODE = old.preview;
    if (old.noPassword === undefined) delete process.env.ADMIN_NO_PASSWORD; else process.env.ADMIN_NO_PASSWORD = old.noPassword;
    await c.db._closeDbForTests();
  }
});
