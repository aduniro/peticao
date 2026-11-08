import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";

test("remetente por tipo de mensagem, Reply-To padrão e cadeia com o tipo repassado", async () => {
  const { config } = await import("./config");
  const { withReplyTo, deliver } = await import("./mail");
  for (const k of ["MAIL_FROM", "MAIL_FROM_SES", "MAIL_FROM_SES_CONFIRMACAO", "MAIL_FROM_SES_LOTE", "MAIL_REPLY_TO"]) delete process.env[k];
  // sem nada configurado: remetente padrão
  assert.match(config.mailFromFor("ses", "confirmacao"), /<peticao@localhost>/);
  process.env.MAIL_FROM_SES = "Sanção <assinatura@sancionaintegral.org>";
  process.env.MAIL_FROM_SES_CONFIRMACAO = "Sanção <confirmar@assinatura.sancionaintegral.org>";
  process.env.MAIL_FROM_SES_LOTE = "Sanção <oficio@oficio.sancionaintegral.org>";
  assert.match(config.mailFromFor("ses", "confirmacao"), /confirmar@assinatura\./);
  assert.match(config.mailFromFor("ses", "lote"), /oficio@oficio\./);
  assert.match(config.mailFromFor("ses", "contato"), /assinatura@sancionaintegral\.org/); // tipo sem remetente próprio: o do provedor
  assert.match(config.mailFromFor("brevo", "confirmacao"), /<peticao@localhost>/); // outro provedor não herda o do SES
  // Reply-To: padrão só quando a mensagem não traz o próprio
  const m = { to: "p@exemplo.org", subject: "s", text: "t" };
  assert.equal(withReplyTo(m).replyTo, undefined);
  process.env.MAIL_REPLY_TO = "adunir@sancionaintegral.org";
  assert.equal(withReplyTo(m).replyTo, "adunir@sancionaintegral.org");
  assert.equal(withReplyTo({ ...m, replyTo: "pessoa@exemplo.org" }).replyTo, "pessoa@exemplo.org");
  // deliver repassa o tipo ao remetente de cada provedor, na ordem da cadeia
  const log: string[] = [];
  const out = await deliver(m, ["ses", "sendpulse"], { ses: async (_m: unknown, from: string) => { log.push(from); throw new Error("fora"); }, sendpulse: async (_m: unknown, from: string) => { log.push(from); } } as never, (p: string, kind?: string) => `${p}:${kind}`, "confirmacao");
  assert.equal(out, "sendpulse"); assert.deepEqual(log, ["ses:confirmacao", "sendpulse:confirmacao"]);
});
