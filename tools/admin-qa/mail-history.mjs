// Compiled HTTP metadata contract, only on the isolated fictitious local preview.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL ?? "http://127.0.0.1:3032");
const database = new URL(process.env.DATABASE_URL ?? "http://missing");
assert.equal(base.hostname, "127.0.0.1"); assert.equal(base.port, "3032");
assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "54345"); assert.equal(database.pathname, "/peticao");
assert.equal(process.env.PREVIEW_MODE, "1"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0"); assert.equal(process.env.MAIL_PROVIDER, "dev");
const bootstrap = await fetch(new URL("/admin", base)); assert.equal(bootstrap.status, 200); assert.ok((await bootstrap.text()).includes("/dev/outbox"));
const dm = await import("../../site/src/lib/db.ts"), um = await import("../../site/src/lib/admin-users.ts"), am = await import("../../site/src/lib/mail/archive.ts");
const db = dm.default ?? dm, U = um.default ?? um, A = am.default ?? am;
const output = process.env.QA_OUTPUT_DIR; assert.ok(output); await mkdir(output, { recursive: true });
let token, readToken;
try {
  assert.equal((await db.query("SELECT count(*)::int n FROM mail_messages WHERE to_addr NOT LIKE '%@example.test'")).rows[0].n, 0);
  const signatures = async () => (await db.query("SELECT id,name,cpf_hash,email_hash,status,seq,created_at,confirmed_at FROM signatures ORDER BY id")).rows;
  const before = await signatures(), recipient = `qa-history-${randomUUID()}@example.test`;
  const message = await A.prepareMessage({ to: recipient, subject: "QA_SECRET_SUBJECT", text: "QA_SECRET_TOKEN" }, "confirmacao", "transactional", { archive: { until: new Date(Date.now() + 3600000) } });
  const attempt = await A.beginAttempt(message.id, "dev", "qa-sender@example.test"); assert.ok(attempt.ok);
  assert.ok((await A.finishAttempt(attempt.id, "accepted", { providerId: "qa-runtime-provider" })).ok);
  await db.query("INSERT INTO mail_log(kind,provider,to_addr,status,error) VALUES('confirmacao','dev',$1,'failed','QA_SECRET_ERROR')", [recipient]);
  const session = async nivel => {
    const email = `qa-mail-history-${nivel}@example.test`;
    let user = (await db.query("SELECT id,nivel FROM admin_users WHERE email=$1", [email])).rows[0];
    if (user) assert.equal(user.nivel, nivel);
    else { const created = await U.criarUsuario({ email, nome: "QA Histórico", nivel, senha: "QA-Local-Historico-2026-Ficticia" }); assert.ok(created.ok); user = created.usuario; }
    return (await U.abrirSessao(user.id, "127.0.0.1")).token;
  };
  token = await session("edicao"); readToken = await session("leitura");
  const mailSnapshot = async () => (await db.query("SELECT row_to_json(m) data FROM mail_messages m UNION ALL SELECT row_to_json(a) FROM mail_message_attempts a UNION ALL SELECT row_to_json(l) FROM mail_log l UNION ALL SELECT row_to_json(q) FROM mail_outbox q")).rows;
  const mailBefore = await mailSnapshot();
  const path = "/api/admin/emails/mensagens";
  const request = (query = "", auth = token) => fetch(new URL(path + query, base), { headers: { origin: base.origin, cookie: auth ? `adm=${auth}` : "" } });
  assert.equal((await request("", "")).status, 401); assert.equal((await request("", readToken)).status, 403);
  const list = await request(`?recipient=${recipient}&limit=1`); assert.equal(list.status, 200); assert.match(list.headers.get("cache-control") ?? "", /(^|,)\s*no-store\s*(,|$)/);
  const first = await list.json(); assert.ok(first.ok); assert.equal(first.records.length, 1); assert.ok(first.next);
  const second = await request(`?recipient=${recipient}&limit=1&before=${first.next}`); assert.equal(second.status, 200);
  const next = await second.json(); assert.equal(next.records.length, 1); assert.equal(next.next, null);
  assert.notEqual(first.records[0].record_key, next.records[0].record_key);
  const rows = [...first.records, ...next.records]; assert.equal(rows.filter(r => r.source === "message").length, 1);
  assert.equal(rows.find(r => r.source === "legacy_attempt").status, "indeterminate");
  const response = await request(`?id=message:${message.id}`); assert.equal(response.status, 200);
  const text = await response.text(); assert.ok(!text.includes("QA_SECRET")); assert.ok(!text.includes("content_cipher"));
  const detail = JSON.parse(text); assert.equal(detail.attempts.length, 1); assert.equal(detail.attempts[0].provider_id, "qa-runtime-provider");
  assert.equal((await request("?content=1")).status, 400); assert.equal((await request("?limit=0x20")).status, 400);
  assert.deepEqual(await signatures(), before); assert.deepEqual(await mailSnapshot(), mailBefore);
  const report = { ok: true, httpAuth: true, metadataOnly: true, legacyNotDuplicated: true, keysetPagination: true, attemptCorrelated: true, noSignerWrites: true, noMailSent: true };
  await writeFile(`${output}/mail-history.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { if (token) await U.encerrarSessao(token); if (readToken) await U.encerrarSessao(readToken); await db._closeDbForTests(); }
