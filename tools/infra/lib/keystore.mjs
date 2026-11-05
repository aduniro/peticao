// Cofre de chaves de INFRAESTRUTURA (Vultr, Cloudflare…), separado do app.
// Arquivo: ~/.config/peticao-infra/keys.env  (pasta 700, arquivo 600). Cada chave tem um comentário logo acima:
//   # CHAVE API PARA VULTR (gravada em 2026-10-31; gerenciar em https://my.vultr.com/settings/#settingsapi)
//   VULTR_API_KEY=...
// Nenhuma função daqui devolve o valor para impressão: quem precisa da chave a usa em memória.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const REGISTRY = {
  vultr: { env: "VULTR_API_KEY", title: "VULTR", manage: "https://my.vultr.com/settings/#settingsapi", label: "chave de API do Vultr" },
  cloudflare: { env: "CLOUDFLARE_API_TOKEN", title: "CLOUDFLARE (token antigo, só zona sancionaintegral.org)", manage: "https://dash.cloudflare.com/profile/api-tokens", label: "token de API da Cloudflare" },
  mailrelay: { env: "MAILRELAY_API_KEY", title: "MAILRELAY — conta sancionapresidente.ipzmarketing.com (envio de divulgação)", manage: "https://sancionapresidente.ipzmarketing.com (painel → Configurações → Chaves de API)", label: "chave de API do Mailrelay" },
  brevo: { env: "BREVO_API_KEY", title: "BREVO — chave API v3 'peticao-api' (REST: domínios, remetentes, envio pelo app)", manage: "https://app.brevo.com/settings/keys/api", label: "chave de API v3 do Brevo (xkeysib-…)" },
  "brevo:smtp-login": { env: "BREVO_SMTP_LOGIN", title: "BREVO — LOGIN SMTP da conta (usuário do relay, xxxx@smtp-brevo.com; não é segredo, mas fica junto)", manage: "https://app.brevo.com/settings/keys/smtp", label: "login SMTP do Brevo" },
  "brevo:smtp": { env: "BREVO_SMTP_KEY", title: "BREVO — chave SMTP 'peticao-smtp' (smtp-relay.brevo.com:465/587, só envio)", manage: "https://app.brevo.com/settings/keys/smtp", label: "chave SMTP do Brevo" },
  "brevo:mcp": { env: "BREVO_MCP_KEY", title: "BREVO — token MCP 'peticao-mcp' (ACESSO TOTAL de leitura e escrita à conta; usar só se necessário)", manage: "https://app.brevo.com/settings/keys/api", label: "token MCP do Brevo" },
  "mailrelay:sancionaintegral": { env: "MAILRELAY_API_KEY_SANCIONAINTEGRAL", title: "MAILRELAY — conta NOVA do domínio sancionaintegral.org (subdomínio avisos.sancionaintegral.org)", manage: "painel da conta → Configurações → Chaves de API", label: "chave de API do Mailrelay do domínio sancionaintegral.org" },
  "mailrelay:sancionaintegral-host": { env: "MAILRELAY_HOST_SANCIONAINTEGRAL", title: "MAILRELAY — ENDEREÇO da conta do domínio sancionaintegral.org (algo.ipzmarketing.com; não é segredo)", manage: "painel do Mailrelay", label: "endereço da conta Mailrelay" },
  "aws:id": { env: "AWS_ACCESS_KEY_ID", title: "AWS — Access key ID do usuário IAM claude-ses (SES/SNS, região sa-east-1)", manage: "https://console.aws.amazon.com/iam/home#/users", label: "Access key ID da AWS" },
  "aws:secret": { env: "AWS_SECRET_ACCESS_KEY", title: "AWS — Secret access key do usuário IAM claude-ses (SES/SNS, região sa-east-1)", manage: "https://console.aws.amazon.com/iam/home#/users", label: "Secret access key da AWS" },
  // Uma chave por conta da Cloudflare. A "geral" pode editar zonas, DNS, regras e criar outros tokens: guarde com cuidado.
  "cloudflare:sancionaintegral": { env: "CLOUDFLARE_API_TOKEN_SANCIONAINTEGRAL", title: "CLOUDFLARE — CONTA sancionaintegral.org (token GERAL: zonas, DNS, regras, certificados e outros tokens)", manage: "https://dash.cloudflare.com/profile/api-tokens", label: "token GERAL da conta Cloudflare sancionaintegral.org" },
  "cloudflare:cabanos": { env: "CLOUDFLARE_API_TOKEN_CABANOS", title: "CLOUDFLARE — CONTA cabanos.cc (subdomínios de verificação: Reacher e Mailrelay)", manage: "https://dash.cloudflare.com/profile/api-tokens", label: "token da conta Cloudflare cabanos.cc" },
  "cloudflare:sancionapresidente": { env: "CLOUDFLARE_API_TOKEN_SANCIONAPRESIDENTE", title: "CLOUDFLARE — CONTA sancionapresidente.org (divulgação autorizada pelas universidades)", manage: "https://dash.cloudflare.com/profile/api-tokens", label: "token da conta Cloudflare sancionapresidente.org" },
  "sendpulse:sancionaintegral-sendpulse": { env: "SENDPULSE_API_KEY_SANCIONAINTEGRAL_SENDPULSE", title: "SENDPULSE — CONTA sancionaintegral (chave 1 de 2, nome: sancionaintegral-sendpulse)", manage: "https://login.sendpulse.com/settings/#api", label: "chave de API 'sancionaintegral-sendpulse' do SendPulse" },
  "sendpulse:nova": { env: "SENDPULSE_API_KEY_NOVA", title: "SENDPULSE — CONTA sancionaintegral, chave NOVA de 05/11/2026 (testar permissões extras; as demais chaves continuam valendo)", manage: "https://login.sendpulse.com/settings/#api", label: "chave de API nova do SendPulse" },
  "sendpulse:id": { env: "SENDPULSE_CLIENT_ID", title: "SENDPULSE — CONTA sancionaintegral, 'Credenciais do cliente' (ID, chave 2 de 2)", manage: "https://login.sendpulse.com/settings/#api", label: "ID do cliente (Credenciais do cliente) do SendPulse" },
  "sendpulse:secret": { env: "SENDPULSE_CLIENT_SECRET", title: "SENDPULSE — CONTA sancionaintegral, 'Credenciais do cliente' (Segredo, chave 2 de 2)", manage: "https://login.sendpulse.com/settings/#api", label: "chave secreta (Credenciais do cliente) do SendPulse" },
  "mailersend": { env: "MAILERSEND_API_TOKEN", title: "MAILERSEND — token 'sancionaintegral-mailersend' (só envio de e-mail)", manage: "https://app.mailersend.com/api-tokens", label: "token de API do MailerSend (mlsn.…)" },
  "cloudflare:analytics": { env: "CLOUDFLARE_ANALYTICS_TOKEN", title: "CLOUDFLARE — token SÓ DE LEITURA de estatísticas (Analytics Read) da zona sancionaintegral.org, usado pelo painel para contar as respostas recebidas", manage: "https://dash.cloudflare.com/profile/api-tokens", label: "token de leitura de estatísticas da Cloudflare" },
  "mailersend:whatsapp": { env: "MAILERSEND_WHATSAPP_TOKEN", title: "MAILERSEND — token do WhatsApp (permissão whatsapp_full, separado do token de e-mail)", manage: "https://app.mailersend.com/api-tokens", label: "token de API do MailerSend com permissão de WhatsApp" },
};

export const dirPath = () => process.env.PETICAO_INFRA_DIR ?? join(homedir(), ".config", "peticao-infra");
export const filePath = () => join(dirPath(), "keys.env");

const isKeyLine = (l) => /^[A-Z][A-Z0-9_]*=/.test(l);
const read = () => (existsSync(filePath()) ? readFileSync(filePath(), "utf8") : "");

function writeAtomic(text) {
  mkdirSync(dirPath(), { recursive: true, mode: 0o700 });
  chmodSync(dirPath(), 0o700);
  const tmp = `${filePath()}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, filePath());
}

/** Valor da chave (só em memória) ou null. */
export function getKey(env) {
  for (const l of read().split("\n")) if (l.startsWith(`${env}=`)) return l.slice(env.length + 1).trim() || null;
  return null;
}

export const hasKey = (env) => getKey(env) !== null;

/** Grava/atualiza uma chave com o comentário identificador acima dela. Preserva as outras chaves e comentários. */
export function setKey(env, value, comment) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(env)) throw new Error("nome de variável inválido");
  if (!value || /\s/.test(value)) throw new Error("a chave não pode ser vazia nem conter espaços");
  const lines = read().split("\n");
  if (lines.at(-1) === "") lines.pop();
  const idx = lines.findIndex((l) => l.startsWith(`${env}=`));
  const block = [`# ${comment}`, `${env}=${value}`];
  if (idx >= 0) {
    let start = idx;
    while (start > 0 && lines[start - 1].startsWith("#")) start--; // comentários imediatamente acima da chave
    lines.splice(start, idx - start + 1, ...block);
  } else {
    if (lines.length && lines.at(-1) !== "") lines.push("");
    lines.push(...block);
  }
  writeAtomic(lines.join("\n") + "\n");
}

/** Remove a chave e os comentários logo acima dela. */
export function removeKey(env) {
  const lines = read().split("\n");
  const idx = lines.findIndex((l) => l.startsWith(`${env}=`));
  if (idx < 0) return false;
  let start = idx;
  while (start > 0 && lines[start - 1].startsWith("#")) start--;
  lines.splice(start, idx - start + 1);
  const out = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  writeAtomic(out.trim() ? out.replace(/\n*$/, "\n") : "");
  return true;
}

/** Lista só os nomes das chaves e seu comentário (nunca o valor). */
export function listKeys() {
  const lines = read().split("\n");
  const out = [];
  lines.forEach((l, i) => {
    if (!isKeyLine(l)) return;
    const name = l.slice(0, l.indexOf("="));
    let c = i, comment = "";
    while (c > 0 && lines[c - 1].startsWith("#")) c--;
    comment = lines.slice(c, i).join(" ").replace(/^#\s*/, "");
    out.push({ name, comment, length: l.length - name.length - 1 });
  });
  return out;
}

export const mask = (email) => String(email ?? "").replace(/^(.).*(@.*)$/, "$1***$2");
