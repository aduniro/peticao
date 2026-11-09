#!/usr/bin/env node
// Grava uma chave de API de infraestrutura SEM mostrá-la (prompt sem eco), com comentário identificador, e valida a conexão.
// Uso:  node /mnt/apps/peticao-final/peticao/tools/infra/chave.mjs vultr
//       node /mnt/apps/peticao-final/peticao/tools/infra/chave.mjs cloudflare
//       node /mnt/apps/peticao-final/peticao/tools/infra/chave.mjs --listar     (mostra só os nomes e comentários, nunca os valores)
//       node /mnt/apps/peticao-final/peticao/tools/infra/chave.mjs vultr --remover
//       node /mnt/apps/peticao-final/peticao/tools/infra/chave.mjs cloudflare --validar   (testa a chave já gravada, sem digitar de novo)
import { createInterface } from "node:readline/promises";
import { askHidden, closePrompt } from "../../site/scripts/lib-prompt.mjs";
import { REGISTRY, filePath, getKey, listKeys, mask, removeKey, setKey } from "./lib/keystore.mjs";
import { VultrError, createClient } from "./lib/vultr-api.mjs";
import { validateMailrelay } from "./lib/mailrelay-api.mjs";
import { whoAmI } from "./lib/aws-api.mjs";
import { testBrevoSmtp } from "./lib/brevo-smtp.mjs";

const today = () => new Date().toISOString().slice(0, 10);

/** Dica de formato, sem expor o valor: só o prefixo público do tipo de token e o tamanho. */
function formatHint(name, key) {
  if (!(name === "cloudflare" || name.startsWith("cloudflare:"))) return "";
  const m = /^(cf[a-z]{2})_/.exec(key);
  const tipo = m ? ({ cfut: "token de usuário", cfat: "token de conta" }[m[1]] ?? "token") + ` (prefixo ${m[1]}_)` : /^[0-9a-f]{37}$/.test(key) ? "parece a Global API Key (NÃO serve; precisa ser um API Token)" : "sem prefixo conhecido (token antigo de 40 caracteres, ou valor errado)";
  const esperado = m ? (key.length === 53 ? "" : ` — tokens ${m[1]}_ costumam ter 53 caracteres; este tem ${key.length}: provavelmente colado incompleto`) : "";
  return `Formato: ${tipo}, ${key.length} caracteres${esperado}.`;
}

async function validate(name, key) {
  if (name === "aws:id" || name === "aws:secret") {
    const id = name === "aws:id" ? key : getKey("AWS_ACCESS_KEY_ID");
    const sk = name === "aws:secret" ? key : getKey("AWS_SECRET_ACCESS_KEY");
    if (!id || !sk) return `Gravada. Falta a outra metade (${name === "aws:id" ? "aws:secret" : "aws:id"}) para validar.`;
    const w = await whoAmI(id, sk);
    return `Conexão OK com a AWS. Conta ${w.account}, identidade ${w.arn}.`;
  }
  if (name === "sendpulse:sancionaintegral-sendpulse") return "Chave 'sancionaintegral-sendpulse' gravada (1 de 2). A API do SendPulse só pode ser testada quando a segunda chave também estiver no cofre; aguarde a instrução para gravá-la.";
  if (name === "sendpulse:id" || name === "sendpulse:secret") {
    const id = name === "sendpulse:id" ? key : getKey("SENDPULSE_CLIENT_ID");
    const sk = name === "sendpulse:secret" ? key : getKey("SENDPULSE_CLIENT_SECRET");
    if (!id || !sk) return `Gravada. Falta a outra metade (${name === "sendpulse:id" ? "sendpulse:secret" : "sendpulse:id"}) para validar.`;
    const r = await fetch("https://api.sendpulse.com/oauth/access_token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant_type: "client_credentials", client_id: id, client_secret: sk }), signal: AbortSignal.timeout(20_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error(`O SendPulse recusou o par ID/segredo (HTTP ${r.status}${j.error_description ? `: ${j.error_description}` : ""}).`);
    return `Conexão OK com o SendPulse (token obtido, válido por ${j.expires_in ?? "?"} s).`;
  }
  if (name === "mailersend:whatsapp") {
    const r = await fetch("https://api.mailersend.com/v1/whatsapp/templates", { headers: { Authorization: `Bearer ${key}`, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error("O MailerSend recusou o token (HTTP 401): confira se copiou inteiro (mlsn.…).");
    if (r.status === 403) return "Token gravado, mas SEM permissão de WhatsApp (HTTP 403): recrie o token marcando WhatsApp (whatsapp_full) e confirme que o complemento de WhatsApp está ativo na conta.";
    if (!r.ok) return `Token gravado. O MailerSend respondeu HTTP ${r.status}.`;
    const t = j.data ?? [];
    return `Conexão OK com o WhatsApp do MailerSend. Modelos de mensagem: ${t.length ? t.map((x) => `${x.name ?? x.id} (${x.status ?? "?"})`).join(", ") : "nenhum ainda"}.`;
  }
  if (name === "mailersend") {
    const r = await fetch("https://api.mailersend.com/v1/domains?limit=100", { headers: { Authorization: `Bearer ${key}`, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (r.status === 401) throw new Error("O MailerSend recusou o token (HTTP 401): confira se copiou inteiro (mlsn.…).");
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return `Token gravado. O MailerSend respondeu HTTP ${r.status}${r.status === 403 ? " (o token só tem permissão de envio, sem listar domínios: normal)" : ""}.`;
    return `Conexão OK com o MailerSend. Domínios: ${(j.data ?? []).map((d) => `${d.name}${d.is_verified ? "" : " (não verificado)"}`).join(", ") || "nenhum"}.`;
  }
  if (name === "mailrelay") return validateMailrelay(key);
  if (name === "mailrelay:sancionaintegral-host") return `Endereço gravado: ${key}. Agora grave a chave (mailrelay:sancionaintegral) para validar.`;
  if (name === "mailrelay:sancionaintegral") {
    // O endereço da conta (algo.ipzmarketing.com) ainda pode não estar definido: se faltar, descobre testando os nomes prováveis.
    const saved = getKey("MAILRELAY_HOST_SANCIONAINTEGRAL");
    const candidates = saved ? [saved] : ["sancionaintegral", "sancionaintegralorg", "sancionaintegral-org", "admin-sancionaintegral", "adminsancionaintegral", "sancionaintegral1", "sancionaintegral2"].map((s) => `${s}.ipzmarketing.com`);
    for (const host of candidates) {
      try {
        const out = await validateMailrelay(key, { host });
        if (!saved) { const r = REGISTRY["mailrelay:sancionaintegral-host"]; setKey(r.env, host, `CHAVE API PARA ${r.title} (descoberto em ${today()})`); }
        return `${out}\nEndereço da conta descoberto e gravado: ${host}`;
      } catch (e) { if (saved) throw e; /* tenta o próximo candidato */ }
    }
    return "Chave gravada (identificada como do domínio sancionaintegral.org), mas NÃO validada: não achei o endereço da conta entre os nomes prováveis. Quando você souber o endereço (algo.ipzmarketing.com, na barra do navegador do painel), me diga e eu gravo e valido.";
  }
  if (name === "brevo:smtp-login") return "Login SMTP gravado. Agora grave a chave SMTP (brevo:smtp) para validar o login.";
  if (name === "brevo:smtp") {
    const login = getKey("BREVO_SMTP_LOGIN");
    if (!login) return "Chave SMTP gravada. Falta o login SMTP (brevo:smtp-login) para validar.";
    await testBrevoSmtp(login, key);
    return `LOGIN SMTP OK no Brevo (smtp-relay.brevo.com:465) com o login ${mask(login)}.`;
  }
  if (name === "brevo:mcp") {
    const r = await fetch("https://api.brevo.com/v3/account", { headers: { "api-key": key, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    return "Token MCP gravado. Ele não é validável pela API REST (o HTTP 401 do teste é esperado); só vale no servidor MCP do Brevo.";
  }
  if (name === "brevo") {
    const r = await fetch("https://api.brevo.com/v3/account", { headers: { "api-key": key, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error("O Brevo recusou a chave (401). Confira se copiou a chave de API v3 inteira (começa com xkeysib-), e não a chave SMTP.");
    if (!r.ok) throw new Error(`Resposta inesperada do Brevo: HTTP ${r.status}${j.message ? ` — ${j.message}` : ""}.`);
    const plan = (j.plan ?? []).map((p) => `${p.type}${p.credits != null ? ` (${p.credits} créditos)` : ""}`).join(", ") || "?";
    return `Conexão OK com o Brevo. Conta: ${mask(j.email)}, empresa: ${j.companyName ?? "?"}. Plano: ${plan}.`;
  }
  if (name === "vultr") {
    const a = (await createClient({ key }).account())?.account ?? {};
    return `Conexão OK com o Vultr. Conta: ${a.name ?? "?"} (${mask(a.email)}).`;
  }
  if (name === "cloudflare" || name.startsWith("cloudflare:")) {
    const call = async (path) => {
      const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
      return { status: r.status, j: await r.json().catch(() => ({})) };
    };
    // Token de USUÁRIO valida em /user/tokens/verify; token de CONTA (cfat_…) recebe 401 ali. Listar zonas funciona para os dois tipos.
    const u = await call("/user/tokens/verify");
    if (u.status === 200 && u.j.success) return `Conexão OK com a Cloudflare (token de usuário ${u.j.result?.status ?? "ativo"}).`;
    const z = await call("/zones?per_page=50");
    if (z.status === 200 && z.j.success) {
      const zs = z.j.result ?? [];
      const names = zs.map((x) => x.name);
      let out = `Conexão OK com a Cloudflare (${name.startsWith("cloudflare:") ? "token geral" : "token de conta/zonas"}). Domínios que este token enxerga: ${names.length ? names.join(", ") : "nenhum (confira as permissões e o escopo de zonas do token)"}.`;
      if (name.startsWith("cloudflare:")) {
        // Relatório de capacidades (leitura): só mostra o que o token consegue FAZER, nunca o valor dele.
        const acc = await call("/accounts?per_page=20");
        const cap = [];
        const z0 = zs[0]?.id;
        const probe = async (label, path) => { const r = await call(path); cap.push(`${r.status === 200 ? "SIM" : r.status === 403 ? "NÃO" : "?"}  ${label}`); };
        if (z0) { await probe("ler DNS", `/zones/${z0}/dns_records?per_page=1`); await probe("ler configurações da zona", `/zones/${z0}/settings`); await probe("ler regras WAF", `/zones/${z0}/rulesets`); await probe("ler certificados de origem", `/zones/${z0}/origin_ca_certificates`.replace(`/zones/${z0}/origin_ca_certificates`, "/certificates")); }
        await probe("listar tokens (gerenciar outros tokens)", "/user/tokens");
        out += `\nContas visíveis: ${(acc.j.result ?? []).map((a) => a.name).join(", ") || "(nenhuma listada)"}\nO token consegue (leitura): \n  ${cap.join("\n  ")}`;
      }
      return out;
    }
    if (u.status === 401 && (z.status === 403 || z.status === 401) && (z.j.errors?.[0]?.code === 9109 || u.j.errors?.[0]?.code === 1000)) throw new Error("A Cloudflare não reconhece este token ('Invalid access token'). Quase sempre é cópia incompleta ou o valor errado (por exemplo, o ID do token, e não o token). Gere de novo ou copie com o botão de copiar.");
    if (z.status === 403) throw new Error("O token é válido, mas sem permissão para ler zonas (precisa de Zone → Zone → Read e Zone → DNS → Edit).");
    throw new Error(`A Cloudflare recusou o token (HTTP ${u.status} em /user e ${z.status} em /zones). Confira se copiou o token inteiro (não a Global API Key).`);
  }
  return "Chave gravada (sem validação automática para este serviço).";
}

const arg = process.argv[2];
if (!arg || arg === "--ajuda") { console.error(`Uso: chave.mjs <${Object.keys(REGISTRY).join("|")}> [--remover] | --listar`); process.exit(1); }

if (arg === "--listar") {
  const l = listKeys();
  console.log(`Arquivo: ${filePath()}`);
  if (!l.length) console.log("(nenhuma chave gravada)");
  for (const k of l) console.log(`- ${k.name} (${k.length} caracteres) — ${k.comment}`);
  process.exit(0);
}

const reg = REGISTRY[arg];
if (!reg) { console.error(`Serviço desconhecido: ${arg}. Opções: ${Object.keys(REGISTRY).join(", ")}`); process.exit(1); }

if (process.argv.includes("--remover")) {
  console.log(removeKey(reg.env) ? `Chave ${reg.env} removida de ${filePath()}.` : `${reg.env} não estava gravada.`);
  process.exit(0);
}

if (process.argv.includes("--validar")) {
  const cur = getKey(reg.env);
  if (!cur) { console.error(`${reg.env} não está gravada.`); process.exit(1); }
  const hint1 = formatHint(arg, cur); if (hint1) console.log(hint1);
  try { console.log(await validate(arg, cur)); } catch (e) { console.error(`Falha na validação: ${e instanceof VultrError ? e.message : e.cause?.code ? `rede (${e.cause.code})` : e.message}`); process.exit(2); }
  process.exit(0);
}

const value = (await askHidden(`Cole a ${reg.label} (não aparece na tela) e tecle Enter: `)).trim();
closePrompt();
if (!value) { console.error("Nada digitado: nada foi gravado."); process.exit(1); }
if (arg === "brevo:smtp-login" && !/^[^\s@]+@smtp-brevo\.com$/.test(value)) { console.error(`Isso não parece o LOGIN SMTP (esperado algo como xxxx@smtp-brevo.com${/^x(smtp|key)sib-/.test(value) ? "; você colou uma CHAVE" : ""}). Nada foi gravado. Dica: o login aparece na aba SMTP do Brevo e também pode ser obtido pela API (rode brevo-api antes).`); process.exit(1); }
if ((arg === "brevo:smtp") && !/^xsmtpsib-/.test(value)) { console.error("A chave SMTP do Brevo começa com xsmtpsib-. O que você colou não tem esse formato. Nada foi gravado."); process.exit(1); }
if (arg === "brevo" && !/^xkeysib-/.test(value)) { console.error("A chave de API v3 do Brevo começa com xkeysib-. O que você colou não tem esse formato. Nada foi gravado."); process.exit(1); }
if (/\s/.test(value)) { console.error("A chave não pode conter espaços ou quebras de linha. Nada foi gravado."); process.exit(1); }

const prev = getKey(reg.env); // para restaurar se o usuário recusar manter a nova
setKey(reg.env, value, `CHAVE API PARA ${reg.title} (gravada em ${today()}; gerenciar em ${reg.manage})`);
console.log(`Chave gravada (${value.length} caracteres) em ${filePath()}, com permissão 600. Ela não foi exibida.`);
const hint0 = formatHint(arg, value); if (hint0) console.log(hint0);

try {
  console.log(await validate(arg, value));
} catch (e) {
  console.error(`\nFalha na validação: ${e instanceof VultrError ? e.message : e.cause?.code ? `rede (${e.cause.code})` : e.message}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question(`Manter a chave gravada mesmo assim? [s/N] `)).trim().toLowerCase();
  rl.close();
  if (ans !== "s" && ans !== "sim") {
    if (prev) { setKey(reg.env, prev, `CHAVE API PARA ${reg.title} (restaurada em ${today()}; gerenciar em ${reg.manage})`); console.log("Chave anterior restaurada."); }
    else { removeKey(reg.env); console.log("Chave removida."); }
  }
  process.exit(2);
}
