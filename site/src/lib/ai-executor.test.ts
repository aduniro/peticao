import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
(process.env as Record<string,string>).NODE_ENV = "test"; process.env.MAIL_PROVIDER = "dev"; process.env.AI_EXECUTION_ENABLED = "0";
const FAKE_KEY = "QA-CREDENTIAL-NOT-A-REAL-KEY";
async function setup() {
  const db = await import("./db"); await db._openForTests("t_ai_executor");
  const C = await import("./ai/configuration"), A = await import("./ai/context"), E = await import("./ai/executor"), U = await import("./admin-users");
  const create = async (suffix: string, nivel: "total" | "edicao" | "leitura" = "edicao") => {
    const r = await U.criarUsuario({ email: `qa-generation-${suffix}@example.test`, nome: "QA IA", nivel, senha: "QA-Execution-2026-Ficticia" }); assert.ok(r.ok);
    return { userId: r.usuario.id, email: r.usuario.email };
  };
  const total = await create("owner", "total"), actor = await create("operator");
  const config = C.defaultConfiguration(); config.enabled = true; for (const p of Object.values(config.profiles)) p.model = "qa-model-not-real";
  assert.ok((await C.saveAiConfiguration(config, 0, total)).ok);
  const input = { uso: "painel", consulta: "Amazonia" }, prepared = await A.prepareAiContext(input); assert.ok(prepared.ok);
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses"); assert.equal(init?.redirect, "error"); assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${FAKE_KEY}`);
    const request = JSON.parse(String(init?.body)); assert.equal(request.store, false); assert.deepEqual(request.tools, []); assert.equal(request.tool_choice, "none");
    const frame = JSON.parse(request.input);
    return Response.json({ id: "resp_QARuntimeOnly", status: "completed", output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({ text: "QA_GENERATED_NEVER_PERSIST", needsReview: true, citations: frame.sources.slice(0, 1).map((s: any) => ({ id: s.id, version: s.version })) }) }] }], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
  };
  return { db, C, A, E, U, create, total, actor, config, input, prepared, fetcher, deps: { armed: true, credential: () => FAKE_KEY, fetch: fetcher } };
}
const privateSnapshot = async (db: Awaited<ReturnType<typeof setup>>["db"]) => (await db.query("SELECT row_to_json(s)::text data FROM signatures s UNION ALL SELECT row_to_json(r)::text FROM contact_replies r UNION ALL SELECT row_to_json(m)::text FROM mail_outbox m")).rows;

test("portas de serviço/credencial e conta impedem reserva ou chamada prematura", async () => {
  const c = await setup(); try {
    const id = randomUUID(); let calls = 0;
    const unavailable = await c.E.generateAiDraft(c.input, c.prepared.proof, id, c.actor, { armed: false, credential: () => { calls++; return FAKE_KEY; }, fetch: c.fetcher }); assert.ok(!unavailable.ok); assert.equal(unavailable.error, "disabled"); assert.equal(calls, 0);
    const missing = await c.E.generateAiDraft(c.input, c.prepared.proof, id, c.actor, { ...c.deps, credential: () => null }); assert.ok(!missing.ok); assert.equal(missing.error, "credential_unavailable");
    await c.db.query("UPDATE admin_users SET ativo=false WHERE id=$1", [c.actor.userId]); assert.ok(!(await c.E.generateAiDraft(c.input, c.prepared.proof, id, c.actor, c.deps)).ok);
    assert.equal((await c.db.query("SELECT 1 FROM admin_ai_requests")).rowCount, 0);
  } finally { await c.db._closeDbForTests(); }
});

test("uma geração devolve só minuta revisável e uso, sem persistir prompt/texto/chave ou alterar assinaturas", async () => {
  const c = await setup(); try {
    const before = await privateSnapshot(c.db), requestId = randomUUID(), result = await c.E.generateAiDraft(c.input, c.prepared.proof, requestId, c.actor, c.deps);
    assert.ok(result.ok); assert.equal(result.persisted, false); assert.equal(result.sent, false); assert.equal(result.draft.requiresHumanReview, true); assert.equal(result.usage.outputTokens, 20);
    const status = await c.E.aiRequestStatus(requestId, c.actor); assert.ok(status.ok); assert.equal(status.request.state, "completed"); assert.equal(status.draftAvailable, false);
    const records = JSON.stringify((await c.db.query("SELECT row_to_json(r) data FROM admin_ai_requests r UNION ALL SELECT row_to_json(a) FROM audit_log a")).rows);
    for (const forbidden of ["QA_GENERATED_NEVER_PERSIST", FAKE_KEY, '"query"', '"instructions"']) assert.ok(!records.includes(forbidden));
    const other = await c.create("other"); assert.ok(!(await c.E.aiRequestStatus(requestId, other)).ok); assert.ok(!(await c.E.aiRequestStatus(requestId, c.total)).ok);
    assert.deepEqual(await privateSnapshot(c.db), before); assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("UUID repetido durante/depois da tentativa não dispara outra chamada, nem recupera texto não arquivado", async () => {
  const c = await setup(); let release!: () => void; try {
    let started!: () => void, calls = 0; const began = new Promise<void>(r => { started = r; }), held = new Promise<void>(r => { release = r; });
    const fetcher: typeof fetch = async (u, i) => { calls++; started(); await held; return c.fetcher(u, i); };
    const id = randomUUID(), first = c.E.generateAiDraft(c.input, c.prepared.proof, id, c.actor, { ...c.deps, fetch: fetcher }); await began;
    const duplicate = await c.E.generateAiDraft(c.input, c.prepared.proof, id, c.actor, c.deps); assert.ok(!duplicate.ok); assert.equal(duplicate.error, "already_attempted"); release(); assert.ok((await first).ok);
    const again = await c.E.generateAiDraft(c.input, c.prepared.proof, id, c.actor, { ...c.deps, fetch: fetcher }); assert.ok(!again.ok); assert.equal(again.error, "already_attempted"); assert.equal(calls, 1); assert.equal((await c.db.query("SELECT 1 FROM admin_ai_requests")).rowCount, 1);
  } finally { release?.(); await c.db._closeDbForTests(); }
});

test("quota compartilhada serializa concorrência e reserva o teto de saída, não só os tokens observados", async () => {
  const c = await setup(); try {
    c.config.limits.dailyCalls = 2; c.config.limits.dailyOutputTokens = 2048; await c.C.saveAiConfiguration(c.config, 1, c.total);
    const prepared = await c.A.prepareAiContext(c.input); assert.ok(prepared.ok); let calls = 0;
    const fetcher: typeof fetch = async (u, i) => { calls++; return c.fetcher(u, i); };
    const results = await Promise.all(Array.from({ length: 4 }, () => c.E.generateAiDraft(c.input, prepared.proof, randomUUID(), c.actor, { ...c.deps, fetch: fetcher })));
    assert.equal(results.filter(r => r.ok).length, 2); assert.equal(calls, 2); assert.equal((await c.db.query("SELECT sum(reserved_output_tokens)::int n FROM admin_ai_requests")).rows[0].n, 2048);
    const other = await c.create("quota-other"), input = { uso: "divulgacao", consulta: "Amazonia" }, context = await c.A.prepareAiContext(input); assert.ok(context.ok);
    const blocked = await c.E.generateAiDraft(input, context.proof, randomUUID(), other, c.deps); assert.ok(!blocked.ok); assert.equal(blocked.error, "budget_exhausted");
  } finally { await c.db._closeDbForTests(); }
});

test("erro de transporte conserva reserva e não é reenviado, nem após outra revisão da configuração", async () => {
  const c = await setup(); try {
    c.config.limits.dailyCalls = 1; c.config.limits.dailyOutputTokens = 1024; await c.C.saveAiConfiguration(c.config, 1, c.total);
    const p = await c.A.prepareAiContext(c.input); assert.ok(p.ok); let calls = 0; const fetcher: typeof fetch = async () => { calls++; throw new Error(`NEVER_LOG_${FAKE_KEY}`); };
    const id = randomUUID(), result = await c.E.generateAiDraft(c.input, p.proof, id, c.actor, { ...c.deps, fetch: fetcher }); assert.ok(!result.ok); assert.equal(result.error, "result_uncertain");
    assert.equal((await c.db.query("SELECT state FROM admin_ai_requests")).rows[0].state, "uncertain");
    assert.ok(!(await c.E.generateAiDraft(c.input, p.proof, id, c.actor, { ...c.deps, fetch: fetcher })).ok); assert.equal(calls, 1);
    await c.C.saveAiConfiguration(c.config, 2, c.total); const newer = await c.A.prepareAiContext(c.input); assert.ok(newer.ok);
    const exhausted = await c.E.generateAiDraft(c.input, newer.proof, randomUUID(), c.actor, c.deps); assert.ok(!exhausted.ok); assert.equal(exhausted.error, "budget_exhausted");
    assert.ok(!JSON.stringify((await c.db.query("SELECT * FROM admin_ai_requests")).rows).includes(FAKE_KEY));
  } finally { await c.db._closeDbForTests(); }
});

test("contexto alterado durante geração descarta texto, registra uso e conserva a quota consumida", async () => {
  const c = await setup(); try {
    const fetcher: typeof fetch = async (u, i) => { await c.C.saveAiConfiguration(c.C.defaultConfiguration(), 1, c.total); return c.fetcher(u, i); };
    const result = await c.E.generateAiDraft(c.input, c.prepared.proof, randomUUID(), c.actor, { ...c.deps, fetch: fetcher }); assert.ok(!result.ok); assert.equal(result.error, "context_changed"); assert.ok(!("draft" in result));
    const row = (await c.db.query("SELECT state,input_tokens,output_tokens,reserved_output_tokens FROM admin_ai_requests")).rows[0]; assert.deepEqual(row, { state: "discarded", input_tokens: 100, output_tokens: 20, reserved_output_tokens: 1024 });
  } finally { await c.db._closeDbForTests(); }
});

test("revogação durante a chamada registra consumo, mas não libera a minuta à conta revogada", async () => {
  const c = await setup(); try {
    const fetcher: typeof fetch = async (u, i) => { await c.db.query("UPDATE admin_users SET ativo=false WHERE id=$1", [c.actor.userId]); return c.fetcher(u, i); };
    const result = await c.E.generateAiDraft(c.input, c.prepared.proof, randomUUID(), c.actor, { ...c.deps, fetch: fetcher }); assert.ok(!result.ok); assert.equal(result.error, "forbidden"); assert.ok(!("draft" in result));
    assert.deepEqual((await c.db.query("SELECT state,error_code,output_tokens FROM admin_ai_requests")).rows[0], { state: "discarded", error_code: "actor_changed", output_tokens: 20 });
  } finally { await c.db._closeDbForTests(); }
});

test("falha de auditoria antes da tentativa impede chamada; depois dela deixa resultado incerto sem repetição", async () => {
  const c = await setup(); try {
    let calls = 0; const fetcher: typeof fetch = async (u, i) => { calls++; return c.fetcher(u, i); };
    await c.db.query("CREATE FUNCTION fail_generation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='admin_ai_request_reserved' THEN RAISE EXCEPTION 'QA'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_generation_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_generation_audit()");
    await assert.rejects(c.E.generateAiDraft(c.input, c.prepared.proof, randomUUID(), c.actor, { ...c.deps, fetch: fetcher })); assert.equal(calls, 0); assert.equal((await c.db.query("SELECT 1 FROM admin_ai_requests")).rowCount, 0);
    await c.db.query("DROP TRIGGER fail_generation_audit ON audit_log; CREATE OR REPLACE FUNCTION fail_generation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='admin_ai_request_finished' THEN RAISE EXCEPTION 'QA'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_generation_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_generation_audit()");
    const id = randomUUID(), uncertain = await c.E.generateAiDraft(c.input, c.prepared.proof, id, c.actor, { ...c.deps, fetch: fetcher }); assert.ok(!uncertain.ok); assert.equal(uncertain.error, "result_uncertain"); assert.equal((await c.db.query("SELECT state FROM admin_ai_requests")).rows[0].state, "reserved");
    assert.ok(!(await c.E.generateAiDraft(c.input, c.prepared.proof, id, c.actor, { ...c.deps, fetch: fetcher })).ok); assert.equal(calls, 1);
  } finally { await c.db._closeDbForTests(); }
});

test("recusa, 5xx, corpo excessivo e resposta inválida não são repetidos ou convertidos em minuta", async () => {
  for (const [name, response, expected] of [
    ["rejected", () => new Response(FAKE_KEY, { status: 401 }), "rejected"],
    ["uncertain", () => new Response(FAKE_KEY, { status: 502 }), "uncertain"],
    ["oversize", () => new Response("x".repeat(128001)), "uncertain"],
    ["json", () => new Response("not JSON"), "discarded"],
    ["partial", () => Response.json({ status: "incomplete", output: [] }), "discarded"],
  ] as const) {
    const c = await setup(); try {
      let calls = 0; const fetcher: typeof fetch = async () => { calls++; return response(); }, id = randomUUID();
      const result = await c.E.generateAiDraft(c.input, c.prepared.proof, id, c.actor, { ...c.deps, fetch: fetcher }); assert.ok(!result.ok, name); assert.equal((await c.db.query("SELECT state FROM admin_ai_requests")).rows[0].state, expected);
      assert.ok(!(await c.E.generateAiDraft(c.input, c.prepared.proof, id, c.actor, { ...c.deps, fetch: fetcher })).ok); assert.equal(calls, 1);
    } finally { await c.db._closeDbForTests(); }
  }
});

test("disponibilidade local requer configuração, armamento e credencial própria; não comprova acesso ao provedor", async () => {
  const c = await setup(); try {
    assert.equal((await c.C.aiConfiguration()).ok, true); process.env.AI_EXECUTION_ENABLED = "1"; process.env.OPENAI_API_KEY = FAKE_KEY;
    const ready = await c.C.aiConfiguration(); assert.ok(ready.ok); assert.equal(ready.executionAvailable, true);
    process.env.AI_EXECUTION_ENABLED = "0"; const off = await c.C.aiConfiguration(); assert.ok(off.ok); assert.equal(off.executionAvailable, false);
  } finally { process.env.AI_EXECUTION_ENABLED = "0"; delete process.env.OPENAI_API_KEY; await c.db._closeDbForTests(); }
});

test("uso operacional Total distingue reserva, consumo observado e resultado desconhecido, sem dados da consulta", async () => {
  const c = await setup(); try {
    const before = await privateSnapshot(c.db);
    assert.ok((await c.E.generateAiDraft(c.input, c.prepared.proof, randomUUID(), c.actor, c.deps)).ok);
    await c.E.generateAiDraft(c.input, c.prepared.proof, randomUUID(), c.actor, { ...c.deps, fetch: async () => { throw new Error("NEVER_RAW_ERROR"); } });
    assert.ok(!(await c.E.aiDailyUsage(undefined, c.actor)).ok);
    const usage = await c.E.aiDailyUsage(undefined, c.total); assert.ok(usage.ok); assert.equal(usage.totals.calls, 2); assert.equal(usage.totals.reserved_output_tokens, 2048); assert.equal(usage.totals.observed_output_tokens, 20); assert.equal(usage.totals.unknown_usage_calls, 1); assert.equal(usage.records.length, 2); assert.equal(usage.currencyEstimate, false);
    assert.ok(!(await c.E.aiDailyUsage("2026-02-31", c.total)).ok);
    for (const hidden of [FAKE_KEY, "QA_GENERATED_NEVER_PERSIST", "context_hash", "source_versions", "NEVER_RAW_ERROR"]) assert.ok(!JSON.stringify(usage).includes(hidden));
    assert.deepEqual(await privateSnapshot(c.db), before);
  } finally { await c.db._closeDbForTests(); }
});

test("API exige Edição, aceita somente intenção/UUID e não permite armar serviço pelo corpo", async () => {
  const c = await setup(), old = { preview: process.env.PREVIEW_MODE, noPassword: process.env.ADMIN_NO_PASSWORD }; delete process.env.PREVIEW_MODE; delete process.env.ADMIN_NO_PASSWORD;
  try {
    const { NextRequest } = await import("next/server"), route = await import("../app/api/admin/ia/gerar/route");
    const body = { input: c.input, proof: c.prepared.proof, requestId: randomUUID() };
    const req = (data: unknown = body, token = "", origin = "http://localhost") => new NextRequest("http://localhost/api/admin/ia/gerar", { method: "POST", headers: { host: "localhost", origin, cookie: `adm=${token}`, "content-type": "application/json" }, body: typeof data === "string" ? data : JSON.stringify(data) });
    assert.equal((await route.POST(req())).status, 401); const reader = await c.create("reader", "leitura"), readerToken = (await c.U.abrirSessao(reader.userId, "127.0.0.1")).token; assert.equal((await route.POST(req(body, readerToken))).status, 403);
    const token = (await c.U.abrirSessao(c.actor.userId, "127.0.0.1")).token;
    assert.equal((await route.POST(req(body, token, "https://other.example.test"))).status, 403);
    assert.equal((await route.POST(req({ ...body, armed: true }, token))).status, 400); assert.equal((await route.POST(req("x".repeat(4097), token))).status, 413);
    const result = await route.POST(req(body, token)); assert.equal(result.status, 409); assert.equal((await result.json()).error, "disabled"); assert.equal((await c.db.query("SELECT 1 FROM admin_ai_requests")).rowCount, 0);
    assert.equal((await route.GET(new NextRequest(`http://localhost/api/admin/ia/gerar?requestId=${body.requestId}`, { headers: { cookie: `adm=${token}` } }))).status, 404);
  } finally {
    if (old.preview === undefined) delete process.env.PREVIEW_MODE; else process.env.PREVIEW_MODE = old.preview;
    if (old.noPassword === undefined) delete process.env.ADMIN_NO_PASSWORD; else process.env.ADMIN_NO_PASSWORD = old.noPassword;
    await c.db._closeDbForTests();
  }
});
