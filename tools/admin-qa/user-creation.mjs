// Local compiled HTTP, real sessions, fictitious data, development mail only.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL ?? "http://missing"), database = new URL(process.env.DATABASE_URL ?? "http://missing");
assert.equal(base.hostname, "127.0.0.1"); assert.equal(base.port, "3033");
assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "54346");
assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.equal(process.env.MAIL_PROVIDERS, "dev");
assert.equal(process.env.PREVIEW_MODE, "1"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0");
const dm = await import("../../site/src/lib/db.ts"), um = await import("../../site/src/lib/admin-users.ts");
const db = dm.default ?? dm, U = um.default ?? um;
assert.equal((await db.query("SELECT 1 FROM admin_users UNION ALL SELECT 1 FROM signatures UNION ALL SELECT 1 FROM mail_outbox")).rowCount, 0);
const sessions = [], results = [];
try {
  for (const status of ["confirmed", "pending"]) await db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,created_at,status) VALUES($1,$2,$3,$4,'apoiador','QA','2026-10-01T10:00:00Z','2026-10-01T10:00:00Z',$5)", [`QA ${status}`, `qa-${status}@example.test`, `QA-email-${status}`, `QA-cpf-${status}`, status]);
  const proof = async () => (await db.query("SELECT row_to_json(s)::text raw FROM signatures s ORDER BY id")).rows;
  const before = await proof();
  const owner = await U.criarUsuario({ email: "qa-http-owner@example.test", nome: "Dono QA", nivel: "total", senha: "QA-Account-Compiled-2026" }); assert.ok(owner.ok);
  const token = (await U.abrirSessao(owner.usuario.id, "127.0.0.1")).token; sessions.push(token);
  const post = (cookie, email, origin = base.origin) => fetch(new URL("/api/admin/usuarios", base), { method: "POST", redirect: "manual", headers: { cookie: `adm=${cookie}`, origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ acao: "criar", email, nome: "Pessoa QA", nivel: "leitura" }) });
  const target = "qa-http-new@example.test";
  assert.equal((await post("", target)).status, 401);
  assert.equal((await post(token, target)).status, 403); // step-up is required.
  const session = await U.sessaoPorToken(token); assert.ok(session);
  await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE id=$1", [session.sessaoId]);
  assert.equal((await post(token, target, "https://elsewhere.example.test")).status, 403);
  const invalid = await post(token, "invalid"); assert.equal(invalid.status, 303);
  assert.equal(new URL(invalid.headers.get("location")).searchParams.get("erro"), "email_invalido");
  const mails = async () => (await db.query("SELECT count(*)::int n FROM mail_outbox")).rows[0].n;
  const beforeMail = await mails();
  await db.query("CREATE FUNCTION qa_fail_user_creation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='admin_usuario_criado' THEN RAISE EXCEPTION 'QA expected account audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_user_creation BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_fail_user_creation()");
  try {
    assert.equal((await post(token, target)).status, 500);
    assert.equal((await db.query("SELECT 1 FROM admin_users WHERE email=$1", [target])).rowCount, 0);
    assert.equal((await db.query("SELECT 1 FROM admin_reset")).rowCount, 0);
    assert.equal(await mails(), beforeMail);
  } finally { await db.query("DROP TRIGGER qa_fail_user_creation ON audit_log; DROP FUNCTION qa_fail_user_creation()"); }
  const created = await post(token, target); assert.equal(created.status, 303);
  assert.equal(new URL(created.headers.get("location")).searchParams.get("msg"), "criado");
  const newUser = (await db.query("SELECT id,trocar_senha FROM admin_users WHERE email=$1", [target])).rows[0]; assert.ok(newUser?.trocar_senha);
  assert.equal((await db.query("SELECT 1 FROM admin_reset WHERE user_id=$1", [newUser.id])).rowCount, 1);
  const event = JSON.parse((await db.query("SELECT data FROM audit_log WHERE event='admin_usuario_criado' ORDER BY id DESC LIMIT 1")).rows[0].data);
  assert.equal(event.userId, owner.usuario.id); assert.equal(event.id, newUser.id); assert.equal(event.por, owner.usuario.email);
  const duplicate = await post(token, target); assert.equal(duplicate.status, 303);
  assert.equal(new URL(duplicate.headers.get("location")).searchParams.get("erro"), "email_ja_existe");
  assert.equal((await db.query("SELECT 1 FROM admin_reset WHERE user_id=$1", [newUser.id])).rowCount, 1);
  const manage = (acao, extra = {}) => fetch(new URL("/api/admin/usuarios", base), { method: "POST", redirect: "manual", headers: { cookie: `adm=${token}`, origin: base.origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ acao, id: String(newUser.id), ...extra }) });
  const targetSession = (await U.abrirSessao(newUser.id, "127.0.0.2")).token; sessions.push(targetSession);
  await db.query("CREATE FUNCTION qa_fail_user_management() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event IN ('admin_usuario_nivel','admin_usuario_desativado') THEN RAISE EXCEPTION 'QA expected management audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_user_management BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_fail_user_management()");
  try {
    assert.equal((await manage("nivel", { nivel: "edicao" })).status, 500);
    assert.equal((await db.query("SELECT nivel FROM admin_users WHERE id=$1", [newUser.id])).rows[0].nivel, "leitura");
    assert.equal((await manage("desativar")).status, 500);
    assert.ok(await U.sessaoPorToken(targetSession));
  } finally { await db.query("DROP TRIGGER qa_fail_user_management ON audit_log; DROP FUNCTION qa_fail_user_management()"); }
  const changed = await manage("nivel", { nivel: "edicao" }); assert.equal(changed.status, 303);
  assert.equal(new URL(changed.headers.get("location")).searchParams.get("msg"), "nivel");
  assert.equal((await U.sessaoPorToken(targetSession)).nivel, "edicao");
  assert.equal((await manage("desativar")).status, 303);
  assert.equal(await U.sessaoPorToken(targetSession), null);
  assert.equal((await manage("ativar")).status, 303);
  assert.equal(await U.sessaoPorToken(targetSession), null);
  assert.equal((await manage("redefinir")).status, 303);
  const managementEvents = (await db.query("SELECT data FROM audit_log WHERE event IN ('admin_usuario_nivel','admin_usuario_desativado','admin_usuario_ativado','admin_reset_reservado') ORDER BY id")).rows.map(r => JSON.parse(r.data));
  assert.equal(managementEvents.length, 5);
  for (const data of managementEvents) { assert.equal(data.userId, owner.usuario.id); assert.equal(data.por, owner.usuario.email); }
  await db.query("UPDATE admin_users SET nivel='leitura' WHERE id=$1", [owner.usuario.id]);
  assert.equal((await post(token, "qa-blocked@example.test")).status, 403);
  const revokedSnapshot = (await db.query("SELECT row_to_json(u)::text raw FROM admin_users u ORDER BY id")).rows;
  const resetCount = (await db.query("SELECT count(*)::int n FROM admin_reset")).rows[0].n;
  for (const action of ["nivel", "ativar", "desativar", "redefinir"]) assert.equal((await manage(action, { nivel: "total" })).status, 403);
  assert.deepEqual((await db.query("SELECT row_to_json(u)::text raw FROM admin_users u ORDER BY id")).rows, revokedSnapshot);
  assert.equal((await db.query("SELECT count(*)::int n FROM admin_reset")).rows[0].n, resetCount);
  assert.equal((await db.query("SELECT 1 FROM admin_users")).rowCount, 2);
  assert.deepEqual(await proof(), before); assert.ok((await db.verifyAuditChain()).ok);
  results.push({ compiledHttp: true, stepupAndOrigin: true, auditFailureRollback: true, noInvitationOnFailure: true, redirectPreserved: true, namedAudit: true, noDuplicateInvitation: true, managementRollback: true, sessionRevocation: true, managementAndResetNamedAudit: true, revokedRoleRejected: true, signaturesPreserved: true, developmentMailOnly: true });
} finally { for (const token of sessions) await U.encerrarSessao(token); await db._closeDbForTests(); }
assert.ok(process.env.QA_OUTPUT_DIR); await mkdir(process.env.QA_OUTPUT_DIR, { recursive: true });
await writeFile(`${process.env.QA_OUTPUT_DIR}/user-creation.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
