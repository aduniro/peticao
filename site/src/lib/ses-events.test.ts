import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";

(process.env as Record<string, string>).NODE_ENV = "test";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = publicKey.export({ type: "spki", format: "pem" }) as string;
const CERT_URL = "https://sns.sa-east-1.amazonaws.com/SimpleNotificationService-abc.pem";
const TOPIC = "arn:aws:sns:sa-east-1:123456789012:peticao-ses";

async function signed(over: Record<string, string> = {}, version: "1" | "2" = "2") {
  const { stringToSign } = await import("./mail/ses-events");
  const m: Record<string, string> = {
    Type: "Notification", MessageId: "m1", TopicArn: TOPIC, Timestamp: "2026-11-02T10:00:00Z", Message: "{}",
    SignatureVersion: version, SigningCertURL: CERT_URL, ...over,
  };
  const s = createSign(version === "2" ? "RSA-SHA256" : "RSA-SHA1");
  s.update(stringToSign(m as any)!, "utf8");
  m.Signature = s.sign(privateKey, "base64");
  return m as any;
}
const getCert = async () => PEM;

test("SNS: assinatura válida passa (v1 e v2); adulterada, URL de certificado fora da AWS ou sem .pem falham", async () => {
  const { verifySns } = await import("./mail/ses-events");
  assert.equal(await verifySns(await signed({}, "2"), getCert), true);
  assert.equal(await verifySns(await signed({}, "1"), getCert), true);
  const m = await signed();
  assert.equal(await verifySns({ ...m, Message: '{"x":1}' }, getCert), false);
  assert.equal(await verifySns(await signed({ SigningCertURL: "https://evil.example.com/x.pem" }), getCert), false);
  assert.equal(await verifySns(await signed({ SigningCertURL: "http://sns.sa-east-1.amazonaws.com/x.pem" }), getCert), false);
  assert.equal(await verifySns(await signed({ SigningCertURL: "https://sns.sa-east-1.amazonaws.com.evil.com/x.pem" }), getCert), false);
  assert.equal(await verifySns(await signed({ SigningCertURL: "https://sns.sa-east-1.amazonaws.com/x.txt" }), getCert), false);
});

test("SES: só bounce permanente e reclamação viram bloqueio; bounce temporário é ignorado", async () => {
  const { extractSuppressions } = await import("./mail/ses-events");
  assert.deepEqual(extractSuppressions({ eventType: "Bounce", bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: "a@x.org", diagnosticCode: "550" }] } }).map((s) => [s.email, s.reason]), [["a@x.org", "bounce"]]);
  assert.equal(extractSuppressions({ notificationType: "Bounce", bounce: { bounceType: "Transient", bouncedRecipients: [{ emailAddress: "b@x.org" }] } }).length, 0);
  assert.deepEqual(extractSuppressions({ eventType: "Complaint", complaint: { complainedRecipients: [{ emailAddress: "c@x.org" }] } }).map((s) => [s.email, s.reason]), [["c@x.org", "complaint"]]);
  assert.equal(extractSuppressions({ eventType: "Delivery" }).length, 0);
});

test("SNS → bloqueio no banco → o envio recusa o endereço e o cadastro o trata como inválido", async () => {
  const dbmod = await import("./db");
  await dbmod._openForTests("t_ses");
  const { handleSns } = await import("./mail/ses-events");
  const { isSuppressed } = await import("./mail/suppression");
  const ev = { eventType: "Bounce", bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: "Morto@Exemplo.ORG" }] } };
  // tópico errado e assinatura inválida: recusados e nada gravado
  assert.equal((await handleSns(await signed({ Message: JSON.stringify(ev), TopicArn: "arn:outro" }), { getCert, topic: TOPIC })).status, 403);
  const forged = { ...(await signed({ Message: JSON.stringify(ev) })), Signature: "AAAA" };
  assert.equal((await handleSns(forged, { getCert, topic: TOPIC })).status, 403);
  assert.equal((await handleSns(await signed({ Message: JSON.stringify(ev) }), { getCert, topic: undefined })).status, 503);
  assert.equal(await isSuppressed("morto@exemplo.org"), false);
  const r = await handleSns(await signed({ Message: JSON.stringify(ev) }), { getCert, topic: TOPIC });
  assert.equal(r.status, 200);
  assert.equal(await isSuppressed("morto@exemplo.org"), true);
  // com provedor real o envio é recusado antes de sair
  process.env.MAIL_PROVIDER = "smtp"; process.env.SMTP_URL = "smtp://127.0.0.1:1";
  const { sendMail, MailSuppressedError } = await import("./mail");
  await assert.rejects(() => sendMail({ to: "MORTO@exemplo.org", subject: "x", text: "y" }), MailSuppressedError);
  process.env.MAIL_PROVIDER = "dev";
  // confirmação de inscrição: só abre a URL do próprio SNS
  let opened = "";
  const sub = await signed({ Type: "SubscriptionConfirmation", SubscribeURL: "https://sns.sa-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=t", Token: "t" });
  assert.equal((await handleSns(sub, { getCert, topic: TOPIC, confirm: async (u) => { opened = u; } })).status, 200);
  assert.match(opened, /^https:\/\/sns\.sa-east-1\.amazonaws\.com\//);
  const evil = await signed({ Type: "SubscriptionConfirmation", SubscribeURL: "https://evil.example.com/?x", Token: "t" });
  assert.equal((await handleSns(evil, { getCert, topic: TOPIC, confirm: async () => { throw new Error("não deveria abrir"); } })).status, 400);
  await dbmod._closeDbForTests();
});
