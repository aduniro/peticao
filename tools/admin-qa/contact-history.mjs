// Protected metadata history, compiled local endpoint. No dispatch or user interface.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL), database = new URL(process.env.DATABASE_URL);
assert.equal(base.origin, "http://127.0.0.1:3033");
assert.equal(database.hostname, "127.0.0.1"); assert.equal(database.port, "54349");
assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.equal(process.env.MAIL_PROVIDERS, "dev");
assert.equal(process.env.PREVIEW_MODE, "1"); assert.equal(process.env.ADMIN_NO_PASSWORD, "0");
const dm = await import("../../site/src/lib/db.ts"), um = await import("../../site/src/lib/admin-users.ts");
const db = dm.default ?? dm, U = um.default ?? um;
const user = await U.criarUsuario({ email: "qa-contact-history@example.test", nome: "QA Histórico", nivel: "edicao", senha: "Ficticia-Historico-Compilado-2026!" }); assert.ok(user.ok);
const { token } = await U.abrirSessao(user.usuario.id, "127.0.0.1");
try {
  const contact = (await db.query("INSERT INTO contact_messages(name,email,kind,message,ip_hash,created_at) VALUES('QA','qa-original@example.test','duvida','QA received original','QA-HIDDEN-IP','2026-11-08T10:00:00.123456Z') RETURNING id")).rows[0].id;
  const job = (await db.query("INSERT INTO contact_triage_jobs(contact_id,revision,engine,status,lease_token) VALUES($1,1,'QA-engine','complete','QA-HIDDEN-LEASE') RETURNING id", [contact])).rows[0].id;
  await db.query("INSERT INTO contact_campus_reviews(contact_id,triage_job_id,revision,proposal,decision,source_reviewed,created_by,intent_hash) VALUES($1,$2,1,'{\"institution\":\"UNIR\"}','approved',true,$3,'QA-HIDDEN-INTENT')", [contact, job, user.usuario.id]);
  for (const [round, state] of [[1, "legacy"], [2, "accepted"], [3, "uncertain"]]) await db.query("INSERT INTO contact_replies(contact_id,rodada,versao,assunto,estado,payload,selo,attempt_id,criada_em) VALUES($1,$2,'texto','QA subject',$3,'{\"text\":\"QA-HIDDEN-BODY\"}','QA-HIDDEN-SEAL','QA-HIDDEN-ATTEMPT','2026-11-08T10:02:00.123456Z')", [contact, round, state]);
  const snapshot = async () => (await db.query("SELECT 'contact' kind,row_to_json(c)::text raw FROM contact_messages c UNION ALL SELECT 'reply',row_to_json(r)::text FROM contact_replies r UNION ALL SELECT 'campus',row_to_json(v)::text FROM contact_campus_reviews v UNION ALL SELECT 'job',row_to_json(j)::text FROM contact_triage_jobs j UNION ALL SELECT 'audit',row_to_json(a)::text FROM audit_log a ORDER BY kind,raw")).rows;
  const before = await snapshot();
  const get = (query, cookie = `adm=${token}`) => fetch(new URL(`/api/admin/contato/historico?${query}`, base), { headers: { cookie } });
  assert.equal((await get(`contato=${contact}`, "")).status, 401);
  for (const query of [`contato=${contact}&contato=${contact}`, `contato=${contact}&limit=21`, `contato=${contact}&payload=1`]) assert.equal((await get(query)).status, 400);
  const response = await get(`contato=${contact}&limit=2`); assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/);
  const history = await response.json(); assert.ok(history.ok); assert.equal(history.contact.created_at, "2026-11-08T10:00:00.123456Z");
  assert.deepEqual(history.replies.items.map(r => r.estado), ["uncertain", "accepted"]); assert.ok(history.replies.nextBefore);
  assert.equal(history.replies.items[0].created_at, "2026-11-08T10:02:00.123456Z");
  assert.equal(history.delivery, "not_evaluated"); assert.equal(history.campus.published, false);
  assert.ok(!JSON.stringify(history).includes("QA-HIDDEN"));
  const next = await (await get(`contato=${contact}&limit=2&replyBefore=${history.replies.nextBefore}`)).json();
  assert.deepEqual(next.replies.items.map(r => r.estado), ["legacy"]); assert.equal(next.replies.nextBefore, null);
  await db.query("ALTER TABLE contact_campus_reviews RENAME TO qa_missing_campus");
  try { const failed = await get(`contato=${contact}`); assert.equal(failed.status, 503); assert.deepEqual(await failed.json(), { ok: false, error: "unavailable" }); }
  finally { await db.query("ALTER TABLE qa_missing_campus RENAME TO contact_campus_reviews"); }
  assert.equal((await get(`contato=${contact}`)).status, 200);
  await db.query("UPDATE admin_users SET nivel='leitura' WHERE id=$1", [user.usuario.id]);
  assert.equal((await get(`contato=${contact}`)).status, 403);
  assert.deepEqual(await snapshot(), before);
  assert.equal((await db.query("SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM signatures")).rowCount, 0);
  const result = { compiledHttp: true, authorization: true, boundedPagination: true, microseconds: true, projectionOnly: true, noDeliveryInference: true, campusUnpublished: true, unavailableSourceFailsClosed: true, recovery: true, originalsAndAuditPreserved: true, noDispatch: true };
  await writeFile(`${process.env.QA_OUTPUT_DIR}/contact-history.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await U.encerrarSessao(token); await db._closeDbForTests(); }
