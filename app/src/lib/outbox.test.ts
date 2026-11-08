import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

(process.env as Record<string, string>).NODE_ENV = "test";

test("fila de reenvio: e-mail que nenhum provedor envia vai para a fila e sai quando o serviço volta", async () => {
  const dbmod = await import("./db");
  await dbmod._openForTests("t_outbox");
  const { sendMail } = await import("./mail");
  const { drainOutbox, outboxStats, nextDelayMinutes } = await import("./mail/outbox");
  const { query } = await import("./db");
  process.env.MAIL_PROVIDERS = "smtp"; delete process.env.SMTP_URL; // nenhum provedor funciona
  const out = await sendMail({ to: "pessoa@exemplo.org", subject: "Confirme", text: "link", html: "<p>link</p>", attachments: [{ filename: "a.pdf", content: Buffer.from("PDF!") }] }, "confirmacao");
  assert.equal(out, "queued");
  assert.deepEqual(await outboxStats(), { pending: 1, failed: 0, oldest: (await outboxStats()).oldest });
  // ainda não venceu (1 min): nada a tentar
  assert.equal((await drainOutbox(async () => { throw new Error("não devia tentar"); })).tried, 0);
  await query("UPDATE mail_outbox SET next_attempt_at = now() - interval '1 second'");
  // serviço ainda fora do ar: continua pendente, com mais uma tentativa e novo prazo
  let r = await drainOutbox(async () => { throw new Error("provedor fora"); });
  assert.deepEqual([r.tried, r.sent, r.pending], [1, 0, 1]);
  let row = (await query<any>("SELECT attempts,last_error,next_attempt_at > now() AS later FROM mail_outbox")).rows[0];
  assert.deepEqual([row.attempts, row.last_error, row.later], [1, "provedor fora", true]);
  // serviço volta: sai, com o anexo e o HTML intactos
  await query("UPDATE mail_outbox SET next_attempt_at = now() - interval '1 second'");
  const seen: any[] = [];
  r = await drainOutbox(async (m) => { seen.push(m); });
  assert.deepEqual([r.tried, r.sent, r.pending], [1, 1, 0]);
  assert.equal(seen[0].to, "pessoa@exemplo.org"); assert.equal(seen[0].html, "<p>link</p>"); assert.equal(seen[0].attachments[0].content.toString(), "PDF!");
  assert.equal((await query<any>("SELECT status FROM mail_outbox")).rows[0].status, "sent");
  // passado das 48 h, desiste e marca como "failed"
  await query("INSERT INTO mail_outbox(kind,to_addr,payload,created_at) VALUES('x','a@b.org','{\"to\":\"a@b.org\",\"subject\":\"s\",\"text\":\"t\"}', now() - interval '49 hours')");
  r = await drainOutbox(async () => { throw new Error("ainda fora"); });
  assert.equal((await outboxStats()).failed, 1);
  assert.deepEqual([nextDelayMinutes(0), nextDelayMinutes(3), nextDelayMinutes(99)], [1, 10, 360]);
  delete process.env.MAIL_PROVIDERS;
  await dbmod._closeDbForTests();
});

test("fila de reenvio: endereço bloqueado é recusado na hora (não vai para a fila) e o modo dev não enfileira", async () => {
  const dbmod = await import("./db");
  await dbmod._openForTests("t_outbox2");
  const { sendMail, MailSuppressedError } = await import("./mail");
  const { suppress } = await import("./mail/suppression");
  const { outboxStats } = await import("./mail/outbox");
  process.env.MAIL_PROVIDERS = "smtp"; delete process.env.SMTP_URL;
  await suppress("morto@exemplo.org", "invalid", "teste");
  await assert.rejects(() => sendMail({ to: "morto@exemplo.org", subject: "x", text: "y" }), MailSuppressedError);
  assert.equal((await outboxStats()).pending, 0);
  // com "queue: false" (envios que o admin acompanha) o erro aparece na hora
  await assert.rejects(() => sendMail({ to: "vivo@exemplo.org", subject: "x", text: "y" }, "lote", { queue: false }), /SMTP não configurado/);
  assert.equal((await outboxStats()).pending, 0);
  // dev: sem provedor real, falhar é falhar
  process.env.MAIL_PROVIDERS = "dev"; process.env.MAIL_OUTBOX_DIR = mkdtempSync(join(tmpdir(), "ob-"));
  assert.equal(await sendMail({ to: "vivo@exemplo.org", subject: "x", text: "y" }), "sent");
  rmSync(process.env.MAIL_OUTBOX_DIR!, { recursive: true, force: true }); delete process.env.MAIL_PROVIDERS; delete process.env.MAIL_OUTBOX_DIR;
  await dbmod._closeDbForTests();
});
