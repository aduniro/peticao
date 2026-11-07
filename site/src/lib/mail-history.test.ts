import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
delete process.env.PREVIEW_MODE;
delete process.env.ADMIN_NO_PASSWORD;
async function setup() {
  const db = await import("./db"); await db._openForTests("t_mail_history");
  return { db, A: await import("./mail/archive"), H: await import("./mail/history") };
}
const input = (to = "qa-history@example.test") => ({ to, subject: "SECRET_SUBJECT", text: "SECRET_TOKEN", html: "<p>SECRET_HTML</p>" });
const deadline = () => new Date(Date.now() + 3600000);

test("histórico une mensagens e tentativas legadas sem inventar conteúdo, entrega ou duplicar logs vinculados", async () => {
  const c = await setup(); try {
    const m = await c.A.prepareMessage(input(), "confirmacao", "transactional", { requestKey: "SECRET_REQUEST", archive: { until: deadline() } });
    const attempt = await c.A.beginAttempt(m.id, "dev", "qa-sender@example.test"); assert.ok(attempt.ok);
    assert.ok((await c.A.finishAttempt(attempt.id, "accepted", { providerId: "qa-provider-id" })).ok);
    await c.db.query("INSERT INTO mail_log(kind,provider,to_addr,status,error) VALUES('confirmacao','dev',$1,'failed','SECRET_ERROR'),('confirmacao','dev',$1,'sent',NULL),('confirmacao','dev',$1,'queued',NULL)", [input().to]);
    const snapshot = async () => (await c.db.query("SELECT row_to_json(m) data FROM mail_messages m UNION ALL SELECT row_to_json(l) FROM mail_log l UNION ALL SELECT row_to_json(a) FROM audit_log a")).rows;
    const before = await snapshot();
    const all = await c.H.mailHistory(); assert.ok(all.ok); assert.equal(all.records.length, 4);
    assert.equal(all.records.filter(r => r.source === "message").length, 1);
    assert.deepEqual(all.records.filter(r => r.source === "legacy_attempt").map(r => r.status).sort(), ["accepted", "indeterminate", "queued"]);
    const detail = await c.H.mailHistoryDetail(`message:${m.id}`); assert.ok(detail.ok); assert.equal(detail.source, "message");
    assert.equal(detail.attempts.length, 1); assert.equal(detail.attempts[0].provider_id, "qa-provider-id");
    for (const row of all.records.filter(r => r.source === "legacy_attempt")) {
      const legacy = await c.H.mailHistoryDetail(row.record_key); assert.ok(legacy.ok); assert.equal(legacy.source, "legacy_attempt");
      assert.equal(legacy.content_state, "unavailable"); assert.deepEqual(legacy.attempts, []);
    }
    const serialized = JSON.stringify({ all, detail });
    for (const forbidden of ["SECRET_SUBJECT", "SECRET_TOKEN", "SECRET_HTML", "SECRET_ERROR", "SECRET_REQUEST", "request_key", "content_cipher", "content_fingerprint", "payload"]) assert.ok(!serialized.includes(forbidden), forbidden);
    assert.deepEqual(await snapshot(), before);
    assert.ok((await c.db.verifyAuditChain()).ok);
  } finally { await c.db._closeDbForTests(); }
});

test("paginação conserva microssegundos e desempate; filtros são exatos e consultas não expiram conteúdo por escrita", async () => {
  const c = await setup(); try {
    const keys: string[] = [];
    for (let i = 0; i < 5; i++) {
      const m = await c.A.prepareMessage(input(i === 4 ? "other@example.test" : undefined), "confirmacao", "transactional", { archive: { until: deadline() } });
      keys.push(`message:${m.id}`);
      await c.db.query("UPDATE mail_messages SET created_at=$2::timestamptz,content_expires_at=now()-interval '1 second' WHERE id=$1", [m.id, `2026-11-06T10:00:00.${i < 3 ? "123999" : "123001"}Z`]);
    }
    await c.db.query("INSERT INTO mail_log(kind,provider,to_addr,status,ts) VALUES('confirmacao','dev',$1,'sent','2026-11-06T10:00:00.123999Z')", [input().to]);
    const seen: string[] = []; let cursor: string | undefined;
    do {
      const page = await c.H.mailHistory({ limit: 2, before: cursor, recipient: "QA-HISTORY@EXAMPLE.TEST" }); assert.ok(page.ok);
      assert.ok(page.records.every(r => r.content_state !== "stored")); seen.push(...page.records.map(r => r.record_key)); cursor = page.next ?? undefined;
    } while (cursor);
    assert.equal(seen.length, 5); assert.equal(new Set(seen).size, 5); assert.ok(!seen.includes(keys[4]));
    assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_messages WHERE content_state='stored' AND content_cipher IS NOT NULL")).rows[0].n, 5);
    const empty = await c.H.mailHistory({ recipient: "%@example.test' OR true--" }); assert.ok(empty.ok); assert.equal(empty.records.length, 0);
    const accepted = await c.H.mailHistory({ status: "accepted", channel: "transactional", kind: "confirmacao" }); assert.ok(accepted.ok); assert.equal(accepted.records.length, 1);
    const missing = await c.H.mailHistoryDetail(`message:${randomUUID()}`); assert.ok(!missing.ok); assert.equal(missing.error, "not_found");
  } finally { await c.db._closeDbForTests(); }
});

test("entradas inválidas são recusadas; detalhe limita tentativas e sinaliza truncamento", async () => {
  const c = await setup(); try {
    for (const options of [{ limit: 0 }, { limit: 51 }, { limit: 1.1 }, { before: "!" }, { before: "a".repeat(401) }, { recipient: "" }, { recipient: "a\nb" }, { kind: "' OR true--" }, { status: "delivered" }, { channel: "wrong" }]) assert.equal((await c.H.mailHistory(options)).ok, false);
    for (const at of ["0000-01-01T00:00:00.000000Z", "2026-02-31T00:00:00.000000Z", "2026-11-06T00:00:00.000Z", "2026-11-06T00:00:00.000000Z' OR true--"]) {
      const before = Buffer.from(JSON.stringify({ at, key: `message:${randomUUID()}` })).toString("base64url");
      assert.equal((await c.H.mailHistory({ before })).ok, false);
    }
    for (const id of [null, "", "legacy:0", "legacy:2147483648", `message:${randomUUID()}'`, "legacy:1 OR true"]) assert.equal((await c.H.mailHistoryDetail(id)).ok, false);
    const m = await c.A.prepareMessage(input(), "confirmacao", "transactional");
    await c.db.query("INSERT INTO mail_message_attempts(id,message_id,provider,from_addr,state) SELECT md5(i::text)::uuid,$1,'dev','qa-sender@example.test','rejected' FROM generate_series(1,101) i", [m.id]);
    const detail = await c.H.mailHistoryDetail(`message:${m.id}`); assert.ok(detail.ok); assert.equal(detail.attempts.length, 100); assert.equal(detail.attempts_truncated, true);
  } finally { await c.db._closeDbForTests(); }
});

test("rota de metadados exige Edição, respeita revogação/origem e nunca libera conteúdo bruto", async () => {
  const c = await setup(); try {
    const U = await import("./admin-users"), { ADMIN_COOKIE } = await import("./admin");
    const { NextRequest } = await import("next/server"), { GET } = await import("../app/api/admin/emails/mensagens/route");
    const m = await c.A.prepareMessage(input(), "confirmacao", "transactional", { archive: { until: deadline() } });
    const request = (token?: string, query = "", origin = "http://localhost") => new NextRequest(`http://localhost/api/admin/emails/mensagens${query}`, { headers: { host: "localhost", origin, cookie: token ? `${ADMIN_COOKIE}=${token}` : "" } });
    assert.equal((await GET(request())).status, 401);
    for (const nivel of U.NIVEIS) {
      const user = await U.criarUsuario({ email: `qa-history-${nivel}@example.test`, nome: "QA História", nivel, senha: "Uma-Senha-Forte-2026" }); assert.ok(user.ok);
      const session = await U.abrirSessao(user.usuario.id, "127.0.0.1");
      const response = await GET(request(session.token, `?id=message:${m.id}`));
      assert.equal(response.status, nivel === "leitura" ? 403 : 200);
      if (response.status === 200) {
        assert.equal(response.headers.get("cache-control"), "no-store"); assert.ok(!(await response.text()).includes("SECRET_"));
        for (const q of ["?id=message:x", "?id=legacy:2147483647", "?limit=51", "?limit=2&limit=3", `?id=message:${m.id}&limit=2`, "?content=1", "?limit=0x20"]) {
          assert.equal((await GET(request(session.token, q))).status, q.includes("2147483647") ? 404 : 400);
        }
        assert.equal((await GET(request(session.token, "", "https://foreign.example"))).status, 403);
      }
      await c.db.query("UPDATE admin_users SET ativo=false WHERE id=$1", [user.usuario.id]);
      assert.equal((await GET(request(session.token))).status, 401);
    }
    assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_message_attempts")).rows[0].n, 0);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM signatures")).rows[0].n, 0);
  } finally { await c.db._closeDbForTests(); }
});
