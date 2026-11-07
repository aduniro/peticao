import test from "node:test";
import assert from "node:assert/strict";
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
const OWNER = { userId: 1, email: "intent-owner@example.test" };
const WINDOW = { ini: "2026-11-04T07:00:00.000Z", fim: "2026-11-04T15:00:00.000Z" };
async function setup() { const db = await import("./db"); await db._openForTests("t_action_intent"); return { db, A: await import("./acoes") }; }
async function simulate(c: Awaited<ReturnType<typeof setup>>, id: string, params: unknown = {}) {
  const result = await c.A.rodarAcao(id, "simular", params, "", OWNER); assert.ok(result.ok && result.modo === "simular" && result.simulacao); return result.simulacao;
}
const execute = (c: Awaited<ReturnType<typeof setup>>, id: string, params: unknown, word: string, ticket: unknown, actor = OWNER) => c.A.rodarAcao(id, "executar", params, word, actor, { requireIntent: true, simulacao: ticket });

test("ticket repete o resultado e nunca o efeito, mesmo depois de expirar a simulação", async () => {
  const c = await setup(), action = c.A.ACOES.find(a => a.id === "reenvio.parar")!, original = action.executar; let effects = 0;
  action.executar = async (p, ctx) => { effects++; return original(p, ctx); };
  try {
    const ticket = await simulate(c, action.id);
    assert.match(ticket.token, /^[a-f0-9]{48}$/);
    const stored = (await c.db.query("SELECT central_simulacao_hash FROM admin_acoes WHERE id=$1", [ticket.id])).rows[0]; assert.notEqual(stored.central_simulacao_hash, ticket.token);
    const first = await execute(c, action.id, {}, "PARAR", ticket); assert.ok(first.ok);
    await c.db.query("UPDATE admin_acoes SET ts=now()-interval '1 day' WHERE id=$1", [ticket.id]);
    assert.deepEqual(await execute(c, action.id, {}, "PARAR", ticket), first);
    assert.deepEqual(await c.A.rodarAcao(action.id, "consultar", {}, "", OWNER, { simulacao: ticket }), first);
    assert.equal(effects, 1);
    const executions = (await c.db.query("SELECT * FROM admin_acoes WHERE modo='executar'")).rows;
    assert.equal(executions.length, 1); assert.equal(executions[0].central_simulacao_id, ticket.id);
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { action.executar = original; await c.db._closeDbForTests(); }
});

test("ação, ator, token e parâmetros devem coincidir; simulação expirada não admite execução", async () => {
  const c = await setup(), action = c.A.ACOES.find(a => a.id === "reenvio.iniciar")!, original = action.executar; let effects = 0;
  action.executar = async () => { effects++; return {}; };
  try {
    const ticket = await simulate(c, action.id, WINDOW);
    for (const result of [
      await execute(c, action.id, WINDOW, "REENVIAR", undefined),
      await execute(c, action.id, WINDOW, "REENVIAR", { ...ticket, token: "0".repeat(48) }),
      await execute(c, action.id, { ...WINDOW, ini: "2026-11-04T08:00:00Z" }, "REENVIAR", ticket),
      await execute(c, action.id, WINDOW, "REENVIAR", ticket, { userId: 2, email: "other@example.test" }),
      await execute(c, "reenvio.parar", {}, "PARAR", ticket),
    ]) assert.ok(!result.ok && result.erro === "parametros");
    await c.db.query("UPDATE admin_acoes SET ts=now()-interval '16 minutes' WHERE id=$1", [ticket.id]);
    const expired = await execute(c, action.id, WINDOW, "REENVIAR", ticket); assert.ok(!expired.ok && expired.erro === "parametros" && expired.encerrada);
    assert.equal(effects, 0); assert.equal((await c.db.query("SELECT 1 FROM admin_acoes WHERE modo='executar'")).rowCount, 0);
  } finally { action.executar = original; await c.db._closeDbForTests(); }
});

test("chamadas simultâneas para a mesma intenção têm uma admissão; intenção nova é explícita", async () => {
  const c = await setup(), action = c.A.ACOES.find(a => a.id === "reenvio.parar")!, original = action.executar; let effects = 0;
  action.executar = async (p, ctx) => { effects++; return original(p, ctx); };
  try {
    const ticket = await simulate(c, action.id);
    const requests = await Promise.all(Array.from({ length: 8 }, () => execute(c, action.id, {}, "PARAR", ticket)));
    assert.ok(requests.some(result => result.ok));
    assert.ok(requests.every(result => result.ok || result.erro === "ocupado" || result.erro === "indeterminado"));
    assert.ok((await execute(c, action.id, {}, "PARAR", ticket)).ok);
    assert.equal(effects, 1); assert.equal((await c.db.query("SELECT 1 FROM admin_acoes WHERE modo='executar'")).rowCount, 1);
    const next = await simulate(c, action.id); assert.notEqual(next.id, ticket.id);
    assert.ok((await execute(c, action.id, {}, "PARAR", next)).ok); assert.equal(effects, 2);
  } finally { action.executar = original; await c.db._closeDbForTests(); }
});

test("falha definitiva fica vinculada à intenção; auditoria inicial com falha não a consome", async () => {
  const c = await setup(), action = c.A.ACOES.find(a => a.id === "reenvio.parar")!, original = action.executar; let effects = 0;
  action.executar = async () => { effects++; throw new Error("fixture rolled back"); };
  try {
    const ticket = await simulate(c, action.id);
    const first = await execute(c, action.id, {}, "PARAR", ticket); assert.ok(!first.ok && first.erro === "falhou" && first.encerrada);
    const again = await execute(c, action.id, {}, "PARAR", ticket); assert.ok(!again.ok && again.erro === "falhou" && again.encerrada); assert.equal(effects, 1);
    const next = await simulate(c, action.id);
    await c.db.query(`CREATE FUNCTION fail_intent_admission() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='admin_acao_pedida' THEN RAISE EXCEPTION 'intent fixture'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_intent_admission BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_intent_admission();`);
    assert.equal((await execute(c, action.id, {}, "PARAR", next)).ok, false); assert.equal(effects, 1);
    assert.equal((await c.db.query("SELECT 1 FROM admin_acoes WHERE central_simulacao_id=$1", [next.id])).rowCount, 0);
    await c.db.query("DROP TRIGGER fail_intent_admission ON audit_log");
    action.executar = original; assert.ok((await execute(c, action.id, {}, "PARAR", next)).ok);
  } finally { action.executar = original; await c.db._closeDbForTests(); }
});

test("publicação vincula o candidato simulado e mantém resultado externo incerto sem replay", async () => {
  const c = await setup(), action = c.A.ACOES.find(a => a.id === "publicar.pedir")!, original = action.executar, preview = action.simular; let effects = 0;
  action.simular = async () => ({ candidato: { sha256: "a".repeat(64) } });
  action.executar = async () => { effects++; throw new Error("fixture maybe accepted"); };
  try {
    const ticket = await simulate(c, action.id);
    const wrong = await execute(c, action.id, { candidato: "b".repeat(64) }, "PUBLICAR", ticket); assert.ok(!wrong.ok && wrong.erro === "parametros");
    const params = { candidato: "a".repeat(64) };
    const first = await execute(c, action.id, params, "PUBLICAR", ticket); assert.ok(!first.ok && first.erro === "indeterminado");
    await c.db.query("UPDATE admin_acoes SET ts=now()-interval '1 day' WHERE id=$1", [ticket.id]);
    const again = await execute(c, action.id, params, "PUBLICAR", ticket); assert.ok(!again.ok && again.erro === "indeterminado");
    const lookup = await c.A.rodarAcao(action.id, "consultar", params, "", OWNER, { simulacao: ticket }); assert.ok(!lookup.ok && lookup.erro === "indeterminado");
    const next = await simulate(c, action.id); assert.equal((await execute(c, action.id, params, "PUBLICAR", next)).ok, false);
    assert.equal(effects, 1); assert.equal((await c.db.query("SELECT 1 FROM admin_acoes WHERE modo='executar'")).rowCount, 1);
  } finally { action.executar = original; action.simular = preview; await c.db._closeDbForTests(); }
});


test("consultar uma simulação sem execução não admite pedido nem produz efeito", async () => {
  const c = await setup(), action = c.A.ACOES.find(a => a.id === "reenvio.parar")!, original = action.executar; let effects = 0;
  action.executar = async () => { effects++; return {}; };
  try {
    const ticket = await simulate(c, action.id);
    const pending = await c.A.rodarAcao(action.id, "consultar", {}, "", OWNER, { requireIntent: true, simulacao: ticket });
    assert.ok(!pending.ok && pending.erro === "indeterminado");
    assert.equal((await c.db.query("SELECT 1 FROM admin_acoes WHERE modo='executar'")).rowCount, 0);
    await c.db.query("UPDATE admin_acoes SET ts=now()-interval '16 minutes' WHERE id=$1", [ticket.id]);
    const expired = await c.A.rodarAcao(action.id, "consultar", {}, "", OWNER, { requireIntent: true, simulacao: ticket });
    assert.ok(!expired.ok && expired.erro === "parametros" && expired.encerrada);
    assert.equal(effects, 0);
  } finally { action.executar = original; await c.db._closeDbForTests(); }
});
