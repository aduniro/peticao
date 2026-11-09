import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { renderMailPreview, redactPreviewText } from "./mail/preview-render";
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
delete process.env.PREVIEW_MODE; delete process.env.ADMIN_NO_PASSWORD;
const token = "qa_MixedSecret123456789012345678901234567890";
const mail = (html?: string) => ({ to: "qa-preview@example.test", subject: "QA mensagem", text: "Mensagem de teste", html });

test("prévia preserva formatação básica, mas elimina scripts, rede, formulários e atributos ativos", () => {
  const result = renderMailPreview(mail(`<html><head><style>@import 'https://tracking.test';</style></head><body style="background:#05382a"><table><tr><td colspan="2" style="color:#ffffff;padding:12px;background:url(https://track.test);position:fixed;--secret:${token};font-size:18px" onclick="alert(1)"><strong>Olá, José</strong><img src="https://track.test/pixel" onerror="alert(2)"><a href="javascript:alert(3)" ping="https://track.test">Continuar</a><form action="https://track.test"><input value="secret"><p>FORM_SECRET</p></form><iframe srcdoc="bad"></iframe><svg><script>SVG_SECRET</script></svg><math><mtext>MATH_SECRET</mtext></math><script>JS_SECRET</script></td></tr></table></body></html>`));
  assert.equal(result.state, "ready"); if (result.state !== "ready") return;
  assert.match(result.html, /<strong>Olá, José<\/strong>/); assert.match(result.html, /colspan="2"/); assert.match(result.html, /background:#05382a/);
  for (const bad of ["track.test", "tracking.test", "onclick", "onerror", "javascript:", "srcdoc", "<script", "<svg", "<math", "<form", "FORM_SECRET", "SVG_SECRET", "MATH_SECRET", "JS_SECRET", "position:fixed", "--secret", token]) assert.ok(!result.html.includes(bad), bad);
  assert.equal(result.omittedImages, 1); assert.ok(result.transformed); assert.ok(result.html.includes("Content-Security-Policy"));
});

test("máscaras atravessam entidades, elementos inline e caracteres invisíveis sem revelar links, códigos e CPF", () => {
  const result = renderMailPreview({ ...mail(`<p>Código <b>12&#51;</b><i>456</i></p><p>h&#116;tps://private.test/confirmar?token=${token}</p><p>qa_&#77;ixedSecret123456789012345678901234567890</p><p>1&nbsp;2&nbsp;3&nbsp;4&nbsp;5&nbsp;6</p><p>ABCDE-FGHJK</p>`), text: `https://private.test/${token} 123456 ABCDEFGHJK 123.456.789-01`, subject: `QA ${token}` });
  assert.equal(result.state, "ready"); if (result.state !== "ready") return;
  const all = JSON.stringify(result); for (const bad of ["private.test", "123456", token, "ABCDE-FGHJK", "ABCDEFGHIJK", "123.456.789-01"]) assert.ok(!all.includes(bad), bad);
  assert.ok(result.html.includes("[restrito]")); assert.equal(redactPreviewText(`ab\u200bcd${token}`), "[restrito]");
});

test("HTML malformado/foreign content é reemitido sem ativos; texto e metadados não viram HTML bruto", () => {
  const result = renderMailPreview({ ...mail(`<svg><foreignObject><p onmouseover=alert(1)>bad</p></foreignObject></svg><math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(2)>"></math><p>&lt;script&gt;alert(3)&lt;/script&gt;</p>`), attachments: [{ filename: `../../${token}.pdf`, content: Buffer.from("RAW_ATTACHMENT_SECRET") }] });
  assert.equal(result.state, "ready"); if (result.state !== "ready") return;
  assert.ok(!/<(?:img|script|svg|math|iframe|object|embed|form)\b/i.test(result.html)); assert.ok(!/\son\w+=/i.test(result.html));
  assert.ok(!JSON.stringify(result).includes("RAW_ATTACHMENT_SECRET")); assert.ok(!JSON.stringify(result).includes(token)); assert.equal(result.attachments[0].bytes, 21);
  const plain = renderMailPreview(mail()); assert.equal(plain.state, "ready"); if (plain.state === "ready") assert.match(plain.html, /<pre>Mensagem de teste<\/pre>/);
});

test("prévia recusa tamanho/profundidade excessivos e limita metadados de anexos sem alterar o original", () => {
  for (const html of ["a".repeat(256 * 1024 + 1), "<div>".repeat(81) + "QA" + "</div>".repeat(81), "<br>".repeat(4001)]) assert.equal(renderMailPreview(mail(html)).state, "limited");
  const input = { ...mail("<p>QA</p>"), attachments: Array.from({ length: 101 }, () => ({ filename: "fixture.pdf", content: Buffer.from([0, 255]) })) };
  const before = structuredClone(input); const result = renderMailPreview(input); assert.equal(result.state, "ready"); if (result.state !== "ready") return;
  assert.equal(result.attachments.length, 100); assert.equal(result.attachmentsTruncated, true); assert.deepEqual(input.attachments.map(a => [...a.content]), before.attachments.map(a => [...a.content]));
});

async function setup() { const db = await import("./db"); await db._openForTests("t_mail_preview"); return { db, A: await import("./mail/archive"), P: await import("./mail/preview") }; }
const actor = { email: "qa-owner@example.test", userId: 7 };
const archive = () => ({ archive: { until: new Date(Date.now() + 3600000) } });
test("prévia só revela versão transformada e registra acesso sem gravar conteúdo ou alterar mensagem", async () => {
  const c = await setup(); try {
    const m = await c.A.prepareMessage({ ...mail(`<p>QA <a href="https://private.test/${token}">Confirmar</a></p>`), text: token }, "confirmacao", "transactional", archive());
    const snapshot = async () => (await c.db.query("SELECT * FROM mail_messages WHERE id=$1", [m.id])).rows[0]; const before = await snapshot();
    const result = await c.P.mailPreview(m.id, actor); assert.ok(result.ok); assert.equal(result.state, "ready"); assert.ok(!JSON.stringify(result).includes(token)); assert.deepEqual(await snapshot(), before);
    const logs = (await c.db.query("SELECT data FROM audit_log WHERE event='mail_message_preview'")).rows; assert.equal(logs.length, 1); const data = JSON.parse(logs[0].data); assert.equal(data.por, actor.email); assert.equal(data.messageId, m.id);
    assert.ok(!logs[0].data.includes(token)); assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("autenticação fica restrita; indisponibilidade, expiração e adulteração não liberam conteúdo", async () => {
  const c = await setup(); try {
    for (const kind of ["admin_stepup", "admin-reset", "admin_convite", "nova_senha"]) {
      const m = await c.A.prepareMessage(mail(`<p>SECRET_${kind}</p>`), kind, "transactional", archive());
      assert.deepEqual(await c.P.mailPreview(m.id, actor), { ok: true, state: "restricted" });
    }
    const missing = await c.A.prepareMessage(mail(), "confirmacao", "transactional"); assert.equal((await c.P.mailPreview(missing.id, actor)).state, "unavailable");
    const expired = await c.A.prepareMessage(mail(), "confirmacao", "transactional", archive()); await c.db.query("UPDATE mail_messages SET content_expires_at=now()-interval '1 second' WHERE id=$1", [expired.id]);
    assert.equal((await c.P.mailPreview(expired.id, actor)).state, "expired");
    const bad = await c.A.prepareMessage(mail(), "confirmacao", "transactional", archive()); await c.db.query("UPDATE mail_messages SET content_cipher='bad' WHERE id=$1", [bad.id]);
    assert.equal((await c.P.mailPreview(bad.id, actor)).state, "unreadable");
    assert.equal((await c.P.mailPreview(randomUUID(), actor)).ok, false); assert.equal((await c.P.mailPreview("bad", actor)).ok, false);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM audit_log WHERE event='mail_message_preview'")).rows[0].n, 0);
  } finally { await c.db._closeDbForTests(); }
});

test("falha de auditoria impede retornar a prévia e preserva o arquivo", async () => {
  const c = await setup(); try {
    const m = await c.A.prepareMessage(mail("<p>QA</p>"), "confirmacao", "transactional", archive());
    await c.db.query("CREATE FUNCTION fail_preview_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='mail_message_preview' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_preview_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_preview_audit()");
    await assert.rejects(c.P.mailPreview(m.id, actor)); assert.equal((await c.A.archivedContent(m.id)).state, "stored"); assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("HTTP da prévia exige Total e confirmação extra antes de descriptografar, e audita o autor real", async () => {
  const c = await setup(); try {
    const U = await import("./admin-users"), { ADMIN_COOKIE } = await import("./admin"), { NextRequest } = await import("next/server"), { GET } = await import("../app/api/admin/emails/mensagens/previa/route");
    const m = await c.A.prepareMessage(mail("<p>QA</p>"), "confirmacao", "transactional", archive());
    const req = (token?: string, query = `?id=${m.id}`, origin = "http://localhost") => new NextRequest(`http://localhost/api/admin/emails/mensagens/previa${query}`, { headers: { host: "localhost", origin, cookie: token ? `${ADMIN_COOKIE}=${token}` : "" } });
    assert.equal((await GET(req())).status, 401); let owner;
    for (const nivel of U.NIVEIS) {
      const created = await U.criarUsuario({ email: `qa-preview-${nivel}@example.test`, nome: "QA Prévia", nivel, senha: "Uma-Senha-Forte-2026" }); assert.ok(created.ok);
      const session = await U.abrirSessao(created.usuario.id, "127.0.0.1"); assert.equal((await GET(req(session.token))).status, 403);
      if (nivel === "total") owner = { user: created.usuario, session };
    }
    assert.ok(owner); assert.equal((await c.db.query("SELECT count(*)::int n FROM audit_log WHERE event='mail_message_preview'")).rows[0].n, 0);
    const texts: string[] = [], s = (await U.sessaoPorToken(owner.session.token))!;
    await U.pedirStepup(s, async m => { texts.push(m.text); }); const code = /\b\d{6}\b/.exec(texts[0])![0]; assert.ok((await U.confirmarStepup(s, "Uma-Senha-Forte-2026", code)).ok);
    assert.equal((await GET(req(owner.session.token, undefined, "https://other.example"))).status, 403);
    const response = await GET(req(owner.session.token)); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await response.json()).state, "ready");
    assert.equal(JSON.parse((await c.db.query("SELECT data FROM audit_log WHERE event='mail_message_preview' ORDER BY id DESC LIMIT 1")).rows[0].data).por, owner.user.email);
    for (const query of ["", "?id=bad", `?id=${m.id}&id=${m.id}`, `?id=${m.id}&por=forged@example.test`]) assert.equal((await GET(req(owner.session.token, query))).status, 400);
    await c.db.query("UPDATE admin_sessions SET stepup_ate=now()-interval '1 second' WHERE id=$1", [s.sessaoId]); assert.equal((await GET(req(owner.session.token))).status, 403);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM signatures")).rows[0].n, 0); assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_outbox")).rows[0].n, 0);
  } finally { await c.db._closeDbForTests(); }
});
