import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
process.env.MAIL_PROVIDERS = "dev";
process.env.APP_URL = "http://localhost:3000";
process.env.SECRETS_DIR = "/not-a-real-subscriber-secret-directory";

test("subscriber authentication, recovery and exact corrections (isolated)", async t => {
  const db = await import("./db"), a = await import("./subscriber-access");
  const { hmac, sha256 } = await import("./security");
  const route = await import("../app/api/assinante/[action]/route");
  await db._openForTests("t_subscriber_access");
  const ctx = { ip: "192.0.2.10" }, mails: import("./mail").Mail[] = [];
  const send = async (m: import("./mail").Mail) => { mails.push(m); };
  const invokeEnroll = a.subscriberEnroll, invokeForgot = a.subscriberForgot;
  async function enroll(email: unknown, context = ctx, deliver = send) {
    const result = await invokeEnroll(email, context, deliver); await a._waitSubscriberDeliveriesForTests(); return result;
  }
  async function forgot(email: unknown, context = ctx, deliver = send) {
    const result = await invokeForgot(email, context, deliver); await a._waitSubscriberDeliveriesForTests(); return result;
  }
  const initial = () => mails.at(-1)!.text.match(/senha inicial: ([A-Za-z0-9]{16})/)![1];
  const linkToken = () => mails.at(-1)!.text.match(/#token=([A-Za-z0-9_-]{43})/)![1];
  const bad = (code: string) => (e: unknown) => e instanceof a.SubscriberError && e.code === code;
  async function fixture(status = "confirmed") {
    return (await db.query(`INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,status,created_at,confirmed_at,seq,verify_code,city,uf,cpf_name_check,identity_method)
      VALUES('João de Exemplo Silva','titular@example.org',$1,$2,'apoiador','fixture','2026-01-01T01:00:00Z',$3,'2026-01-01T00:00:00Z','2026-01-01T02:00:00Z',101,'TESTCODE','Porto Velho','RO','match','nascimento') RETURNING *`, [hmac("titular@example.org"), hmac("52998224725"), status])).rows[0];
  }
  async function clean() { await db.query("TRUNCATE signatures RESTART IDENTITY CASCADE"); await db.query("TRUNCATE subscriber_rate_limits"); mails.length = 0; }
  async function enrolled() {
    const row = await fixture(); await enroll(row.email, ctx, send); const password = initial();
    const login = await a.subscriberLogin({ mode: "email", email: row.email, password }, ctx);
    return { row, password, token: login.token };
  }
  async function request(action: string, body: unknown, token?: string, origin = "http://localhost:3000") {
    return route.POST(new NextRequest(`http://localhost:3000/api/assinante/${action}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(token ? { Cookie: `${a.SUBSCRIBER_COOKIE}=${token}` } : {}) }, body: JSON.stringify(body) }), { params: { action } });
  }
  try {
    await t.test("disabled does not initialize schema", async () => {
      delete process.env.SUBSCRIBER_ACCESS_ENABLED;
      assert.equal((await request("enroll", { email: "titular@example.org" })).status, 404);
      assert.equal((await db.getPool().query("SELECT to_regclass('subscriber_credentials') t")).rows[0].t, null);
      assert.deepEqual(await a.purgeSubscriberAccess(), { subscriber_sessions: 0, subscriber_enrollment: 0, subscriber_tokens: 0, subscriber_rate_limits: 0, subscriber_events: 0 });
      assert.equal((await db.getPool().query("SELECT to_regclass('subscriber_credentials') t")).rows[0].t, null);
      await assert.rejects(enroll("x@example.org", ctx, send), bad("disabled"));
    });
    process.env.SUBSCRIBER_ACCESS_ENABLED = "1"; await a.ensureSubscriberSchema();
    await t.test("initial issuance only once, hash-only persistence, fixed URL", async () => {
      await clean(); const row = await fixture(); const result = await enroll(row.email, ctx, send), pwd = initial();
      assert.equal(mails[0].to, row.email); assert.match(mails[0].text, /http:\/\/localhost:3000\/minha-assinatura\n/);
      const cred = (await db.query("SELECT * FROM subscriber_credentials")).rows[0];
      assert.match(cred.password_hash, /^scrypt\$/); assert.ok(!JSON.stringify(cred).includes(pwd));
      assert.deepEqual(await enroll(row.email, ctx, async () => { throw new Error("must not send"); }), result);
      assert.equal(mails.length, 1); assert.equal((await db.query("SELECT password_hash FROM subscriber_credentials")).rows[0].password_hash, cred.password_hash);
      assert.equal((await db.query("SELECT count(*)::int n FROM mail_outbox")).rows[0].n, 0);
    });
    await t.test("unknown/pending/WhatsApp-only email never gets credentials", async () => {
      await clean(); const row = await fixture("pending"); const unknown = await enroll("unknown@example.org", ctx, send);
      assert.deepEqual(await enroll(row.email, ctx, send), unknown);
      await db.query("UPDATE signatures SET status='confirmed',wa_confirmed_at=now()");
      assert.deepEqual(await enroll(row.email, ctx, send), unknown);
      assert.equal(mails.length, 0); assert.equal((await db.query("SELECT count(*)::int n FROM subscriber_credentials")).rows[0].n, 0);
    });
    await t.test("delivery failure permits retry without persistent plaintext", async () => {
      await clean(); const row = await fixture();
      await enroll(row.email, ctx, async () => { throw new Error("mail fixture failure"); });
      assert.equal((await db.query("SELECT count(*)::int n FROM subscriber_credentials")).rows[0].n, 0);
      await enroll(row.email, ctx, send); assert.equal(mails.length, 1);
    });
    await t.test("concurrent initial requests issue one password", async () => {
      await clean(); const row = await fixture();
      await Promise.all([enroll(row.email, ctx, send), enroll(row.email, { ip: "192.0.2.11" }, send)]);
      assert.equal(mails.length, 1); assert.equal((await db.query("SELECT count(*)::int n FROM subscriber_credentials")).rows[0].n, 1);
    });
    await t.test("email or normalized name+CPF uses same password, never biography", async () => {
      await clean(); const { row, password } = await enrolled();
      const login = await a.subscriberLogin({ mode: "cpf", name: "JOAO EXEMPLO SILVA", cpf: "529.982.247-25", password }, ctx);
      const me = await a.subscriberMe(login.token); assert.equal(me.signature?.id, row.id);
      await assert.rejects(a.subscriberLogin({ mode: "cpf", name: "Outro Nome Silva", cpf: "52998224725", password }, ctx), bad("credentials"));
      await assert.rejects(a.subscriberLogin({ mode: "cpf", name: row.name, cpf: "52998224725", password: "01/01/1980" }, ctx), bad("credentials"));
      await assert.rejects(a.subscriberLogin({ mode: "cpf", name: row.name, cpf: "529982247251", password }, ctx), bad("credentials"));
      assert.deepEqual(await a.subscriberMe("public-cartaz-token"), { authenticated: false }); assert.ok(!JSON.stringify(me).includes("52998224725"));
    });
    await t.test("API cookie is dedicated and secret absent from response; CSRF blocked", async () => {
      await clean(); const { row, password } = await enrolled(); const res = await request("login", { email: row.email, password });
      assert.equal(res.status, 200); assert.deepEqual(await res.json(), { ok: true });
      assert.match(res.headers.get("set-cookie")!, /peticao_assinante=.*HttpOnly.*SameSite=strict/i);
      assert.equal((await request("login", { email: row.email, password }, undefined, "https://evil.example")).status, 403);
      assert.equal((await request("change", { id: row.id })).status, 401);
    });
    await t.test("request stream is rejected above eight KiB, regardless of length header", async () => {
      const chunks = [new Uint8Array(5000).fill(32), new Uint8Array(5000).fill(32)];
      let position = 0;
      const body = new ReadableStream<Uint8Array>({ pull(controller) { if (position < chunks.length) controller.enqueue(chunks[position++]); else controller.close(); } });
      const req = new NextRequest("http://localhost:3000/api/assinante/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000", "Content-Length": "2" }, body, duplex: "half" } as ConstructorParameters<typeof NextRequest>[1]);
      const response = await route.POST(req, { params: { action: "login" } });
      assert.equal(response.status, 413);
    });
    await t.test("original-name alias remains usable without live CPF cache after name correction", async () => {
      await clean(); const { row, password } = await enrolled();
      await db.query("UPDATE signatures SET name='João de Exemplo Santos' WHERE id=$1", [row.id]);
      const login = await a.subscriberLogin({ mode: "cpf", name: row.name, cpf: "52998224725", password }, ctx);
      assert.equal((await a.subscriberMe(login.token)).authenticated, true);
      assert.equal((await db.query("SELECT count(*)::int n FROM cpf_lookup_cache")).rows[0].n, 0);
    });
    await t.test("reset GET does not consume, old password remains until completion", async () => {
      await clean(); const { row, password, token } = await enrolled(); await forgot(row.email, ctx, send); const reset = linkToken();
      const stored = (await db.query("SELECT * FROM subscriber_tokens")).rows[0]; assert.equal(stored.token_hash, sha256(reset)); assert.ok(!JSON.stringify(stored).includes(reset));
      assert.equal((await route.GET(new NextRequest(`http://localhost:3000/api/assinante/reset?token=${reset}`), { params: { action: "reset" } })).status, 404);
      await a.subscriberLogin({ email: row.email, password }, ctx); assert.equal((await a.subscriberMe(token)).authenticated, true);
      const next = "Uma frase de teste longa!"; await a.subscriberReset(reset, next, next, ctx);
      assert.equal((await a.subscriberMe(token)).authenticated, false);
      await assert.rejects(a.subscriberLogin({ email: row.email, password }, ctx), bad("credentials"));
      await a.subscriberLogin({ email: row.email, password: next }, ctx);
      await assert.rejects(a.subscriberReset(reset, next, next, ctx), bad("token_invalid"));
    });
    await t.test("parallel reset tokens: exactly one winner", async () => {
      await clean(); const { row } = await enrolled(); await forgot(row.email, ctx, send); const first = linkToken(); await forgot(row.email, ctx, send); const second = linkToken();
      const results = await Promise.allSettled([a.subscriberReset(first, "Nova frase segura primeira", "Nova frase segura primeira", ctx), a.subscriberReset(second, "Nova frase segura segunda", "Nova frase segura segunda", { ip: "192.0.2.99" })]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal((await db.query("SELECT count(*)::int n FROM subscriber_tokens WHERE used_at IS NULL")).rows[0].n, 0);
    });
    await t.test("expired/reset wrong-purpose and weak password rejected", async () => {
      await clean(); const { row, token } = await enrolled(); await forgot(row.email, ctx, send); const reset = linkToken();
      await assert.rejects(a.subscriberReset(reset, "curta", "curta", ctx), bad("password_length"));
      await assert.rejects(a.subscriberReset(reset, "Esta frase é longa", "Outra frase é longa", ctx), bad("password_mismatch"));
      await assert.rejects(a.subscriberConfirmChange(token, reset, ctx), bad("token_invalid"));
      await db.query("UPDATE subscriber_tokens SET expires_at=now()-interval '1 second'");
      await assert.rejects(a.subscriberReset(reset, "Uma frase suficientemente longa", "Uma frase suficientemente longa", ctx), bad("token_invalid"));
    });
    await t.test("optional password change revokes old sessions and resends never rotate it", async () => {
      await clean(); const { row, token, password } = await enrolled(); const next = "Senha opcional sem vencimento";
      await a.subscriberPassword(token, next, next, ctx); assert.equal((await a.subscriberMe(token)).authenticated, false);
      await enroll(row.email, ctx, send); assert.equal(mails.length, 1);
      await a.subscriberLogin({ email: row.email, password: next }, ctx); await assert.rejects(a.subscriberLogin({ email: row.email, password }, ctx), bad("credentials"));
    });
    await t.test("institutional email confirmation remains factual after an identity challenge", async () => {
      await clean(); await fixture();
      await db.query("UPDATE signatures SET email='titular@unir.br',email_domain_kind='ifes',identity_method='nascimento'");
      await enroll("titular@unir.br", ctx, send);
      const login = await a.subscriberLogin({ email: "titular@unir.br", password: initial() }, ctx);
      assert.equal((await a.subscriberMe(login.token)).signature?.institutionalEmailVerified, true);
      await db.query("UPDATE signatures SET wa_confirmed_at=now()");
      assert.equal((await a.subscriberMe(login.token)).authenticated, false);
    });
    await t.test("stale authentication still reads but cannot edit", async () => {
      await clean(); const { token } = await enrolled(); await db.query("UPDATE subscriber_sessions SET authenticated_at=now()-interval '11 minutes'");
      await assert.rejects(a.subscriberPassword(token, "Frase suficientemente longa", "Frase suficientemente longa", ctx), bad("authentication_required")); assert.equal((await a.subscriberMe(token)).authenticated, true);
    });
    await t.test("professional correction confirms pending exact data, immutable original fields", async () => {
      await clean(); const { row, token } = await enrolled(); const me = await a.subscriberMe(token);
      await a.subscriberChange(token, { revision: me.revision, category: "servidor", institution: "UNIR", role: "docente", campus: "Porto Velho", campusIbge: 1100205, regionDeclared: true }, ctx, send); await a._waitSubscriberDeliveriesForTests(); const change = linkToken();
      assert.equal((await db.query("SELECT category FROM signatures")).rows[0].category, "apoiador"); assert.match(mails.at(-1)!.text, /category: servidor/);
      await assert.rejects(a.subscriberConfirmChange("not-a-session", change, ctx), bad("authentication_required"));
      await a.subscriberConfirmChange(token, change, ctx); const changed = (await db.query("SELECT * FROM signatures")).rows[0];
      assert.equal(changed.category, "servidor"); assert.equal(changed.region_validated, true);
      for (const key of ["id", "seq", "name", "email", "email_hash", "cpf_hash", "created_at", "confirmed_at", "consent_at", "cpf_name_check", "identity_method"]) assert.deepEqual(changed[key], row[key], key);
      assert.equal((await a.subscriberMe(token)).signature?.institutionalEmailVerified, false);
      await assert.rejects(a.subscriberConfirmChange(token, change, ctx), bad("token_invalid"));
      const history = (await db.query("SELECT detail FROM subscriber_events WHERE event='signature_changed'")).rows[0].detail; assert.equal(history.before.category, "apoiador"); assert.equal(history.after.category, "servidor");
    });
    await t.test("cannot smuggle forbidden fields or invalid geography", async () => {
      await clean(); const { token } = await enrolled(); const me = await a.subscriberMe(token);
      for (const key of ["cpf", "email", "name", "id", "confirmed_at"]) {
        await assert.rejects(a.subscriberChange(token, { revision: me.revision, category: "apoiador", city: "Porto Velho", uf: "RO", [key]: "evil" }, ctx, send), bad("unsupported_change")); await db.query("TRUNCATE subscriber_rate_limits");
      }
      await assert.rejects(a.subscriberChange(token, { revision: me.revision, category: "apoiador", city: "Cidade Inexistente X", uf: "RO" }, ctx, send), bad("invalid_change"));
      await assert.rejects(a.subscriberChange(token, { revision: me.revision, category: "estrangeiro", country: "PT", university: "Universidade Fictícia" }, ctx, send), bad("category_change"));
    });
    await t.test("stale source cannot receive a formerly authorized change", async () => {
      await clean(); const { row, token } = await enrolled(); const me = await a.subscriberMe(token);
      await a.subscriberChange(token, { revision: me.revision, category: "apoiador", city: "Guajará-Mirim", uf: "RO" }, ctx, send); await a._waitSubscriberDeliveriesForTests(); const change = linkToken();
      await db.query("UPDATE signatures SET city='Outra cidade' WHERE id=$1", [row.id]);
      await assert.rejects(a.subscriberConfirmChange(token, change, ctx), bad("stale")); assert.equal((await db.query("SELECT city FROM signatures")).rows[0].city, "Outra cidade");
    });
    await t.test("failed confirmation delivery preserves signature and invalidates pending token", async () => {
      await clean(); const { token } = await enrolled(); const me = await a.subscriberMe(token);
      const result = await a.subscriberChange(token, { revision: me.revision, category: "apoiador", city: "Guajará-Mirim", uf: "RO" }, ctx, async () => { throw new Error("mail failure"); });
      assert.equal(result.ok, true); await a._waitSubscriberDeliveriesForTests();
      assert.equal((await db.query("SELECT city FROM signatures")).rows[0].city, "Porto Velho"); assert.equal((await db.query("SELECT count(*)::int n FROM subscriber_tokens WHERE used_at IS NULL")).rows[0].n, 0);
    });
    await t.test("profile validator cannot be bypassed by public browser fields", async () => {
      const { validate, validateSubscriberProfile } = await import("./signatures");
      const raw = { name: "João de Exemplo Silva", email: "titular@example.org", category: "apoiador", city: "Porto Velho", uf: "RO", consent: true, authenticatedCpfHash: "a".repeat(64), skipCpf: true };
      const publicResult = validate(raw);
      assert.equal(publicResult.ok, false);
      if (!publicResult.ok) assert.equal(publicResult.errors.cpf, "cpf_invalid");
      assert.equal(validateSubscriberProfile(raw, "bad-hash").ok, false);
      const internalResult = validateSubscriberProfile(raw, "a".repeat(64));
      assert.equal(internalResult.ok, true);
      if (internalResult.ok) assert.equal(internalResult.value.cpf, undefined);
    });
    await t.test("cleanup works while disabled, keeps change provenance and active credential", async () => {
      await clean(); const { token, row } = await enrolled();
      await db.query("UPDATE subscriber_sessions SET expires_at=now()-interval '1 minute'");
      await db.query("UPDATE subscriber_rate_limits SET started_at=now()-interval '25 hours'");
      await db.query("INSERT INTO subscriber_tokens(token_hash,signature_id,purpose,credential_version,expires_at) VALUES($1,$2,'password_reset',1,now()-interval '1 minute')", [sha256("expired-test-token"), row.id]);
      await db.query("INSERT INTO subscriber_events(signature_id,event,at) VALUES($1,'signature_changed',now()-interval '31 days'),($1,'login_failed',now()-interval '31 days')", [row.id]);
      delete process.env.SUBSCRIBER_ACCESS_ENABLED;
      const result = await a.purgeSubscriberAccess();
      assert.equal(result.subscriber_sessions, 1); assert.equal(result.subscriber_tokens, 1);
      assert.ok(result.subscriber_rate_limits > 0); assert.equal(result.subscriber_events, 1);
      assert.equal((await db.query("SELECT count(*)::int n FROM subscriber_events WHERE event='signature_changed'")).rows[0].n, 1);
      assert.equal((await db.query("SELECT count(*)::int n FROM subscriber_credentials")).rows[0].n, 1);
      process.env.SUBSCRIBER_ACCESS_ENABLED = "1";
      assert.equal((await a.subscriberMe(token)).authenticated, false);
    });
    await t.test("reset token is invalid after an administrative email change", async () => {
      await clean(); const { row } = await enrolled(); await forgot(row.email, ctx, send); const reset = linkToken();
      await db.query("UPDATE signatures SET email='changed@example.org' WHERE id=$1", [row.id]);
      await assert.rejects(a.subscriberReset(reset, "Uma frase de teste longa!", "Uma frase de teste longa!", ctx), bad("token_invalid"));
    });
    await t.test("administrative channel change invalidates old credentials and sessions without unsafe bootstrap", async () => {
      await clean(); const { row, password, token } = await enrolled();
      await db.query("UPDATE signatures SET email='newowner@example.org' WHERE id=$1", [row.id]);
      assert.deepEqual(await a.subscriberMe(token), { authenticated: false });
      await assert.rejects(a.subscriberLogin({ email: "newowner@example.org", password }, ctx), bad("credentials"));
      const before = mails.length;
      await enroll("newowner@example.org", ctx, send); await forgot("newowner@example.org", ctx, send);
      assert.equal(mails.length, before, "changed channel requires assisted revocation instead of automatic ownership transfer");
      await db.query("UPDATE signatures SET email=$2,cpf_hash=$3 WHERE id=$1", [row.id,row.email,hmac("11144477735")]);
      await assert.rejects(a.subscriberLogin({ email: row.email, password }, ctx), bad("credentials"));
    });
    await t.test("queued reset never sends to an obsolete administrative email", async () => {
      await clean(); const { row } = await enrolled();
      const releases: (() => void)[] = []; let calls = 0, releasing = false;
      const hanging = async () => { calls++; if (!releasing) await new Promise<void>(resolve => releases.push(resolve)); };
      // Distinct additional credentialed fixtures avoid per-address rate caps.
      for (let i = 1; i <= 4; i++) {
        const extra = (await db.query(`INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,status,created_at,confirmed_at,seq,verify_code)
          SELECT name,$1,$2,$3,category,text_version,consent_at,status,created_at,confirmed_at,$4,$5 FROM signatures WHERE id=$6 RETURNING *`, [`queued${i}@example.org`, hmac("queuedmail"+i), hmac("queuedcpf"+i), 400+i, "QCODE"+i, row.id])).rows[0];
        await db.query("INSERT INTO subscriber_credentials(signature_id,password_hash,initial_name,channel_revision) SELECT $1,password_hash,initial_name,$3 FROM subscriber_credentials WHERE signature_id=$2", [extra.id,row.id,a.subscriberChannelRevision(extra)]);
      }
      try {
      await Promise.all(Array.from({ length: 4 }, (_, i) => invokeForgot(`queued${i+1}@example.org`, { ip: `192.0.2.${120+i}` }, hanging)));
      for (let i = 0; i < 50 && calls < 4; i++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(calls, 4);
      const before = mails.length;
      await invokeForgot(row.email, ctx, send);
      assert.equal(a._subscriberDeliveryStateForTests().pending, 1);
      await db.query("UPDATE signatures SET email='changed@example.org' WHERE id=$1", [row.id]);
      for (const release of releases) release();
      await a._waitSubscriberDeliveriesForTests();
      assert.equal(mails.length, before, "queued email must not target the obsolete address");
      const token = (await db.query("SELECT * FROM subscriber_tokens WHERE signature_id=$1", [row.id])).rows[0];
      assert.notEqual(token.used_at, null);
      } finally { releasing = true; for (const release of releases) release(); await a._waitSubscriberDeliveriesForTests(); }
    });
    await t.test("slow unresolved mail cannot hold DB connections or spawn more than four workers", async () => {
      await clean(); const first = await fixture();
      for (let i = 1; i < 10; i++) await db.query(`INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,status,created_at,confirmed_at,seq,verify_code)
        SELECT name,$1,$2,$3,category,text_version,consent_at,status,created_at,confirmed_at,$4,$5 FROM signatures WHERE id=$6`, [`fixture${i}@example.org`, hmac("mail"+i), hmac("cpf"+i), 200+i, "CODE"+i, first.id]);
      const releases: (() => void)[] = []; let calls = 0, releasing = false;
      const hanging = async () => { calls++; if (!releasing) await new Promise<void>(resolve => releases.push(resolve)); };
      a._subscriberDeliveryStateForTests(60);
      try {
      const addresses = (await db.query("SELECT email FROM signatures ORDER BY id")).rows;
      const began = Date.now();
      await Promise.all(addresses.map((r, i) => invokeEnroll(r.email, { ip: `192.0.2.${100+i}` }, hanging)));
      assert.ok(Date.now()-began < 5000, "HTTP work does not await provider completion");
      await new Promise(resolve => setTimeout(resolve, 150));
      assert.equal(calls, 4); assert.equal(a._subscriberDeliveryStateForTests().active, 4);
      assert.equal(a._subscriberDeliveryStateForTests().pending, 6);
      assert.equal((await db.query("SELECT 1 AS n")).rows[0].n, 1);
      assert.equal((await db.query("SELECT count(*)::int n FROM subscriber_credentials")).rows[0].n, 0);
      releasing = true; for (const release of releases) release();
      await a._waitSubscriberDeliveriesForTests(); a._subscriberDeliveryStateForTests(30_000);
      const firstFailed = (await db.query("SELECT count(*)::int n FROM subscriber_enrollment WHERE state='failed'")).rows[0].n;
      assert.ok(firstFailed >= 4, "timed-out credentials cannot activate after late provider success");
      } finally { releasing = true; for (const release of releases) release(); await a._waitSubscriberDeliveriesForTests(); a._subscriberDeliveryStateForTests(30_000); }
    });
    await t.test("persistent IP+identifier limits avoid clear identifiers and recover after window", async () => {
      await clean(); await fixture();
      for (let i = 0; i < 3; i++) await enroll("unknown@example.org", { ip: `192.0.2.${i}` }, send);
      await assert.rejects(enroll("unknown@example.org", { ip: "192.0.2.200" }, send), bad("rate_limited"));
      const rates = (await db.query("SELECT * FROM subscriber_rate_limits")).rows; assert.ok(rates.length >= 4); assert.ok(!JSON.stringify(rates).includes("unknown@example.org")); assert.ok(!JSON.stringify(rates).includes("192.0.2"));
      await db.query("UPDATE subscriber_rate_limits SET started_at=now()-interval '61 minutes'"); await enroll("unknown@example.org", { ip: "192.0.2.200" }, send);
    });
  } finally { delete process.env.SUBSCRIBER_ACCESS_ENABLED; await db._closeDbForTests(); }
});
