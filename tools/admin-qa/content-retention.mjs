// Compiled cron and protected read. Synthetic data only; no pending fresh message may be dispatched.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = new URL(process.env.QA_BASE_URL ?? "http://missing"), url = new URL(process.env.DATABASE_URL ?? "http://missing");
assert.equal(base.hostname, "127.0.0.1"); assert.equal(base.port, "3033");
assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "54346");
assert.equal(process.env.MAIL_PROVIDER, "dev"); assert.equal(process.env.MAIL_PROVIDERS, "dev");
assert.equal(process.env.MAIL_ARCHIVE_RETENTION, "30"); assert.ok(process.env.QA_CRON_SECRET);
const dm = await import("../../site/src/lib/db.ts"), am = await import("../../site/src/lib/mail/archive.ts"), om = await import("../../site/src/lib/mail/outbox.ts"), um = await import("../../site/src/lib/admin-users.ts");
const db = dm.default ?? dm, A = am.default ?? am, O = om.default ?? om, U = um.default ?? um;
assert.equal((await db.query("SELECT 1 FROM signatures UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM mail_messages")).rowCount, 0);
let token;
try {
  const mail = { to: "qa-retention-http@example.test", subject: "QA subject", text: "QA-RETENTION-PRIVATE-BODY", attachments: [{ filename: "qa.txt", content: Buffer.from("QA-RETENTION-PRIVATE-ATTACHMENT") }] };
  // Administrative credentials remain restricted regardless of their age.
  // Exercise expiration using an ordinary confirmation message.
  const message = await A.prepareMessage(mail, "confirmacao", "transactional", { archive: { until: null } });
  await db.query("UPDATE mail_messages SET created_at=now()-interval '31 days',content_expires_at=now()+interval '90 days' WHERE id=$1", [message.id]);
  const queue = await O.enqueueMail(mail, "admin", "QA reason");
  await db.query("UPDATE mail_outbox SET created_at=now()-interval '31 days',next_attempt_at=now()-interval '1 day' WHERE id=$1", [queue]);
  const contact = (await db.query("INSERT INTO contact_messages(name,email,kind,message) VALUES('QA','qa-contact@example.test','duvida','QA original contact') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO contact_replies(contact_id,rodada,versao,por,assunto,estado,payload,criada_em,due_at) VALUES($1,1,'texto','qa-owner@example.test','QA subject','prepared',$2,now()-interval '31 days',now()-interval '1 day')", [contact, JSON.stringify({ to: mail.to, subject: mail.subject, text: mail.text })]);
  await db.query("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,created_at,status,confirmed_at,seq) VALUES('QA Signer','qa-signer@example.test','QA-HASH-EMAIL','QA-HASH-CPF','apoiador','QA','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z','confirmed','2026-10-01T00:10:00Z',17)");
  await db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,list_hash,pdf) VALUES(1,'partial','prepared',0,1,'QA-LIST',decode('25504446','hex'))");
  const proof = async () => (await db.query("SELECT 'signer' kind,row_to_json(s)::text raw FROM signatures s UNION ALL SELECT 'batch',row_to_json(b)::text FROM batches b UNION ALL SELECT 'contact',row_to_json(c)::text FROM contact_messages c ORDER BY kind,raw")).rows;
  const before = await proof();
  const owner = await U.criarUsuario({ email: "qa-retention-owner@example.test", nome: "Gestor QA", nivel: "total", senha: "QA-Retention-Compiled-2026" }); assert.ok(owner.ok);
  token = (await U.abrirSessao(owner.usuario.id, "127.0.0.1")).token;
  await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=$1", [owner.usuario.id]);
  const preview = await fetch(new URL(`/api/admin/emails/mensagens/previa?id=${message.id}`, base), { headers: { cookie: `adm=${token}` } }); assert.equal(preview.status, 200);
  const expired = await preview.json(); assert.equal(expired.state, "expired");
  for (const secret of [mail.text, "QA-RETENTION-PRIVATE-ATTACHMENT"]) assert.ok(!JSON.stringify(expired).includes(secret));
  const request = secret => fetch(new URL("/api/cron/fila", base), { method: "POST", headers: secret ? { authorization: `Bearer ${secret}` } : {} });
  assert.equal((await request()).status, 401); assert.equal((await request("wrong")).status, 401);
  assert.ok((await db.query("SELECT content_cipher FROM mail_messages WHERE id=$1", [message.id])).rows[0].content_cipher);
  const response = await request(process.env.QA_CRON_SECRET); assert.equal(response.status, 200);
  const result = await response.json(); assert.deepEqual(result.contentExpired, { messages: 1, outbox: 1, replies: 1 }); assert.equal(result.tried, 0);
  assert.equal((await db.query("SELECT content_cipher FROM mail_messages WHERE id=$1", [message.id])).rows[0].content_cipher, null);
  assert.deepEqual((await db.query("SELECT payload FROM mail_outbox WHERE id=$1", [queue])).rows[0].payload, {});
  assert.equal((await db.query("SELECT payload FROM contact_replies")).rows[0].payload, null);
  const again = await request(process.env.QA_CRON_SECRET); assert.equal(again.status, 200);
  assert.deepEqual((await again.json()).contentExpired, { messages: 0, outbox: 0, replies: 0 });
  assert.deepEqual(await proof(), before);
  assert.equal((await db.query("SELECT count(*)::int n FROM mail_log")).rows[0].n, 0);
  assert.ok((await db.verifyAuditChain()).ok); assert.ok(process.env.QA_OUTPUT_DIR);
  const evidence = { compiledCron: true, authentication: true, logicalExpiryBeforeCleanup: true, attachmentsAndBodiesRemoved: true, metadataAndOriginalsPreserved: true, noDispatch: true, idempotentPurge: true };
  await mkdir(process.env.QA_OUTPUT_DIR, { recursive: true }); await writeFile(`${process.env.QA_OUTPUT_DIR}/content-retention.json`, JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence));
} finally { if (token) await U.encerrarSessao(token); await db._closeDbForTests(); }
