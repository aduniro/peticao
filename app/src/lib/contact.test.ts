import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
process.env.MAIL_OUTBOX_DIR = join(tmpdir(), `peticao-outbox-ct-${process.pid}`);

test("contato: valida e normaliza nome e e-mail; recusa dados ruins", async () => {
  const { validateContact } = await import("./contact");
  const ok = validateContact({ name: "mAria DA sILVA", email: " MARIA@Exemplo.ORG ", kind: "bug", message: "Não consegui assinar no celular." });
  assert.ok(ok.ok); if (ok.ok) { assert.equal(ok.value.name, "Maria da Silva"); assert.equal(ok.value.email, "maria@exemplo.org"); }
  const bad = validateContact({ name: "", email: "x", kind: "spam", message: "curta" });
  assert.ok(!bad.ok); if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ["email", "kind", "message", "name"]);
});

test("contato: grava, envia a contato@ com cópia oculta e Reply-To; se o e-mail falhar, a mensagem continua salva", async () => {
  const dbmod = await import("./db");
  await dbmod._openForTests("t_contato");
  rmSync(process.env.MAIL_OUTBOX_DIR!, { recursive: true, force: true });
  const { saveAndSendContact, listContacts } = await import("./contact");
  const r = await saveAndSendContact({ name: "Maria da Silva", email: "maria@exemplo.org", kind: "duvida", message: "Como confirmo a assinatura?", locale: "pt" }, "1.2.3.4");
  assert.equal(r.mailed, true);
  const mails = readdirSync(process.env.MAIL_OUTBOX_DIR!).map((f) => JSON.parse(readFileSync(join(process.env.MAIL_OUTBOX_DIR!, f), "utf8")));
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, "contato@sancionaintegral.org");
  assert.deepEqual(mails[0].bcc, ["operator-1608598f41@example.invalid"]);
  assert.equal(mails[0].replyTo, "maria@exemplo.org");
  assert.match(mails[0].text, /Como confirmo a assinatura\?/);
  // e-mail falha (provedor sem configuração): a mensagem fica salva, marcada como não enviada, e o e-mail vai para a fila de reenvio
  process.env.MAIL_PROVIDER = "smtp"; delete process.env.SMTP_URL;
  const r2 = await saveAndSendContact({ name: "João dos Santos", email: "joao@exemplo.org", kind: "bug", message: "O botão não responde." }, "5.6.7.8");
  assert.equal(r2.mailed, false);
  const list = await listContacts();
  assert.equal(list.length, 2);
  assert.equal(list[0].mailed, false); assert.match(list[0].mail_error ?? "", /fila de reenvio/);
  const { query } = await import("./db");
  const q = (await query<{ status: string; to_addr: string }>("SELECT status,to_addr FROM mail_outbox")).rows;
  assert.deepEqual(q.map((x) => [x.status, x.to_addr]), [["pending", "contato@sancionaintegral.org"]]);
  assert.ok(!JSON.stringify(list).includes("5.6.7.8")); // o IP não é guardado em claro
  process.env.MAIL_PROVIDER = "dev";
  await dbmod._closeDbForTests();
  rmSync(process.env.MAIL_OUTBOX_DIR!, { recursive: true, force: true });
});
