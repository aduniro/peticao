import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
delete process.env.PREVIEW_MODE;
delete process.env.ADMIN_NO_PASSWORD;
const PASSWORD = "Uma-Senha-Forte-2026";
async function setup() {
  const db = await import("./db"); await db._openForTests("t_settings_domains");
  const U = await import("./admin-users"), I = await import("./institutional");
  I._clearDomainCache();
  const created = await U.criarUsuario({ email: "admin-actions@example.test", nome: "QA Administradora", nivel: "total", senha: PASSWORD });
  assert.ok(created.ok);
  const session = await U.abrirSessao(created.usuario.id, "127.0.0.1");
  const { NextRequest } = await import("next/server");
  const request = (path: string, body?: FormData | string, token: string | null = session.token, origin = "http://localhost") => new NextRequest(`http://localhost${path}`, { method: body === undefined ? "GET" : "POST", headers: { host: "localhost", origin, cookie: token ? `adm=${token}` : "", ...(typeof body === "string" ? { "content-type": "application/json" } : {}) }, body });
  return { db, U, I, user: created.usuario, request };
}

test("preferências: gravação e autor são atômicos; API permite somente chaves booleanas e nível Total", async () => {
  const c = await setup();
  try {
    const { POST, GET } = await import("../app/api/admin/configuracoes/route");
    const path = "/api/admin/configuracoes", payload = JSON.stringify({ chave: "popupEstado", valor: false, por: "forged@example.test" });
    assert.equal((await POST(c.request(path, payload, null))).status, 401);
    const reader = await c.U.criarUsuario({ email: "reader-settings@example.test", nome: "QA Leitura", nivel: "leitura", senha: PASSWORD }); assert.ok(reader.ok);
    const token = (await c.U.abrirSessao(reader.usuario.id, "127.0.0.1")).token;
    assert.equal((await GET(c.request(path, undefined, token))).status, 200);
    assert.equal((await POST(c.request(path, payload, token))).status, 403);
    assert.equal((await POST(c.request(path, payload, undefined, "https://other.example"))).status, 403);
    for (const chave of ["__proto__", "toString", "sending_enabled", "admin_password"]) assert.equal((await POST(c.request(path, JSON.stringify({ chave, valor: false })))).status, 400);
    assert.equal((await POST(c.request(path, JSON.stringify({ chave: "popupEstado", valor: "false" })))).status, 400);
    await c.db.query(`CREATE FUNCTION fail_panel_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='painel_config' THEN RAISE EXCEPTION 'panel audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_panel_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_panel_audit();`);
    await assert.rejects(POST(c.request(path, payload)), /panel audit failure/);
    assert.equal((await c.db.query("SELECT value FROM settings WHERE key='painel_popup_estado'")).rowCount, 0);
    await c.db.query("DROP TRIGGER fail_panel_audit ON audit_log");
    assert.equal((await POST(c.request(path, payload))).status, 200);
    assert.equal((await c.db.query("SELECT value FROM settings WHERE key='painel_popup_estado'")).rows[0].value, "0");
    const audit = JSON.parse((await c.db.query("SELECT data FROM audit_log WHERE event='painel_config'")).rows[0].data);
    assert.equal(audit.por, c.user.email);
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

async function signers(c: Awaited<ReturnType<typeof setup>>) {
  for (const [index, email] of ["pessoa@atomic-college.example", "estudante@alunos.atomic-college.example"].entries()) {
    await c.db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,status,created_at,confirmed_at,seq,verify_code) VALUES($1,$2,$3,$4,'apoiador','fixture','2026-10-01T10:00:00Z','confirmed','2026-10-01T10:00:00Z','2026-10-01T10:10:00Z',$5,$6)", [`Pessoa Fictícia ${index}`, email, `email-fixture-${index}`, `cpf-fixture-${index}`, index + 1, `ABCDEF${index}`]);
  }
}
const preserved = (rows: Record<string, unknown>[]) => rows.map(({ email_domain_kind, email_domain, email_institution, ...original }) => original);

test("curadoria: falha na auditoria ou metadados reverte domínio e assinantes sem poluir cache", async () => {
  const c = await setup();
  try {
    await signers(c);
    const before = (await c.db.query("SELECT * FROM signatures ORDER BY id")).rows;
    assert.equal(await c.I.institutionalKind("pessoa@atomic-college.example"), null);
    await c.db.query(`CREATE FUNCTION fail_domain_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='domain_approved' THEN RAISE EXCEPTION 'domain audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_domain_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_domain_audit();`);
    const decide = () => c.I.decideDomain("atomic-college.example", "approved", { kind: "ifes", institution: "Instituição Fictícia", by: c.user.email });
    await assert.rejects(decide(), /domain audit failure/);
    assert.equal((await c.db.query("SELECT 1 FROM institutional_domains WHERE domain='atomic-college.example'")).rowCount, 0);
    assert.deepEqual((await c.db.query("SELECT * FROM signatures ORDER BY id")).rows, before);
    assert.equal(await c.I.institutionalKind("pessoa@atomic-college.example"), null);
    await c.db.query("DROP TRIGGER fail_domain_audit ON audit_log");
    await c.db.query(`CREATE FUNCTION fail_domain_signer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.email LIKE 'estudante@%' THEN RAISE EXCEPTION 'signer metadata failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_domain_signer BEFORE UPDATE ON signatures FOR EACH ROW EXECUTE FUNCTION fail_domain_signer();`);
    await assert.rejects(decide(), /signer metadata failure/);
    assert.deepEqual((await c.db.query("SELECT * FROM signatures ORDER BY id")).rows, before);
    assert.equal((await c.db.query("SELECT 1 FROM institutional_domains WHERE domain='atomic-college.example'")).rowCount, 0);
    await c.db.query("DROP TRIGGER fail_domain_signer ON signatures");
    assert.equal(await decide(), 2);
    const after = (await c.db.query("SELECT * FROM signatures ORDER BY id")).rows;
    assert.deepEqual(preserved(after), preserved(before));
    assert.deepEqual(after.map(row => row.email_domain_kind), ["ifes", "discente"]);
    assert.ok(after.every(row => row.email_institution === "Instituição Fictícia"));
    assert.equal(await c.I.institutionalKind("pessoa@atomic-college.example"), "ifes");
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { c.I._clearDomainCache(); await c.db._closeDbForTests(); }
});

test("rota de domínios usa o ator real e não aceita propriedades herdadas como tipo", async () => {
  const c = await setup();
  try {
    const { POST } = await import("../app/api/admin/dominios/route");
    const body = (kind: string, domain = "actor-college.example") => { const form = new FormData(); for (const [key, value] of Object.entries({ action: "approve", domain, kind, by: "forged@example.test" })) form.set(key, value); return form; };
    assert.equal((await POST(c.request("/api/admin/dominios", body("ifes"), null))).status, 401);
    for (const kind of ["__proto__", "constructor", "toString"]) {
      const domain = `actor-${kind.replace(/_/g, "x").toLowerCase()}.example`;
      const response = await POST(c.request("/api/admin/dominios", body(kind, domain)));
      assert.equal(response.status, 303);
      const row = (await c.db.query("SELECT kind,decided_by FROM institutional_domains WHERE domain=$1", [domain])).rows[0];
      assert.deepEqual(row, { kind: "outro", decided_by: c.user.email });
    }
    const reader = await c.U.criarUsuario({ email: "domain-reader@example.test", nome: "QA Leitura", nivel: "leitura", senha: PASSWORD }); assert.ok(reader.ok);
    const readerToken = (await c.U.abrirSessao(reader.usuario.id, "127.0.0.1")).token;
    assert.equal((await POST(c.request("/api/admin/dominios", body("ifes"), readerToken))).status, 403);
    const editor = await c.U.criarUsuario({ email: "domain-editor@example.test", nome: "QA Edição", nivel: "edicao", senha: PASSWORD }); assert.ok(editor.ok);
    const editorToken = (await c.U.abrirSessao(editor.usuario.id, "127.0.0.1")).token;
    assert.equal((await POST(c.request("/api/admin/dominios", body("ifes"), editorToken))).status, 303);
    assert.equal((await c.db.query("SELECT decided_by FROM institutional_domains WHERE domain='actor-college.example'")).rows[0].decided_by, editor.usuario.email);
    const logs = (await c.db.query("SELECT data FROM audit_log WHERE event='domain_approved'")).rows;
    assert.deepEqual(new Set(logs.map(row => JSON.parse(row.data).by)), new Set([c.user.email, editor.usuario.email]));
  } finally { c.I._clearDomainCache(); await c.db._closeDbForTests(); }
});


test("decisões simultâneas sobre domínio e subdomínio deixam metadados coerentes com o classificador", async () => {
  const c = await setup();
  try {
    await signers(c);
    const before = (await c.db.query("SELECT * FROM signatures ORDER BY id")).rows;
    await Promise.all([
      c.I.decideDomain("atomic-college.example", "approved", { kind: "ifes", institution: "Instituição Fictícia", by: c.user.email }),
      c.I.decideDomain("alunos.atomic-college.example", "approved", { kind: "municipal", institution: "Subdomínio Fictício", by: c.user.email }),
    ]);
    const after = (await c.db.query("SELECT * FROM signatures ORDER BY id")).rows;
    assert.deepEqual(preserved(after), preserved(before));
    for (const signer of after) {
      assert.equal(signer.email_domain_kind, await c.I.institutionalKind(signer.email));
      assert.equal(signer.email_institution, (await c.I.institutionInfo(signer.email)).institution);
    }
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { c.I._clearDomainCache(); await c.db._closeDbForTests(); }
});
