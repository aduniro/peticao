import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

(process.env as Record<string, string>).NODE_ENV = "test";
delete process.env.ADMIN_NO_PASSWORD; delete process.env.PREVIEW_MODE;
process.env.ADMIN_PASSWORD = "senha-unica-antiga-123";
delete process.env.ADMIN_PASSWORD_FILE;

const SENHA = "Uma-Senha-Forte-2026";
const um = async () => { const dbmod = await import("./db"); await dbmod._openForTests("t_admin_users"); return { dbmod, U: await import("./admin-users"), A: await import("./admin"), API: await import("./admin-api") }; };

test("níveis: ordem e checagem", async () => {
  const { U } = await um();
  assert.deepEqual([...U.NIVEIS], ["leitura", "edicao", "exclusao", "total"]);
  assert.ok(U.nivelOk("total", "leitura") && U.nivelOk("edicao", "edicao") && U.nivelOk("exclusao", "edicao"));
  assert.ok(!U.nivelOk("leitura", "edicao") && !U.nivelOk("edicao", "total") && !U.nivelOk("exclusao", "total"));
  assert.ok(U.ehNivel("total") && !U.ehNivel("root") && !U.ehNivel(undefined));
});

test("criar usuário: validações, e-mail único e senha forte", async () => {
  const { U, dbmod } = await um();
  try {
    assert.equal((await U.temUsuarios()), false); // sem ninguém: vale a senha única de transição
    assert.deepEqual(await U.criarUsuario({ email: "sem-arroba", nome: "Fulana", nivel: "leitura" }), { ok: false, erro: "email_invalido" });
    assert.deepEqual(await U.criarUsuario({ email: "a@b.com", nome: "F", nivel: "leitura" }), { ok: false, erro: "nome_invalido" });
    assert.deepEqual(await U.criarUsuario({ email: "a@b.com", nome: "Fulana", nivel: "root" as never }), { ok: false, erro: "nivel_invalido" });
    const fraca = await U.criarUsuario({ email: "dona@exemplo.org", nome: "Dona", nivel: "total", senha: "curta" });
    assert.equal(fraca.ok, false); assert.equal((fraca as any).erro, "senha_fraca");
    assert.equal((await U.criarUsuario({ email: "dona@exemplo.org", nome: "Dona", nivel: "total", senha: "dona-forte-123456" }) as any).erro, "senha_fraca"); // contém o e-mail
    const r = await U.criarUsuario({ email: "  Dona@Exemplo.ORG ", nome: "Dona  da  Silva", nivel: "total", senha: SENHA });
    assert.ok(r.ok); assert.equal((r as any).senhaGerada, null); assert.equal((r as any).usuario.email, "dona@exemplo.org"); assert.equal((r as any).usuario.nome, "Dona da Silva");
    assert.equal((await U.criarUsuario({ email: "DONA@exemplo.org", nome: "Outra", nivel: "leitura", senha: SENHA }) as any).erro, "email_ja_existe");
    assert.equal(await U.temUsuarios(), true); // o primeiro usuário desliga a senha única
    const g = await U.criarUsuario({ email: "novo@exemplo.org", nome: "Novo", nivel: "leitura" });
    assert.ok(g.ok && (g as any).senhaGerada && (g as any).senhaGerada.length >= 16 && (g as any).usuario.trocarSenha);
    const hash = (await dbmod.query<{ h: string }>("SELECT senha_hash h FROM admin_users WHERE email='dona@exemplo.org'")).rows[0].h;
    assert.match(hash, /^scrypt\$/); assert.ok(!hash.includes(SENHA)); // só o hash é guardado
  } finally { await dbmod._closeDbForTests(); }
});

test("login: senha certa, errada, e-mail inexistente e bloqueio após 5 erros", async () => {
  const { U, dbmod } = await um();
  try {
    await U.criarUsuario({ email: "ana@exemplo.org", nome: "Ana", nivel: "edicao", senha: SENHA });
    assert.equal((await U.autenticar("ana@exemplo.org", "errada")).ok, false);
    const semConta = await U.autenticar("ninguem@exemplo.org", SENHA);
    assert.deepEqual(semConta, { ok: false, motivo: "credenciais" }); // mesmo erro de senha errada: não revela quem tem conta
    for (let i = 0; i < 3; i++) await U.autenticar("ana@exemplo.org", "errada");
    const quinta = await U.autenticar("ana@exemplo.org", "errada"); // 5ª falha seguida
    assert.deepEqual(quinta, { ok: false, motivo: "bloqueado" });
    assert.deepEqual(await U.autenticar("ana@exemplo.org", SENHA), { ok: false, motivo: "bloqueado" }); // mesmo acertando, está bloqueada
    await dbmod.query("UPDATE admin_users SET bloqueado_ate = now() - interval '1 minute' WHERE email='ana@exemplo.org'"); // passou o prazo
    const ok = await U.autenticar("ana@exemplo.org", SENHA);
    assert.ok(ok.ok); assert.equal((ok as any).usuario.nivel, "edicao");
    assert.equal((await dbmod.query<{ f: number }>("SELECT falhas f FROM admin_users WHERE email='ana@exemplo.org'")).rows[0].f, 0);
  } finally { await dbmod._closeDbForTests(); }
});

test("sessão: o nível vem do banco; desativar e mudar nível valem na hora; expiração e token inválido", async () => {
  const { U, dbmod } = await um();
  try {
    const c = await U.criarUsuario({ email: "bia@exemplo.org", nome: "Bia", nivel: "leitura", senha: SENHA });
    const id = (c as any).usuario.id;
    await U.criarUsuario({ email: "dono@exemplo.org", nome: "Dono", nivel: "total", senha: SENHA });
    const { token } = await U.abrirSessao(id, "1.2.3.4");
    assert.equal((await dbmod.query<{ t: string }>("SELECT token_hash t FROM admin_sessions")).rows.every((r) => r.t !== token), true); // só o hash
    let s = await U.sessaoPorToken(token);
    assert.equal(s?.email, "bia@exemplo.org"); assert.equal(s?.nivel, "leitura");
    assert.deepEqual(await U.alterarNivel(id, "edicao", "teste"), { ok: true });
    assert.equal((await U.sessaoPorToken(token))?.nivel, "edicao"); // sem precisar sair e entrar
    assert.equal(await U.sessaoPorToken("curto"), null); assert.equal(await U.sessaoPorToken("x".repeat(43)), null);
    await dbmod.query("UPDATE admin_sessions SET expira_em = now() - interval '1 second'");
    assert.equal(await U.sessaoPorToken(token), null); // expirou
    const t2 = (await U.abrirSessao(id, "1.2.3.4")).token;
    assert.ok(await U.sessaoPorToken(t2));
    await U.definirAtivo(id, false, "teste");
    assert.equal(await U.sessaoPorToken(t2), null); // desativada: a sessão cai na hora
    await U.definirAtivo(id, true, "teste");
    const t3 = (await U.abrirSessao(id, "1.2.3.4")).token; await U.encerrarSessao(t3);
    assert.equal(await U.sessaoPorToken(t3), null); // sair revoga no banco
  } finally { await dbmod._closeDbForTests(); }
});

test("nunca fica sem usuário Total ativo", async () => {
  const { U, dbmod } = await um();
  try {
    const a = (await U.criarUsuario({ email: "a@exemplo.org", nome: "Aa", nivel: "total", senha: SENHA }) as any).usuario.id;
    assert.deepEqual(await U.alterarNivel(a, "edicao", "t"), { ok: false, erro: "ultimo_total" });
    assert.deepEqual(await U.definirAtivo(a, false, "t"), { ok: false, erro: "ultimo_total" });
    const b = (await U.criarUsuario({ email: "b@exemplo.org", nome: "Bb", nivel: "total", senha: SENHA }) as any).usuario.id;
    assert.deepEqual(await U.alterarNivel(a, "edicao", "t"), { ok: true }); // agora há outro Total
    assert.deepEqual(await U.definirAtivo(b, false, "t"), { ok: false, erro: "ultimo_total" }); // b é o último
    assert.deepEqual(await U.alterarNivel(999, "total", "t"), { ok: false, erro: "nao_existe" });
  } finally { await dbmod._closeDbForTests(); }
});

test("redefinição de senha: link de uso único, validade, senha fraca, derruba sessões, não revela contas", async () => {
  const { U, dbmod } = await um();
  try {
    const id = (await U.criarUsuario({ email: "cris@exemplo.org", nome: "Cris", nivel: "edicao", senha: SENHA }) as any).usuario.id;
    const enviados: { to: string; subject: string; text: string }[] = [];
    const enviar = async (m: { to: string; subject: string; text: string; html: string }) => { enviados.push(m); };
    await U.pedirReset("ninguem@exemplo.org", { origin: "https://site.test", enviar });
    assert.equal(enviados.length, 0); // e-mail sem conta: nada sai
    const { token: sessao } = await U.abrirSessao(id, "9.9.9.9");
    await U.pedirReset(" CRIS@exemplo.org ", { origin: "https://site.test/", enviar });
    assert.equal(enviados.length, 1); assert.equal(enviados[0].to, "cris@exemplo.org");
    const link = /https:\/\/site\.test\/admin\/redefinir\?token=([A-Za-z0-9_-]+)/.exec(enviados[0].text)!;
    assert.ok(link); const token = link[1];
    assert.match(enviados[0].text, /30 minutos/); assert.ok(!enviados[0].text.includes(SENHA));
    assert.equal(((await U.redefinirSenha(token, "curta")) as any).erro, "senha_fraca");
    assert.deepEqual(await U.redefinirSenha(token, "Outra-Senha-Forte-77"), { ok: true });
    assert.deepEqual(await U.redefinirSenha(token, "Mais-Uma-Senha-Forte-88"), { ok: false, erro: "token_invalido" }); // uso único
    assert.equal(await U.sessaoPorToken(sessao), null); // a sessão antiga caiu
    assert.equal((await U.autenticar("cris@exemplo.org", SENHA)).ok, false);
    assert.ok((await U.autenticar("cris@exemplo.org", "Outra-Senha-Forte-77")).ok);
    // vencido
    await U.pedirReset("cris@exemplo.org", { origin: "https://site.test", enviar });
    const t2 = /token=([A-Za-z0-9_-]+)/.exec(enviados[1].text)![1];
    await dbmod.query("UPDATE admin_reset SET expira_em = now() - interval '1 second'");
    assert.equal(((await U.redefinirSenha(t2, "Senha-Nova-Forte-99")) as any).erro, "token_invalido");
    assert.equal(((await U.redefinirSenha("lixo", "Senha-Nova-Forte-99")) as any).erro, "token_invalido");
    // no máximo 3 pedidos por hora por conta (já houve 2)
    await U.pedirReset("cris@exemplo.org", { origin: "https://site.test", enviar }); await U.pedirReset("cris@exemplo.org", { origin: "https://site.test", enviar });
    assert.equal(enviados.length, 3);
  } finally { await dbmod._closeDbForTests(); }
});

test("convite de novo usuário: link de 24 h para criar a própria senha (nenhuma senha viaja por e-mail)", async () => {
  const { U, dbmod } = await um();
  try {
    await U.criarUsuario({ email: "dani@exemplo.org", nome: "Dani", nivel: "leitura" });
    const enviados: { subject: string; text: string; html: string }[] = [];
    await U.pedirReset("dani@exemplo.org", { origin: "https://site.test", convite: true, enviar: async (m) => { enviados.push(m); } });
    assert.match(enviados[0].subject, /Convite/); assert.match(enviados[0].text, /24 horas/); assert.match(enviados[0].html, /Criar a minha senha/);
    const horas = (await dbmod.query<{ h: number }>("SELECT round(extract(epoch FROM (expira_em - criado_em))/3600)::int h FROM admin_reset")).rows[0].h;
    assert.equal(horas, 24);
    const t = /token=([A-Za-z0-9_-]+)/.exec(enviados[0].text)![1];
    assert.deepEqual(await U.redefinirSenha(t, "Primeira-Senha-Forte-1"), { ok: true });
    assert.equal((await dbmod.query<{ t: boolean }>("SELECT trocar_senha t FROM admin_users WHERE email='dani@exemplo.org'")).rows[0].t, false);
  } finally { await dbmod._closeDbForTests(); }
});

test("trocar a própria senha exige a atual e uma senha forte", async () => {
  const { U, dbmod } = await um();
  try {
    const id = (await U.criarUsuario({ email: "eva@exemplo.org", nome: "Eva", nivel: "leitura", senha: SENHA }) as any).usuario.id;
    assert.deepEqual(await U.trocarMinhaSenha(id, "errada", "Nova-Senha-Forte-5"), { ok: false, erro: "atual_errada" });
    assert.equal(((await U.trocarMinhaSenha(id, SENHA, "curta")) as any).erro, "senha_fraca");
    assert.deepEqual(await U.trocarMinhaSenha(id, SENHA, "Nova-Senha-Forte-5"), { ok: true });
    assert.ok((await U.autenticar("eva@exemplo.org", "Nova-Senha-Forte-5")).ok);
  } finally { await dbmod._closeDbForTests(); }
});

test("porteiro das rotas: 401 sem sessão, 403 sem nível, senha única só na transição, origem e preview", async () => {
  const { U, A, API, dbmod } = await um();
  const { NextRequest } = await import("next/server");
  let ip = 10;
  const req = (cookie: string | null, metodo = "GET", extra: Record<string, string> = {}) =>
    new NextRequest("http://localhost/api/admin/x", { method: metodo, headers: { host: "localhost", "x-forwarded-for": `10.0.0.${ip++}`, ...(cookie ? { cookie: `adm=${cookie}` } : {}), ...extra } });
  try {
    // TRANSIÇÃO: nenhum usuário; o cookie da senha única antiga vale como Total
    const legado = A.adminToken();
    assert.equal((await API.exigirNivel(req(null), "leitura"))?.status, 401);
    assert.equal(await API.exigirNivel(req(legado), "total"), null);
    assert.equal((await API.exigirNivel(req("lixo"), "leitura"))?.status, 401);
    // CRIOU O PRIMEIRO USUÁRIO: o cookie da senha única deixa de valer na hora
    const dono = (await U.criarUsuario({ email: "dono@exemplo.org", nome: "Dono", nivel: "total", senha: SENHA }) as any).usuario;
    assert.equal((await API.exigirNivel(req(legado), "leitura"))?.status, 401);
    const leitor = (await U.criarUsuario({ email: "leitor@exemplo.org", nome: "Leitor", nivel: "leitura", senha: SENHA }) as any).usuario;
    const tLeitor = (await U.abrirSessao(leitor.id, "1.1.1.1")).token, tDono = (await U.abrirSessao(dono.id, "1.1.1.1")).token;
    assert.equal(await API.exigirNivel(req(tLeitor), "leitura"), null);
    for (const exige of ["edicao", "exclusao", "total"] as const) assert.equal((await API.exigirNivel(req(tLeitor), exige))?.status, 403, exige);
    for (const exige of ["leitura", "edicao", "exclusao", "total"] as const) assert.equal(await API.exigirNivel(req(tDono), exige), null, exige);
    await U.alterarNivel(leitor.id, "edicao", "t");
    assert.equal(await API.exigirNivel(req(tLeitor), "edicao"), null); // subiu de nível: vale na hora, sem novo login
    assert.equal((await API.exigirNivel(req(tLeitor), "total"))?.status, 403);
    // origem: POST de outro site ou sem origem é recusado; mesmo site passa
    assert.equal((await API.exigirNivel(req(tDono, "POST", { origin: "https://outro.site" }), "total"))?.status, 403);
    assert.equal((await API.exigirNivel(req(tDono, "POST"), "total"))?.status, 403);
    assert.equal(await API.exigirNivel(req(tDono, "POST", { origin: "http://localhost" }), "total"), null);
    assert.equal(await API.exigirNivel(req(tDono, "POST", { "sec-fetch-site": "same-origin" }), "total"), null);
    // pré-visualização (só com PREVIEW_MODE=1 e ADMIN_NO_PASSWORD=1) vale como Total; sozinha a variável é ignorada
    process.env.ADMIN_NO_PASSWORD = "1";
    assert.equal((await API.exigirNivel(req(null), "leitura"))?.status, 401);
    process.env.PREVIEW_MODE = "1";
    assert.equal(await API.exigirNivel(req(null), "total"), null);
    delete process.env.ADMIN_NO_PASSWORD; delete process.env.PREVIEW_MODE;
  } finally { await dbmod._closeDbForTests(); }
});

// ---- varredura: nenhuma rota/página do painel pode ficar sem nível, e o isAdmin() síncrono não pode voltar ----
const arquivos = (dir: string, nome: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? arquivos(p, nome) : f === nome ? [p] : []; });
const SRC = join(process.cwd(), "src");
const SEM_NIVEL_API = new Set(["login", "sair", "esqueci", "redefinir"]); // públicas por natureza (têm antirrobô, limites e/ou token de uso único)
const SEM_NIVEL_PAGINA = new Set(["esqueci", "redefinir"]); // recuperação pública; devolvidos também exige a sessão protegida

test("varredura: toda rota de /api/admin chama exigirNivel com um nível; toda página do /admin confere a sessão", () => {
  const rotas = arquivos(join(SRC, "app/api/admin"), "route.ts");
  assert.ok(rotas.length >= 30, `poucas rotas encontradas: ${rotas.length}`);
  const sem = rotas.filter((f) => !SEM_NIVEL_API.has(f.split("/api/admin/")[1].split("/")[0]) && !/exigirNivel\([^)]*"(leitura|edicao|exclusao|total)"/.test(readFileSync(f, "utf8")));
  assert.deepEqual(sem.map((f) => f.split("/src/")[1]), [], "rotas sem exigirNivel(req, nivel)");
  const paginas = arquivos(join(SRC, "app/admin"), "page.tsx");
  assert.ok(paginas.length >= 14, `poucas páginas encontradas: ${paginas.length}`);
  const semPag = paginas.filter((f) => {
    const path = relative(join(SRC, "app/admin"), f);
    if (SEM_NIVEL_PAGINA.has(path.split("/")[0])) return false;
    const helper = path === join("conta", "page.tsx") ? "sessaoAdminDaConta" : "sessaoAdmin";
    const source = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const importsHelper = source.statements.some(statement => ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === "@/lib/admin"
      && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
      && statement.importClause.namedBindings.elements.some(binding => binding.name.text === helper
        && (binding.propertyName?.text ?? binding.name.text) === helper));
    let awaitsHelper = false;
    const visit = (node: ts.Node) => {
      if (ts.isAwaitExpression(node) && ts.isCallExpression(node.expression)
        && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === helper
        && node.expression.arguments.length === 0) awaitsHelper = true;
      ts.forEachChild(node, visit);
    };
    visit(source);
    return !importsHelper || !awaitsHelper;
  });
  assert.deepEqual(semPag.map((f) => f.split("/src/")[1]), [], "páginas sem import/chamada aguardada do guard: conta exige sessaoAdminDaConta(); demais exigem sessaoAdmin()");
});

test("varredura: ninguém usa o isAdmin() síncrono nem o cookie assinado antigo fora de lib/admin.ts", () => {
  const todos = [...arquivos(join(SRC, "app"), "route.ts"), ...arquivos(join(SRC, "app"), "page.tsx"), ...arquivos(join(SRC, "app"), "layout.tsx"), ...arquivos(join(SRC, "components"), "Shell.tsx")];
  const usam = todos.filter((f) => /\bisAdmin\b|\btokenAdminValido\b|\badminToken\b/.test(readFileSync(f, "utf8")) && !/api\/admin\/login\//.test(f));
  assert.deepEqual(usam.map((f) => f.split("/src/")[1]), []);
});

test("alterações simultâneas preservam um Total ativo e suas auditorias", async () => {
  const { U, dbmod } = await um();
  try {
    const a = await U.criarUsuario({ email: "owner-a@example.org", nome: "Dono A", nivel: "total", senha: SENHA });
    const b = await U.criarUsuario({ email: "owner-b@example.org", nome: "Dono B", nivel: "total", senha: SENHA });
    assert.ok(a.ok && b.ok);
    const results = await Promise.all([U.alterarNivel(a.usuario.id, "edicao", "concorrencia"), U.definirAtivo(b.usuario.id, false, "concorrencia")]);
    assert.equal(results.filter(r => r.ok).length, 1);
    assert.equal(results.filter(r => !r.ok && r.erro === "ultimo_total").length, 1);
    assert.equal((await dbmod.query("SELECT count(*)::int n FROM admin_users WHERE ativo AND nivel='total'")).rows[0].n, 1);
    assert.ok((await dbmod.verifyAuditChain()).ok);
  } finally { await dbmod._closeDbForTests(); }
});

test("gestão revalida autoria atual e recusa operador revogado sem alterar a conta", async () => {
  const { U, dbmod } = await um();
  try {
    const owner = await U.criarUsuario({ email: "manager@example.test", nome: "Gestor QA", nivel: "total", senha: SENHA });
    const target = await U.criarUsuario({ email: "managed@example.test", nome: "Pessoa QA", nivel: "leitura", senha: SENHA });
    assert.ok(owner.ok && target.ok);
    const actor = { userId: owner.usuario.id, email: owner.usuario.email };
    const denied = { ok: false, erro: "nao_autorizado" };
    const before = (await dbmod.query("SELECT nivel,ativo FROM admin_users WHERE id=$1", [target.usuario.id])).rows;
    for (const status of ["nivel='leitura'", "nivel='total',ativo=false", "nivel='total',ativo=true,email='changed@example.test'"]) {
      await dbmod.query(`UPDATE admin_users SET ${status} WHERE id=$1`, [owner.usuario.id]);
      assert.deepEqual(await U.alterarNivel(target.usuario.id, "edicao", "spoofed", actor), denied);
      assert.deepEqual(await U.definirAtivo(target.usuario.id, false, "spoofed", actor), denied);
    }
    await dbmod.query("UPDATE admin_users SET email=$2,ativo=true,nivel='total' WHERE id=$1", [owner.usuario.id, owner.usuario.email]);
    for (const invalid of [{ ...actor, userId: 2147483648 }, { ...actor, userId: 0 }, { ...actor, userId: -1 }, { ...actor, email: "other@example.test" }]) {
      assert.deepEqual(await U.alterarNivel(target.usuario.id, "edicao", "spoofed", invalid), denied);
      assert.deepEqual(await U.definirAtivo(target.usuario.id, false, "spoofed", invalid), denied);
    }
    assert.deepEqual((await dbmod.query("SELECT nivel,ativo FROM admin_users WHERE id=$1", [target.usuario.id])).rows, before);
    assert.equal((await dbmod.query("SELECT count(*)::int n FROM audit_log WHERE event IN ('admin_usuario_nivel','admin_usuario_desativado')")).rows[0].n, 0);
    assert.deepEqual(await U.alterarNivel(target.usuario.id, "edicao", "spoofed", actor), { ok: true });
    const event = JSON.parse((await dbmod.query("SELECT data FROM audit_log WHERE event='admin_usuario_nivel'")).rows[0].data);
    assert.equal(event.por, actor.email); assert.equal(event.userId, actor.userId);
    assert.ok((await dbmod.verifyAuditChain()).ok);
  } finally { await dbmod._closeDbForTests(); }
});

test("falha na auditoria reverte nível, ativação e revogação de sessões", async () => {
  const { U, dbmod } = await um();
  try {
    const owner = await U.criarUsuario({ email: "owner-rollback@example.test", nome: "Gestor QA", nivel: "total", senha: SENHA });
    const target = await U.criarUsuario({ email: "target-rollback@example.test", nome: "Pessoa QA", nivel: "leitura", senha: SENHA });
    assert.ok(owner.ok && target.ok);
    const actor = { userId: owner.usuario.id, email: owner.usuario.email };
    const session = await U.abrirSessao(target.usuario.id, "127.0.0.1");
    await dbmod.query(`CREATE FUNCTION fail_management_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event IN ('admin_usuario_nivel','admin_usuario_desativado','admin_usuario_ativado') THEN RAISE EXCEPTION 'simulated management audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_management_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_management_audit();`);
    await assert.rejects(U.alterarNivel(target.usuario.id, "total", "spoofed", actor), /simulated management audit failure/);
    assert.equal((await dbmod.query("SELECT nivel FROM admin_users WHERE id=$1", [target.usuario.id])).rows[0].nivel, "leitura");
    await assert.rejects(U.definirAtivo(target.usuario.id, false, "spoofed", actor), /simulated management audit failure/);
    assert.ok(await U.sessaoPorToken(session.token));
    await dbmod.query("DROP TRIGGER fail_management_audit ON audit_log");
    assert.deepEqual(await U.definirAtivo(target.usuario.id, false, "spoofed", actor), { ok: true });
    assert.equal(await U.sessaoPorToken(session.token), null);
    await dbmod.query("CREATE TRIGGER fail_management_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_management_audit()");
    await assert.rejects(U.definirAtivo(target.usuario.id, true, "spoofed", actor), /simulated management audit failure/);
    assert.equal((await dbmod.query("SELECT ativo FROM admin_users WHERE id=$1", [target.usuario.id])).rows[0].ativo, false);
    await dbmod.query("DROP TRIGGER fail_management_audit ON audit_log");
    assert.deepEqual(await U.definirAtivo(target.usuario.id, true, "spoofed", actor), { ok: true });
    assert.equal(await U.sessaoPorToken(session.token), null);
    const events = (await dbmod.query("SELECT data FROM audit_log WHERE event IN ('admin_usuario_desativado','admin_usuario_ativado') ORDER BY id")).rows.map(r => JSON.parse(r.data));
    assert.equal(events.length, 2);
    for (const event of events) { assert.equal(event.por, actor.email); assert.equal(event.userId, actor.userId); }
    assert.ok((await dbmod.verifyAuditChain()).ok);
  } finally { await dbmod._closeDbForTests(); }
});

test("redefinições concorrentes do mesmo link só consomem o token uma vez", async () => {
  const { U, dbmod } = await um();
  try {
    const user = await U.criarUsuario({ email: "reset-race@example.org", nome: "Pessoa Teste", nivel: "edicao", senha: SENHA });
    assert.ok(user.ok);
    let text = "";
    await U.pedirReset(user.usuario.email, { origin: "https://site.test", enviar: async m => { text = m.text; } });
    const token = /token=([A-Za-z0-9_-]+)/.exec(text)![1];
    const results = await Promise.all([U.redefinirSenha(token, "Primeira-Nova-Forte-11"), U.redefinirSenha(token, "Segunda-Nova-Forte-22")]);
    assert.equal(results.filter(r => r.ok).length, 1);
    assert.equal(results.filter(r => !r.ok && r.erro === "token_invalido").length, 1);
    const password = results[0].ok ? "Primeira-Nova-Forte-11" : "Segunda-Nova-Forte-22";
    assert.ok((await U.autenticar(user.usuario.email, password)).ok);
    assert.equal((await dbmod.query("SELECT count(*)::int n FROM audit_log WHERE event='admin_senha_redefinida'")).rows[0].n, 1);
  } finally { await dbmod._closeDbForTests(); }
});

test("troca de senha revoga sessões e links; falha na auditoria reverte toda a operação", async () => {
  const { U, dbmod } = await um();
  try {
    const user = await U.criarUsuario({ email: "atomic@example.org", nome: "Pessoa Atômica", nivel: "leitura", senha: SENHA });
    assert.ok(user.ok);
    const session1 = await U.abrirSessao(user.usuario.id, "127.0.0.1");
    const session2 = await U.abrirSessao(user.usuario.id, "127.0.0.2");
    let text = "";
    await U.pedirReset(user.usuario.email, { origin: "https://site.test", enviar: async m => { text = m.text; } });
    const reset = /token=([A-Za-z0-9_-]+)/.exec(text)![1];
    await dbmod.query(`CREATE FUNCTION fail_password_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='admin_senha_trocada' THEN RAISE EXCEPTION 'simulated audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_password_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_password_audit();`);
    await assert.rejects(U.trocarMinhaSenha(user.usuario.id, SENHA, "Nova-Protecao-Forte-123"), /simulated audit failure/);
    assert.ok((await U.autenticar(user.usuario.email, SENHA)).ok);
    assert.ok(await U.sessaoPorToken(session1.token));
    assert.equal((await dbmod.query("SELECT usado FROM admin_reset")).rows[0].usado, false);
    await dbmod.query("DROP TRIGGER fail_password_audit ON audit_log");
    assert.deepEqual(await U.trocarMinhaSenha(user.usuario.id, SENHA, "Nova-Protecao-Forte-123"), { ok: true });
    assert.equal(await U.sessaoPorToken(session1.token), null);
    assert.equal(await U.sessaoPorToken(session2.token), null);
    assert.deepEqual(await U.redefinirSenha(reset, "Outra-Nova-Senha-456"), { ok: false, erro: "token_invalido" });
    assert.ok((await dbmod.verifyAuditChain()).ok);
  } finally { await dbmod._closeDbForTests(); }
});

test("criação de usuário e autoria são atômicas; falha de auditoria não deixa conta", async () => {
  const { U, dbmod } = await um();
  try {
    const owner = await U.criarUsuario({ email: "owner-atomic@example.test", nome: "Dono QA", nivel: "total", senha: SENHA });
    assert.ok(owner.ok);
    const actor = { userId: owner.usuario.id, email: owner.usuario.email };
    await dbmod.query(`CREATE FUNCTION fail_create_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='admin_usuario_criado' THEN RAISE EXCEPTION 'simulated creation audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_create_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_create_audit();`);
    const request = { email: "new-atomic@example.test", nome: "Pessoa QA", nivel: "edicao" as const, senha: SENHA, actor, por: "ignored-spoof@example.test" };
    await assert.rejects(U.criarUsuario(request), /simulated creation audit failure/);
    assert.equal((await dbmod.query("SELECT count(*)::int n FROM admin_users WHERE email=$1", [request.email])).rows[0].n, 0);
    await dbmod.query("DROP TRIGGER fail_create_audit ON audit_log");
    const created = await U.criarUsuario(request); assert.ok(created.ok);
    const event = (await dbmod.query("SELECT data FROM audit_log WHERE event='admin_usuario_criado' ORDER BY id DESC LIMIT 1")).rows[0].data;
    const detail = typeof event === "string" ? JSON.parse(event) : event;
    assert.equal(detail.id, created.usuario.id); assert.equal(detail.userId, actor.userId); assert.equal(detail.por, actor.email);
    assert.ok(!JSON.stringify(detail).includes(SENHA)); assert.ok(!JSON.stringify(detail).includes("scrypt"));
    assert.deepEqual(await U.criarUsuario(request), { ok: false, erro: "email_ja_existe" });
    assert.ok((await dbmod.verifyAuditChain()).ok);
  } finally { await dbmod._closeDbForTests(); }
});

test("criação administrativa confere novamente conta, nível, atividade e autoria", async () => {
  const { U, dbmod } = await um();
  try {
    const owner = await U.criarUsuario({ email: "current-owner@example.test", nome: "Dono QA", nivel: "total", senha: SENHA }); assert.ok(owner.ok);
    const actor = { userId: owner.usuario.id, email: owner.usuario.email };
    const create = (a: typeof actor) => U.criarUsuario({ email: "forbidden-new@example.test", nome: "Pessoa QA", nivel: "leitura", senha: SENHA, actor: a });
    for (const invalid of [{ ...actor, userId: 0 }, { ...actor, userId: 2147483648 }, { ...actor, email: "another@example.test" }]) assert.deepEqual(await create(invalid), { ok: false, erro: "nao_autorizado" });
    await dbmod.query("UPDATE admin_users SET nivel='edicao' WHERE id=$1", [actor.userId]);
    assert.deepEqual(await create(actor), { ok: false, erro: "nao_autorizado" });
    await dbmod.query("UPDATE admin_users SET nivel='total', ativo=false WHERE id=$1", [actor.userId]);
    assert.deepEqual(await create(actor), { ok: false, erro: "nao_autorizado" });
    assert.equal((await dbmod.query("SELECT count(*)::int n FROM admin_users")).rows[0].n, 1);
    assert.equal((await dbmod.query("SELECT count(*)::int n FROM audit_log WHERE event='admin_usuario_criado'")).rows[0].n, 1);
  } finally { await dbmod._closeDbForTests(); }
});

test("criações simultâneas com mesmo e-mail deixam uma conta e uma auditoria", async () => {
  const { U, dbmod } = await um();
  try {
    const owner = await U.criarUsuario({ email: "concurrent-owner@example.test", nome: "Dono QA", nivel: "total", senha: SENHA }); assert.ok(owner.ok);
    const request = { email: "concurrent-new@example.test", nome: "Pessoa QA", nivel: "leitura" as const, senha: SENHA, actor: { userId: owner.usuario.id, email: owner.usuario.email } };
    const results = await Promise.all([U.criarUsuario(request), U.criarUsuario(request)]);
    assert.equal(results.filter(r => r.ok).length, 1);
    assert.equal(results.filter(r => !r.ok && r.erro === "email_ja_existe").length, 1);
    assert.equal((await dbmod.query("SELECT count(*)::int n FROM admin_users WHERE email=$1", [request.email])).rows[0].n, 1);
    assert.equal((await dbmod.query("SELECT count(*)::int n FROM audit_log WHERE event='admin_usuario_criado'")).rows[0].n, 2);
    assert.ok((await dbmod.verifyAuditChain()).ok);
  } finally { await dbmod._closeDbForTests(); }
});
