import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
delete process.env.PREVIEW_MODE;
delete process.env.ADMIN_NO_PASSWORD;

test("convites e resets administrativos não anunciam envio em fila, quota ou falha após reserva", async () => {
  const db = await import("./db");
  await db._openForTests("t_admin_invitation_outcomes");
  const U = await import("./admin-users");
  const { POST } = await import("../app/api/admin/usuarios/route");
  const { NextRequest } = await import("next/server");
  const { waitForBackgroundMail } = await import("./mail");
  const previous = process.env.MAIL_PROVIDERS;
  process.env.MAIL_PROVIDERS = "dev";
  try {
    const owner = await U.criarUsuario({ email: "owner-outcomes@example.test", nome: "QA Dono", nivel: "total", senha: "QA-Senha-8" });
    assert.ok(owner.ok);
    const session = await U.abrirSessao(owner.usuario.id, "127.0.0.1");
    await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes'");
    const post = async (data: Record<string, string>) => {
      const form = new FormData();
      for (const [k, v] of Object.entries(data)) form.set(k, v);
      const response = await POST(new NextRequest("http://localhost/api/admin/usuarios", { method: "POST", headers: { host: "localhost", origin: "http://localhost", cookie: `adm=${session.token}` }, body: form }));
      assert.equal(response.status, 303);
      return new URL(response.headers.get("location")!).search;
    };
    const create = (email: string) => post({ acao: "criar", email, nome: "QA Pessoa", nivel: "leitura" });
    const user = async (email: string) => (await db.query<{ id: number }>("SELECT id FROM admin_users WHERE email=$1", [email])).rows[0];
    const reset = (id: number) => post({ acao: "redefinir", id: String(id) });

    assert.equal(await create("sent-outcomes@example.test"), "?msg=criado");
    const sent = await user("sent-outcomes@example.test");
    assert.equal(await reset(sent.id), "?msg=link_enviado");
    await waitForBackgroundMail();

    // A quota rejection reserves no additional token and must not claim delivery.
    await U.pedirReset("sent-outcomes@example.test", { origin: "http://localhost", enviar: async () => "sent" });
    const count = async () => (await db.query<{ n: number }>("SELECT count(*)::int n FROM admin_reset WHERE user_id=$1", [sent.id])).rows[0].n;
    assert.equal(await count(), 3);
    assert.equal(await reset(sent.id), "?erro=email_incerto");
    assert.equal(await count(), 3);

    // Failure after the account commit cannot undo creation or imply successful transport.
    await db.query("CREATE FUNCTION qa_invite_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='admin_convite_enviado' THEN RAISE EXCEPTION 'QA expected audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_invite_audit_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_invite_audit_failure()");
    try {
      assert.equal(await create("uncertain-outcomes@example.test"), "?erro=email_incerto");
      assert.ok(await user("uncertain-outcomes@example.test"));
      assert.equal(await create("uncertain-outcomes@example.test"), "?erro=email_ja_existe");
    } finally { await db.query("DROP TRIGGER qa_invite_audit_failure ON audit_log; DROP FUNCTION qa_invite_audit_failure()"); }
    await waitForBackgroundMail();

    // An unknown fictional adapter has no network implementation; the real outbox queues it.
    process.env.MAIL_PROVIDERS = "qa-no-transport";
    assert.equal(await create("queued-outcomes@example.test"), "?msg=email_fila");
    const queued = await user("queued-outcomes@example.test");
    assert.equal(await reset(queued.id), "?msg=email_fila");
    assert.equal((await db.query<{ n: number }>("SELECT count(*)::int n FROM mail_outbox WHERE to_addr='queued-outcomes@example.test'")).rows[0].n, 2);
    assert.equal((await db.query("SELECT 1 FROM signatures")).rowCount, 0);
    assert.ok(await U.sessaoPorToken(session.token));
  } finally {
    await waitForBackgroundMail();
    if (previous === undefined) delete process.env.MAIL_PROVIDERS; else process.env.MAIL_PROVIDERS = previous;
    await db._closeDbForTests();
  }
});
