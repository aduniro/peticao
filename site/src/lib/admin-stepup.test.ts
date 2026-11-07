import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";
delete process.env.ADMIN_NO_PASSWORD; delete process.env.PREVIEW_MODE;

const SENHA = "Uma-Senha-Forte-2026";
const um = async () => { const dbmod = await import("./db"); await dbmod._openForTests("t_admin_stepup"); return { dbmod, U: await import("./admin-users"), API: await import("./admin-api") }; };

/** Cria o dono, abre a sessão e devolve a SessaoAdmin do banco + um "e-mail" capturado. */
async function cenario() {
  const c = await um();
  const r = await c.U.criarUsuario({ email: "dona@exemplo.org", nome: "Dona da Silva", nivel: "total", senha: SENHA });
  assert.ok(r.ok);
  const { token } = await c.U.abrirSessao((r as any).usuario.id, "127.0.0.1");
  const sessao = async () => (await c.U.sessaoPorToken(token))!;
  const caixa: { to: string; text: string }[] = [];
  const enviar = async (m: { to: string; text: string }) => { caixa.push(m); };
  const codigo = () => /(\d{6})/.exec(caixa[caixa.length - 1].text)![1];
  return { ...c, token, sessao, caixa, enviar, codigo };
}

test("step-up: sem confirmação não vale; pedir manda o código só ao e-mail do usuário", async () => {
  const c = await cenario();
  try {
    assert.equal(c.U.stepupValido(await c.sessao()), false);
    assert.equal(c.U.stepupValido(null), false);
    assert.deepEqual(await c.U.pedirStepup(await c.sessao(), c.enviar as never), { ok: true });
    assert.equal(c.caixa.length, 1); assert.equal(c.caixa[0].to, "dona@exemplo.org"); assert.match(c.caixa[0].text, /\b\d{6}\b/);
    const guardado = (await c.dbmod.query<{ h: string }>("SELECT codigo_hash h FROM admin_stepup")).rows[0].h;
    assert.ok(!guardado.includes(c.codigo())); // só o hash fica no banco
  } finally { await c.dbmod._closeDbForTests(); }
});

test("step-up: senha errada e código errado recusam; certo libera por 15 minutos", async () => {
  const c = await cenario();
  try {
    await c.U.pedirStepup(await c.sessao(), c.enviar as never);
    assert.deepEqual(await c.U.confirmarStepup(await c.sessao(), "senha-errada-123", c.codigo()), { ok: false, erro: "senha" });
    const errado = c.codigo() === "000000" ? "111111" : "000000";
    assert.deepEqual(await c.U.confirmarStepup(await c.sessao(), SENHA, errado), { ok: false, erro: "codigo" });
    assert.deepEqual(await c.U.confirmarStepup(await c.sessao(), SENHA, "abc"), { ok: false, erro: "codigo" });
    assert.equal(c.U.stepupValido(await c.sessao()), false);
    const r = await c.U.confirmarStepup(await c.sessao(), SENHA, c.codigo());
    assert.ok(r.ok);
    const ms = (r as any).ate.getTime() - Date.now();
    assert.ok(ms > 14 * 60_000 && ms <= 15 * 60_000);
    assert.equal(c.U.stepupValido(await c.sessao()), true);
    assert.deepEqual(await c.U.confirmarStepup(await c.sessao(), SENHA, c.codigo()), { ok: false, erro: "codigo" }); // uso único
    await c.dbmod.query("UPDATE admin_sessions SET stepup_ate = now() - interval '1 minute'");
    assert.equal(c.U.stepupValido(await c.sessao()), false); // venceu
  } finally { await c.dbmod._closeDbForTests(); }
});

test("step-up: 5 erros invalidam o código; código vencido e limite de 3 pedidos por hora", async () => {
  const c = await cenario();
  try {
    await c.U.pedirStepup(await c.sessao(), c.enviar as never);
    const certo = c.codigo(), errado = certo === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await c.U.confirmarStepup(await c.sessao(), SENHA, errado);
    assert.deepEqual(await c.U.confirmarStepup(await c.sessao(), SENHA, certo), { ok: false, erro: "codigo" }); // queimado, mesmo o certo
    await c.U.pedirStepup(await c.sessao(), c.enviar as never);
    await c.dbmod.query("UPDATE admin_stepup SET expira_em = now() - interval '1 second' WHERE NOT usado");
    assert.deepEqual(await c.U.confirmarStepup(await c.sessao(), SENHA, c.codigo()), { ok: false, erro: "codigo" }); // vencido
    await c.U.pedirStepup(await c.sessao(), c.enviar as never); // 3º
    assert.deepEqual(await c.U.pedirStepup(await c.sessao(), c.enviar as never), { ok: false, erro: "muitos_pedidos" });
    assert.equal(c.caixa.length, 3);
  } finally { await c.dbmod._closeDbForTests(); }
});

test("step-up: código de outra sessão não vale; senha única e pré-visualização", async () => {
  const c = await cenario();
  try {
    await c.U.pedirStepup(await c.sessao(), c.enviar as never);
    const cod = c.codigo();
    const outra = await c.U.abrirSessao((await c.U.sessaoPorToken(c.token))!.userId, "127.0.0.1");
    const s2 = (await c.U.sessaoPorToken(outra.token))!;
    assert.deepEqual(await c.U.confirmarStepup(s2, SENHA, cod), { ok: false, erro: "codigo" }); // o código é amarrado à sessão que pediu
    const base = await c.sessao();
    assert.equal(c.U.stepupValido({ ...base, legado: true, stepupAte: new Date(Date.now() + 1e6) }), false); // senha única nunca passa
    assert.equal(c.U.stepupValido({ ...base, preview: true }), true);
    assert.deepEqual(await c.U.pedirStepup({ ...base, userId: 0, sessaoId: null }), { ok: false, erro: "sem_conta" });
  } finally { await c.dbmod._closeDbForTests(); }
});

test("exigirNivel com step-up: 403 stepup sem confirmação, passa depois", async () => {
  const c = await cenario();
  try {
    const { ADMIN_COOKIE } = await import("./admin");
    const mk = () => { const r: any = new Request("http://localhost/api/admin/x", { method: "POST", headers: { origin: "http://localhost", host: "localhost" } }); r.cookies = { get: (n: string) => (n === ADMIN_COOKIE ? { value: c.token } : undefined) }; return r; };
    const antes = await c.API.exigirNivel(mk(), "total", 120, { stepup: true });
    assert.equal(antes?.status, 403); assert.deepEqual(await antes!.json(), { ok: false, erro: "stepup" });
    assert.equal(await c.API.exigirNivel(mk(), "total", 120), null); // sem a opção, segue como antes
    await c.U.pedirStepup(await c.sessao(), c.enviar as never);
    assert.ok((await c.U.confirmarStepup(await c.sessao(), SENHA, c.codigo())).ok);
    assert.equal(await c.API.exigirNivel(mk(), "total", 120, { stepup: true }), null);
  } finally { await c.dbmod._closeDbForTests(); }
});

test("step-up concorrente: código libera a sessão uma vez, mesmo com duas confirmações", async () => {
  const c = await cenario();
  try {
    await c.U.pedirStepup(await c.sessao(), c.enviar as never);
    const snapshot = await c.sessao(), code = c.codigo();
    const results = await Promise.all([c.U.confirmarStepup(snapshot, SENHA, code), c.U.confirmarStepup(snapshot, SENHA, code)]);
    assert.equal(results.filter(r => r.ok).length, 1);
    assert.equal((await c.dbmod.query("SELECT count(*)::int n FROM audit_log WHERE event='admin_stepup_ok'")).rows[0].n, 1);
    assert.equal(c.U.stepupValido(await c.sessao()), true);
    assert.ok((await c.dbmod.verifyAuditChain()).ok);
  } finally { await c.dbmod._closeDbForTests(); }
});

test("step-up concorrente: quota por conta é respeitada entre sessões e há um código ativo por sessão", async () => {
  const c = await cenario();
  try {
    const first = await c.sessao();
    const other = await c.U.abrirSessao(first.userId, "127.0.0.1");
    const second = (await c.U.sessaoPorToken(other.token))!;
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => c.U.pedirStepup(i % 2 ? first : second, c.enviar as never)));
    assert.equal(results.filter(r => r.ok).length, 3);
    assert.equal(c.caixa.length, 3);
    assert.equal((await c.dbmod.query("SELECT count(*)::int n FROM admin_stepup")).rows[0].n, 3);
    const active = (await c.dbmod.query("SELECT sessao_id,count(*)::int n FROM admin_stepup WHERE NOT usado GROUP BY sessao_id")).rows;
    assert.ok(active.every(row => row.n === 1));
    assert.ok((await c.dbmod.verifyAuditChain()).ok);
  } finally { await c.dbmod._closeDbForTests(); }
});

test("step-up: falha na auditoria desfaz reserva e liberação, sem enviar um código órfão", async () => {
  const c = await cenario();
  try {
    await c.dbmod.query(`CREATE FUNCTION fail_stepup_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event IN ('admin_stepup_pedido','admin_stepup_ok') THEN RAISE EXCEPTION 'stepup audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_stepup_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_stepup_audit();`);
    await assert.rejects(c.U.pedirStepup(await c.sessao(), c.enviar as never), /stepup audit failure/);
    assert.equal(c.caixa.length, 0);
    assert.equal((await c.dbmod.query("SELECT count(*)::int n FROM admin_stepup")).rows[0].n, 0);
    await c.dbmod.query("DROP TRIGGER fail_stepup_audit ON audit_log");
    await c.U.pedirStepup(await c.sessao(), c.enviar as never);
    await c.dbmod.query("CREATE TRIGGER fail_stepup_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_stepup_audit()");
    await assert.rejects(c.U.confirmarStepup(await c.sessao(), SENHA, c.codigo()), /stepup audit failure/);
    assert.equal(c.U.stepupValido(await c.sessao()), false);
    assert.equal((await c.dbmod.query("SELECT usado FROM admin_stepup")).rows[0].usado, false);
    await c.dbmod.query("DROP TRIGGER fail_stepup_audit ON audit_log");
    assert.ok((await c.U.confirmarStepup(await c.sessao(), SENHA, c.codigo())).ok);
  } finally { await c.dbmod._closeDbForTests(); }
});

test("step-up: snapshot antigo não recria sessão revogada, expirada ou de outra conta", async () => {
  const c = await cenario();
  try {
    const snapshot = await c.sessao();
    await c.U.pedirStepup(snapshot, c.enviar as never);
    const code = c.codigo();
    assert.deepEqual(await c.U.confirmarStepup({ ...snapshot, userId: snapshot.userId + 1000 }, SENHA, code), { ok: false, erro: "sem_conta" });
    await c.dbmod.query("UPDATE admin_sessions SET expira_em=now()-interval '1 second' WHERE id=$1", [snapshot.sessaoId]);
    assert.deepEqual(await c.U.pedirStepup(snapshot, c.enviar as never), { ok: false, erro: "sem_conta" });
    assert.deepEqual(await c.U.confirmarStepup(snapshot, SENHA, code), { ok: false, erro: "sem_conta" });
    assert.equal((await c.dbmod.query("SELECT usado FROM admin_stepup")).rows[0].usado, false);
    await c.U.encerrarSessao(c.token);
    assert.deepEqual(await c.U.confirmarStepup(snapshot, SENHA, code), { ok: false, erro: "sem_conta" });
    assert.equal(c.caixa.length, 1);
    assert.equal((await c.dbmod.query("SELECT count(*)::int n FROM admin_stepup")).rows[0].n, 0);
  } finally { await c.dbmod._closeDbForTests(); }
});
