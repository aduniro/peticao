#!/usr/bin/env node
// Diagnóstico (somente leitura) do envio de e-mail na AWS: SES + SNS em sa-east-1. Usa as chaves do cofre; nunca as imprime.
//   node aws.mjs diagnostico
import { getKey } from "./lib/keystore.mjs";
import { awsCall, whoAmI } from "./lib/aws-api.mjs";

const REGION = "sa-east-1", TOPIC_NAME = "peticao-ses", DOMAIN = "sancionaintegral.org", CONFIG_SET = "peticao";
const accessKey = getKey("AWS_ACCESS_KEY_ID"), secretKey = getKey("AWS_SECRET_ACCESS_KEY");
if (!accessKey || !secretKey) { console.error("Chaves da AWS não gravadas (chave-aws-id / chave-aws-secret)."); process.exit(1); }
const ok = (b, t) => console.log(`${b ? "OK  " : "ERRO"} ${t}`);
const info = (t) => console.log(`     ${t}`);
const sesv2 = (path) => awsCall({ service: "ses", region: REGION, host: `email.${REGION}.amazonaws.com`, path, accessKey, secretKey });
const sns = (params) => awsCall({ service: "sns", region: REGION, method: "POST", path: "/", body: new URLSearchParams({ ...params, Version: "2010-03-31" }).toString(), headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" }, accessKey, secretKey });
const tag = (x, t) => [...x.matchAll(new RegExp(`<${t}>([^<]*)</${t}>`, "g"))].map((m) => m[1]);
const denied = (r) => r.status === 403 || r.status === 401;

const w = await whoAmI(accessKey, secretKey);
console.log(`Conta ${w.account} — ${w.arn}\n`);
const topicArn = `arn:aws:sns:${REGION}:${w.account}:${TOPIC_NAME}`;

console.log("== SES: conta");
let r = await sesv2("/v2/email/account");
if (r.status === 200) {
  ok(true, `produção liberada: ${r.json.ProductionAccessEnabled ? "SIM" : "NÃO (sandbox)"}; envio habilitado: ${r.json.SendingEnabled}`);
  info(`cota 24 h: ${r.json.SendQuota?.Max24HourSend}; por segundo: ${r.json.SendQuota?.MaxSendRate}; enviados 24 h: ${r.json.SendQuota?.SentLast24Hours}`);
  if (r.json.Details?.ReviewDetails) info(`revisão do pedido: ${r.json.Details.ReviewDetails.Status ?? "?"} (caso ${r.json.Details.ReviewDetails.CaseId ?? "?"})`);
} else ok(false, `ler conta SES: HTTP ${r.status} ${denied(r) ? "(sem permissão)" : r.text.slice(0, 120)}`);

console.log("\n== SES: identidade do domínio");
r = await sesv2(`/v2/email/identities/${DOMAIN}`);
if (r.status === 200) {
  ok(r.json.VerifiedForSendingStatus, `verificada para envio: ${r.json.VerifiedForSendingStatus}`);
  ok(r.json.DkimAttributes?.Status === "SUCCESS", `DKIM: ${r.json.DkimAttributes?.Status}`);
  const mf = r.json.MailFromAttributes ?? {};
  ok(mf.MailFromDomainStatus === "SUCCESS", `MAIL FROM ${mf.MailFromDomain ?? "(nenhum)"}: ${mf.MailFromDomainStatus ?? "?"} (se falhar: ${mf.BehaviorOnMxFailure ?? "?"})`);
  ok(r.json.ConfigurationSetName === CONFIG_SET, `conjunto padrão da identidade: ${r.json.ConfigurationSetName ?? "(NENHUM)"} — esperado: ${CONFIG_SET}`);
} else ok(false, `ler identidade: HTTP ${r.status} ${r.text.slice(0, 120)}`);

console.log("\n== SES: conjunto de configurações");
r = await sesv2(`/v2/email/configuration-sets/${CONFIG_SET}`);
ok(r.status === 200, `conjunto '${CONFIG_SET}' existe${r.status === 200 ? "" : ` (HTTP ${r.status})`}`);
if (r.status === 200) {
  info(`envio habilitado: ${r.json.SendingOptions?.SendingEnabled}; rastreamento: ${r.json.TrackingOptions?.CustomRedirectDomain ?? "padrão"}`);
  const d = await sesv2(`/v2/email/configuration-sets/${CONFIG_SET}/event-destinations`);
  const list = d.json?.EventDestinations ?? [];
  ok(list.length > 0, `destinos de evento: ${list.length}`);
  for (const e of list) {
    info(`- ${e.Name}: habilitado=${e.Enabled}; eventos=${(e.MatchingEventTypes ?? []).join(",")}; SNS=${e.SnsDestination?.TopicArn ?? "(não é SNS)"}`);
    ok(e.SnsDestination?.TopicArn === topicArn, `  aponta para o tópico esperado (${topicArn})`);
    ok(e.Enabled, "  destino habilitado");
    ok((e.MatchingEventTypes ?? []).includes("BOUNCE") && (e.MatchingEventTypes ?? []).includes("COMPLAINT"), "  inclui BOUNCE e COMPLAINT");
  }
}

console.log("\n== SNS: tópico");
r = await sns({ Action: "GetTopicAttributes", TopicArn: topicArn });
if (r.status === 200) {
  const kms = /<key>KmsMasterKeyId<\/key>\s*<value>([^<]+)</.exec(r.text)?.[1];
  ok(!kms, `criptografia KMS: ${kms ? `LIGADA (${kms}) — o SES NÃO consegue publicar` : "desligada"}`);
  const pol = /<key>Policy<\/key>\s*<value>([^<]+)</.exec(r.text)?.[1] ?? "";
  const dec = pol.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  ok(/ses\.amazonaws\.com/.test(dec) && /SNS:Publish/.test(dec), "política permite o serviço SES publicar");
} else ok(false, `ler tópico: HTTP ${r.status} ${r.text.slice(0, 160)}`);

console.log("\n== SNS: inscrições");
r = await sns({ Action: "ListSubscriptionsByTopic", TopicArn: topicArn });
if (r.status === 200) {
  const members = r.text.split("<member>").slice(1);
  ok(members.length > 0, `inscrições: ${members.length}`);
  for (const m of members) {
    const arn = tag(m, "SubscriptionArn")[0] ?? "?";
    info(`- ${tag(m, "Protocol")[0]} → ${tag(m, "Endpoint")[0]} | ${arn.startsWith("arn:") ? "CONFIRMADA" : arn}`);
    ok(arn.startsWith("arn:"), "  inscrição confirmada");
    ok(tag(m, "Endpoint")[0] === `https://eventos.magisteriofederal.org/api/ses/eventos`, "  endpoint correto");
    if (arn.startsWith("arn:")) {
      const a = await sns({ Action: "GetSubscriptionAttributes", SubscriptionArn: arn });
      const raw = /<key>RawMessageDelivery<\/key>\s*<value>([^<]+)</.exec(a.text)?.[1];
      ok(raw !== "true", `entrega bruta (RawMessageDelivery): ${raw ?? "?"} — precisa ser false`);
    }
  }
} else ok(false, `listar inscrições: HTTP ${r.status} ${r.text.slice(0, 160)}`);
