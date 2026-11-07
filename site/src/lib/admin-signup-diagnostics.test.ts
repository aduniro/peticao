import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

(process.env as Record<string, string>).NODE_ENV = "test";
delete process.env.ADMIN_NO_PASSWORD;
delete process.env.PREVIEW_MODE;

test("diagnostics require the current editing role and expose contact only when explicitly requested", async () => {
  const db = await import("./db");
  await db._openForTests("t_admin_signup_diagnostics");
  const U = await import("./admin-users");
  const { ADMIN_COOKIE } = await import("./admin");
  const { NextRequest } = await import("next/server");
  const { GET } = await import("../app/api/admin/diagnosticos/assinaturas/route");
  const D = await import("./signup-diagnostics");
  const request = (token = "", query = "") => new NextRequest(`http://localhost/api/admin/diagnosticos/assinaturas${query}`, {
    headers: { host: "localhost", cookie: `${ADMIN_COOKIE}=${token}` },
  });
  try {
    const reader = await U.criarUsuario({ email: "qa-reader@example.test", nome: "QA Reader", nivel: "leitura", senha: "QA-Diagnostics-Strong-2026" });
    const editor = await U.criarUsuario({ email: "qa-editor@example.test", nome: "QA Editor", nivel: "edicao", senha: "QA-Diagnostics-Strong-2026" });
    assert.ok(reader.ok && editor.ok);
    const readToken = (await U.abrirSessao(reader.usuario.id, "127.0.0.1")).token;
    const editToken = (await U.abrirSessao(editor.usuario.id, "127.0.0.1")).token;
    assert.equal((await GET(request())).status, 401);
    assert.equal((await GET(request(readToken))).status, 403);
    await D.withSignupDiagnostics(randomUUID(), { consent: true, email: "qa-contact@example.test", category: "apoiador" }, async () => ({ status: 422, json: {} }), null);
    const technical = await GET(request(editToken));
    assert.equal(technical.status, 200);
    assert.match(technical.headers.get("cache-control") ?? "", /no-store/);
    const metadata = await technical.json();
    assert.equal(metadata.total, 1);
    assert.equal(metadata.partialFormValuesCollected, false);
    assert.equal(metadata.identityValuesCollected, false);
    assert.ok(!JSON.stringify(metadata).includes("qa-contact@example.test"));
    assert.equal((await (await GET(request(editToken, "?emails=1"))).json()).records[0].email, "qa-contact@example.test");
    for (const query of ["?limit=101", "?offset=-1", "?emails=true", "?unexpected=1"]) assert.equal((await GET(request(editToken, query))).status, 400, query);
    await db.query("UPDATE admin_users SET nivel='leitura' WHERE id=$1", [editor.usuario.id]);
    assert.equal((await GET(request(editToken, "?emails=1"))).status, 403);
    await db.query("UPDATE admin_users SET ativo=false WHERE id=$1", [editor.usuario.id]);
    assert.equal((await GET(request(editToken))).status, 401);
    assert.equal((await db.query("SELECT 1 FROM signatures UNION ALL SELECT 1 FROM mail_outbox")).rowCount, 0);
  } finally {
    await db._closeDbForTests();
  }
});
