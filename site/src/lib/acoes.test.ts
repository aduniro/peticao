import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev"; delete process.env.MAIL_PROVIDERS;

const dom = "@acoes-teste.example";
const CTX = { userId: 1, email: "dona@exemplo.org" };
const um = async () => { const dbmod = await import("./db"); await dbmod._openForTests("t_acoes"); return { dbmod, A: await import("./acoes"), R: await import("./reenvio"), B: await import("./batches"), H: await import("./security") }; };

async function pessoas(c: Awaited<ReturnType<typeof um>>) {
  const mk = (n: string, criada: string, status = "pending") => c.dbmod.query("INSERT INTO signatures(name,email,email_hash,category,text_version,consent_at,status,created_at,token_hash,token_expires_at) VALUES($1,$2,$3,'apoiador','v',$4,$5,$4,$6,'2026-11-05T00:00:00Z')", [`Pessoa ${n}`, n + dom, c.H.hmac("a" + n), criada, status, "velho" + n]);
  await mk("a", "2026-11-04T10:00:00.000Z"); await mk("b", "2026-11-04T11:00:00.000Z"); await mk("fora", "2026-11-03T10:00:00.000Z"); await mk("conf", "2026-11-04T10:00:00.000Z", "confirmed");
}
const JAN = { ini: "2026-11-04T07:00:00.000Z", fim: "2026-11-04T15:00:00.000Z" };

test("ações: ação desconhecida e parâmetros inválidos", async () => {
  const c = await um();
  try {
    assert.deepEqual(await c.A.rodarAcao("rm -rf", "executar", {}, "", CTX), { ok: false, erro: "acao_desconhecida" });
    for (const p of [{ ini: "ontem", fim: "hoje" }, { ini: JAN.fim, fim: JAN.ini }, { ini: JAN.ini, fim: "2099-01-01T00:00:00Z" }]) {
      const r: any = await c.A.rodarAcao("reenvio.iniciar", "simular", p, "", CTX);
      assert.equal(r.ok, false); assert.equal(r.erro, "parametros");
    }
  } finally { await c.dbmod._closeDbForTests(); }
});

test("ações: simular não grava nada no reenvio e conta quem seria alcançado", async () => {
  const c = await um();
  try {
    await pessoas(c);
    const r: any = await c.A.rodarAcao("reenvio.iniciar", "simular", JAN, "", CTX);
    assert.ok(r.ok); assert.equal(r.palavra, "REENVIAR"); assert.equal(r.resultado.pessoasAlcancadas, 2);
    assert.match(r.efeito, /NÃO confirmou/);
    assert.equal(await c.B.getSetting("reenvio_ativo", ""), ""); assert.equal(await c.B.getSetting("reenvio_inicio", ""), "");
    const reg = (await c.dbmod.query("SELECT modo, ok FROM admin_acoes")).rows;
    assert.deepEqual(reg, [{ modo: "simular", ok: true }]);
  } finally { await c.dbmod._closeDbForTests(); }
});

test("ações: executar exige a palavra exata; liga e para o reenvio com auditoria", async () => {
  const c = await um();
  try {
    await pessoas(c);
    for (const errada of ["", "reenviar", "SIM", undefined, "REENVIAR!"]) assert.deepEqual(await c.A.rodarAcao("reenvio.iniciar", "executar", JAN, errada, CTX), { ok: false, erro: "confirmacao" });
    assert.equal(await c.B.getSetting("reenvio_ativo", ""), "");
    const r: any = await c.A.rodarAcao("reenvio.iniciar", "executar", JAN, "REENVIAR", CTX);
    assert.ok(r.ok); assert.equal(r.resultado.pessoasAlcancadas, 2); assert.match(r.resultado.codigo, /^PAINEL-1-\d{4}-\d{2}-\d{2}$/);
    assert.equal(await c.B.getSetting("reenvio_ativo", ""), r.resultado.codigo);
    assert.equal(await c.B.getSetting("reenvio_inicio", ""), JAN.ini); assert.equal(await c.B.getSetting("reenvio_fim", ""), JAN.fim); assert.equal(await c.B.getSetting("reenvio_lote", ""), "60");
    // o mesmo lote que o agendador processaria: só as 2 pessoas pendentes da janela
    assert.equal((await c.R.alvos(100)).length, 2);
    const st: any = await c.A.rodarAcao("reenvio.status", "executar", {}, undefined, CTX);
    assert.ok(st.ok); assert.equal(st.resultado.restantes, 2); assert.equal(st.resultado.ativo, r.resultado.codigo);
    assert.deepEqual(await c.A.rodarAcao("reenvio.parar", "executar", {}, "nao", CTX), { ok: false, erro: "confirmacao" });
    const p: any = await c.A.rodarAcao("reenvio.parar", "executar", {}, "PARAR", CTX);
    assert.ok(p.ok); assert.equal(p.resultado.estavaLigado, true);
    assert.equal(await c.B.getSetting("reenvio_ativo", ""), "");
    const reg = (await c.dbmod.query("SELECT acao, modo, ok, email FROM admin_acoes WHERE modo='executar' ORDER BY id")).rows;
    assert.deepEqual(reg.map((x: any) => x.acao), ["reenvio.iniciar", "reenvio.status", "reenvio.parar"]);
    assert.ok(reg.every((x: any) => x.ok && x.email === CTX.email));
    assert.equal((await c.dbmod.query("SELECT 1 FROM audit_log WHERE event='admin_acao_executada'")).rowCount, 3);
    assert.ok((await c.dbmod.verifyAuditChain()).ok);
  } finally { await c.dbmod._closeDbForTests(); }
});

test("ações: quem já foi reenviado não é alcançado de novo; estado do sistema só lê", async () => {
  const c = await um();
  try {
    await pessoas(c);
    const a = (await c.dbmod.query<{ id: number }>("SELECT id FROM signatures WHERE email=$1", ["a" + dom])).rows[0].id;
    await c.dbmod.query("INSERT INTO reenvio_falha(signature_id, provider, status) VALUES($1,'dev','sent')", [a]);
    const r: any = await c.A.rodarAcao("reenvio.iniciar", "simular", JAN, "", CTX);
    assert.equal(r.resultado.pessoasAlcancadas, 1);
    const e: any = await c.A.rodarAcao("estado.ver", "executar", {}, undefined, CTX);
    assert.ok(e.ok); assert.equal(e.resultado.assinaturas.pendentes, 3); assert.equal(e.resultado.assinaturas.confirmadas, 1);
    assert.ok(e.resultado.filaDeEmails && e.resultado.versao);
  } finally { await c.dbmod._closeDbForTests(); }
});

test("ações: a trava impede duas execuções da mesma ação ao mesmo tempo", async () => {
  const c = await um();
  try {
    let solta: () => void = () => {};
    const segura = new Promise<void>((r) => { solta = r; });
    const original = c.A.ACOES.find((a) => a.id === "reenvio.parar")!;
    const exec = original.executar;
    original.executar = async (p, ctx) => { await segura; return exec(p, ctx); };
    try {
      const primeira = c.A.rodarAcao("reenvio.parar", "executar", {}, "PARAR", CTX);
      await new Promise((r) => setTimeout(r, 300));
      assert.deepEqual(await c.A.rodarAcao("reenvio.parar", "executar", {}, "PARAR", CTX), { ok: false, erro: "ocupado" });
      solta();
      assert.equal(((await primeira) as any).ok, true);
    } finally { original.executar = exec; }
  } finally { await c.dbmod._closeDbForTests(); }
});

test("rotas: a Central e o step-up exigem nível total (e a Central exige a confirmação extra)", () => {
  const api = readFileSync(join(__dirname, "../app/api/admin/acoes/route.ts"), "utf8");
  assert.match(api, /exigirNivel\(req, "total", \d+, \{ stepup: true \}\)/);
  const pag = readFileSync(join(__dirname, "../app/admin/acoes/page.tsx"), "utf8");
  assert.match(pag, /stepupValido/); assert.match(pag, /nivelOk\(s\.nivel, "total"\)/);
});
