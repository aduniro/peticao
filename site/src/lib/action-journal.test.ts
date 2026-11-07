import test from "node:test";
import assert from "node:assert/strict";
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
delete process.env.MAIL_PROVIDERS;
const ACTOR = { userId: 1, email: "journal-owner@example.test" };
const WINDOW = { ini: "2026-11-04T07:00:00.000Z", fim: "2026-11-04T15:00:00.000Z" };
async function setup() { const db = await import("./db"); await db._openForTests("t_action_journal"); return { db, A: await import("./acoes") }; }
const rows = async (c: Awaited<ReturnType<typeof setup>>) => (await c.db.query("SELECT * FROM admin_acoes ORDER BY id")).rows;
async function failAudit(c: Awaited<ReturnType<typeof setup>>, event: string) {
  await c.db.query(`CREATE FUNCTION fail_action_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='${event}' THEN RAISE EXCEPTION 'journal audit fixture'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_action_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_action_audit();`);
}
async function until(fn: () => Promise<boolean>) { for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 20)); } assert.fail("journal did not settle"); }

test("ação não começa se reserva ou auditoria inicial falhar", async () => {
  const c = await setup(); const action = c.A.ACOES.find(a => a.id === "reenvio.iniciar")!, original = action.executar; let effects = 0;
  action.executar = async (p, ctx) => { effects++; return original(p, ctx); };
  try {
    await failAudit(c, "admin_acao_pedida");
    assert.equal((await c.A.rodarAcao(action.id, "executar", WINDOW, "REENVIAR", ACTOR)).ok, false);
    assert.equal(effects, 0); assert.equal((await rows(c)).length, 0);
    assert.equal((await c.db.query("SELECT 1 FROM settings WHERE key LIKE 'reenvio_%'")).rowCount, 0);
  } finally { action.executar = original; await c.db._closeDbForTests(); }
});

test("efeito no banco e resultado são atômicos; reserva interrompida não vira sucesso", async () => {
  const c = await setup(); const action = c.A.ACOES.find(a => a.id === "reenvio.iniciar")!, original = action.executar;
  action.executar = async (p, ctx) => {
    const pending = (await rows(c))[0]; assert.equal(pending.central_estado, "solicitado"); assert.equal(pending.ok, false); assert.equal(pending.email, ACTOR.email);
    assert.ok(ctx.client); return original(p, ctx);
  };
  try {
    await failAudit(c, "admin_acao_executada");
    assert.equal((await c.A.rodarAcao(action.id, "executar", WINDOW, "REENVIAR", ACTOR)).ok, false);
    assert.equal((await c.db.query("SELECT 1 FROM settings WHERE key LIKE 'reenvio_%'")).rowCount, 0);
    assert.equal((await rows(c))[0].central_estado, "solicitado"); assert.equal((await rows(c))[0].ok, false);
    action.executar = original;
    await c.db.query("DROP TRIGGER fail_action_audit ON audit_log");
    assert.ok((await c.A.rodarAcao(action.id, "executar", WINDOW, "REENVIAR", ACTOR)).ok);
    assert.deepEqual((await rows(c)).map(row => [row.central_estado, row.ok]), [["falhou", false], ["concluido", true]]);
    assert.equal((await c.db.query("SELECT value FROM settings WHERE key='reenvio_inicio'")).rows[0].value, WINDOW.ini);
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { action.executar = original; await c.db._closeDbForTests(); }
});

test("efeito externo incerto conserva histórico e bloqueia repetição, mantendo consultas disponíveis", async () => {
  const c = await setup(); const action = c.A.ACOES.find(a => a.id === "publicar.pedir")!, original = action.executar; let effects = 0;
  action.executar = async () => { effects++; throw new Error("possible external acceptance"); };
  try {
    const result = await c.A.rodarAcao(action.id, "executar", {}, "PUBLICAR", ACTOR);
    assert.ok(!result.ok && result.erro === "indeterminado");
    const id = (await rows(c))[0].id;
    await c.db.query("UPDATE admin_acoes SET ts=now()-interval '1 day' WHERE id=$1", [id]);
    assert.deepEqual(await c.A.rodarAcao(action.id, "executar", {}, "PUBLICAR", ACTOR), { ok: false, erro: "indeterminado" });
    assert.equal(effects, 1); assert.equal((await rows(c)).length, 1); assert.equal((await rows(c))[0].id, id);
    assert.ok((await c.A.rodarAcao("publicar.status", "executar", {}, "", ACTOR)).ok);
    assert.ok((await c.A.rodarAcao("terminal.desligar", "executar", {}, "DESLIGAR", ACTOR)).ok);
    assert.equal((await rows(c))[0].central_estado, "indeterminado");
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { action.executar = original; await c.db._closeDbForTests(); }
});

test("aceite externo não significa conclusão; falha de persistência nunca inventa sucesso", async () => {
  const c = await setup(); const action = c.A.ACOES.find(a => a.id === "publicar.pedir")!, original = action.executar; let effects = 0;
  action.executar = async () => { effects++; return { pedido: "fixture-no-deploy" }; };
  try {
    assert.ok((await c.A.rodarAcao(action.id, "executar", {}, "PUBLICAR", ACTOR)).ok);
    assert.equal((await rows(c))[0].central_estado, "aceito");
    await failAudit(c, "admin_acao_executada");
    const failed = await c.A.rodarAcao(action.id, "executar", {}, "PUBLICAR", ACTOR);
    assert.ok(!failed.ok && failed.erro === "indeterminado");
    assert.deepEqual((await rows(c)).map(row => row.ok), [true, false]);
    await c.db.query("DROP TRIGGER fail_action_audit ON audit_log");
    assert.deepEqual(await c.A.rodarAcao(action.id, "executar", {}, "PUBLICAR", ACTOR), { ok: false, erro: "indeterminado" });
    assert.equal(effects, 2); assert.equal((await rows(c))[1].central_estado, "indeterminado");
  } finally { action.executar = original; await c.db._closeDbForTests(); }
});

test("ações opostas compartilham trava; nenhuma segunda reserva aparece durante execução", async () => {
  const c = await setup(); const action = c.A.ACOES.find(a => a.id === "reenvio.iniciar")!, original = action.executar;
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  action.executar = async (p, ctx) => { await gate; return original(p, ctx); };
  let first: Promise<unknown> | undefined;
  try {
    first = c.A.rodarAcao(action.id, "executar", WINDOW, "REENVIAR", ACTOR);
    await until(async () => (await rows(c)).length === 1);
    assert.deepEqual(await c.A.rodarAcao("reenvio.parar", "executar", {}, "PARAR", ACTOR), { ok: false, erro: "ocupado" });
    assert.equal((await rows(c)).length, 1);
    release(); assert.ok((await first as any).ok);
  } finally { release(); await first; action.executar = original; await c.db._closeDbForTests(); }
});

test("leituras são auditadas atomicamente e modo inválido nunca chama execução", async () => {
  const c = await setup();
  try {
    for (const mode of [undefined, "simlua", "", "execute"]) assert.deepEqual(await c.A.rodarAcao("reenvio.parar", mode, {}, "PARAR", ACTOR), { ok: false, erro: "parametros" });
    assert.equal((await rows(c)).length, 0);
    await failAudit(c, "admin_acao_executada");
    assert.deepEqual(await c.A.rodarAcao("estado.ver", "executar", {}, "", ACTOR), { ok: false, erro: "falhou" });
    assert.equal((await rows(c)).length, 0);
  } finally { await c.db._closeDbForTests(); }
});

test("recusa externa conhecida fica como falha e permite um novo pedido explícito", async () => {
  const c = await setup(); const action = c.A.ACOES.find(a => a.id === "publicar.pedir")!, original = action.executar;
  const { ActionNotApplied } = await import("./acoes/tipos");
  try {
    action.executar = async () => { throw new ActionNotApplied("fixture refused before effect"); };
    const refused = await c.A.rodarAcao(action.id, "executar", {}, "PUBLICAR", ACTOR);
    assert.ok(!refused.ok && refused.erro === "falhou");
    assert.equal((await rows(c))[0].central_estado, "falhou");
    action.executar = async () => ({ pedido: "fixture-only-no-deploy" });
    assert.ok((await c.A.rodarAcao(action.id, "executar", {}, "PUBLICAR", ACTOR)).ok);
    assert.deepEqual((await rows(c)).map(row => row.central_estado), ["falhou", "aceito"]);
  } finally { action.executar = original; await c.db._closeDbForTests(); }
});

test("perda da confirmação do COMMIT usa o resultado durável sem rebaixar sucesso", async () => {
  const c = await setup();
  const pool = c.db.getPool(), connect = pool.connect.bind(pool); let first = true;
  (pool as any).connect = (...args: any[]) => {
    if (args.length) return (connect as any)(...args);
    return connect().then(client => {
      if (first) {
        first = false;
        const query = client.query.bind(client);
        (client as any).query = (...params: any[]) => {
          const operation = (query as any)(...params);
          if (params[0] === "COMMIT") return Promise.resolve(operation).then(() => { (client as any).query = query; throw new Error("fixture lost commit acknowledgement"); });
          return operation;
        };
      }
      return client;
    });
  };
  try {
    const response = await c.A.rodarAcao("reenvio.parar", "executar", {}, "PARAR", ACTOR);
    assert.ok(response.ok);
    const recorded = await rows(c); assert.equal(recorded.length, 1); assert.equal(recorded[0].central_estado, "concluido"); assert.equal(recorded[0].ok, true);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM audit_log WHERE event='admin_acao_executada'")).rows[0].n, 1);
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { (pool as any).connect = connect; await c.db._closeDbForTests(); }
});


test("aviso pós-commit pendente não impede desligar o Terminal", async () => {
  const c = await setup(); const action = c.A.ACOES.find(a => a.id === "terminal.ligar")!, after = action.aposCommit;
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), began = new Promise<void>(resolve => { started = resolve; });
  action.aposCommit = async () => { started(); await gate; return { dono_avisado_por_email: true }; };
  let first: Promise<unknown> | undefined;
  try {
    first = c.A.rodarAcao(action.id, "executar", { minutos: 5 }, "TERMINAL", ACTOR);
    await began;
    assert.equal((await rows(c))[0].central_estado, "concluido");
    assert.ok((await c.A.rodarAcao("terminal.desligar", "executar", {}, "DESLIGAR", ACTOR)).ok);
    assert.equal((await c.db.query("SELECT value FROM settings WHERE key='terminal_ate'")).rows[0].value, "");
    release(); assert.ok((await first as any).ok);
    assert.equal((await rows(c))[0].resultado.dono_avisado_por_email, true);
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { release(); await first; action.aposCommit = after; await c.db._closeDbForTests(); }
});

test("falha no resultado final reverte ativação e não dispara aviso do Terminal", async () => {
  const c = await setup(); const action = c.A.ACOES.find(a => a.id === "terminal.ligar")!, after = action.aposCommit; let notices = 0;
  action.aposCommit = async () => { notices++; return { dono_avisado_por_email: true }; };
  try {
    await failAudit(c, "admin_acao_executada");
    assert.equal((await c.A.rodarAcao(action.id, "executar", { minutos: 5 }, "TERMINAL", ACTOR)).ok, false);
    assert.equal(notices, 0);
    assert.equal((await c.db.query("SELECT 1 FROM settings WHERE key='terminal_ate'")).rowCount, 0);
    assert.equal((await rows(c))[0].ok, false);
  } finally { action.aposCommit = after; await c.db._closeDbForTests(); }
});

test("API exige sessão e confirmação extra; resultado incerto usa 502 e o autor da sessão", async () => {
  const c = await setup();
  delete process.env.PREVIEW_MODE; delete process.env.ADMIN_NO_PASSWORD;
  const U = await import("./admin-users"), { NextRequest } = await import("next/server"), { POST } = await import("../app/api/admin/acoes/route");
  const action = c.A.ACOES.find(a => a.id === "publicar.pedir")!, original = action.executar; let effects = 0;
  action.executar = async () => { effects++; throw new Error("fixture possible acceptance"); };
  try {
    const created = await U.criarUsuario({ email: "action-api-owner@example.test", nome: "QA Dona", nivel: "total", senha: "Uma-Senha-Forte-2026" }); assert.ok(created.ok);
    const session = await U.abrirSessao(created.usuario.id, "127.0.0.1");
    const req = (authenticated: boolean, modo = "executar") => new NextRequest("http://localhost/api/admin/acoes", { method: "POST", headers: { host: "localhost", origin: "http://localhost", cookie: authenticated ? `adm=${session.token}` : "", "content-type": "application/json" }, body: JSON.stringify({ acao: action.id, modo, parametros: {}, confirmacao: "PUBLICAR", email: "forged@example.test" }) });
    assert.equal((await POST(req(false))).status, 401);
    assert.equal((await POST(req(true))).status, 403);
    assert.equal(effects, 0); assert.equal((await rows(c)).length, 0);
    await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE user_id=$1", [created.usuario.id]);
    assert.equal((await POST(req(true, "invalid"))).status, 400);
    const response = await POST(req(true)); assert.equal(response.status, 502); assert.equal((await response.json()).erro, "indeterminado");
    assert.equal(effects, 1); assert.equal((await rows(c))[0].email, created.usuario.email);
  } finally { action.executar = original; await c.db._closeDbForTests(); }
});

test("identificador do sinal de publicação já está gravado antes do efeito externo", async () => {
  const c = await setup();
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os"), { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "peticao-action-admission-")), state = join(directory, "state"), signal = join(directory, "request");
  const previous = { mode: process.env.PREVIEW_MODE, state: process.env.PUBLICAR_ESTADO_DIR, signal: process.env.PUBLICAR_PEDIDO };
  try {
    mkdirSync(state); writeFileSync(join(state, "candidato.json"), JSON.stringify({ format: 1, sha256: "a".repeat(64), commit: null, prepared_at: new Date().toISOString(), files: [{ path: "fixture.ts" }] }));
    process.env.PREVIEW_MODE = "0"; process.env.PUBLICAR_ESTADO_DIR = state; process.env.PUBLICAR_PEDIDO = signal;
    const result = await c.A.rodarAcao("publicar.pedir", "executar", { candidato: "a".repeat(64) }, "PUBLICAR", ACTOR);
    assert.ok(result.ok);
    const request = JSON.parse(readFileSync(signal, "utf8")), record = (await rows(c))[0];
    assert.match(record.central_request_id, /^[a-f0-9]{16}$/);
    assert.equal(request.id, record.central_request_id);
    assert.equal(request.candidato, "a".repeat(64)); assert.equal(record.central_estado, "aceito");
    assert.equal((result as any).resultado.pedido, record.central_request_id);
    assert.equal(JSON.parse((await c.db.query("SELECT data FROM audit_log WHERE event='admin_acao_pedida'")).rows[0].data).pedido, request.id);
  } finally {
    for (const [name, value] of [["PREVIEW_MODE", previous.mode], ["PUBLICAR_ESTADO_DIR", previous.state], ["PUBLICAR_PEDIDO", previous.signal]]) { if (value === undefined) delete process.env[name!]; else process.env[name!] = value; }
    rmSync(directory, { recursive: true, force: true }); await c.db._closeDbForTests();
  }
});
