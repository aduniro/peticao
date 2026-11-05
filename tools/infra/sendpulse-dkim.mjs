#!/usr/bin/env node
// Grava no DNS (Cloudflare) o registro DKIM de um domínio de marketing do SendPulse e mostra o status de verificação.
// Uso: node tools/infra/sendpulse-dkim.mjs   (pergunta o domínio, o nome e o valor do TXT que o SendPulse mostrou)
import readline from "node:readline/promises";
import { getKey } from "./lib/keystore.mjs";

const DOMS = { "integral.sancionapresidente.org": ["sancionapresidente.org", "CLOUDFLARE_API_TOKEN_SANCIONAPRESIDENTE"], "servidores.sancionapresidente.org": ["sancionapresidente.org", "CLOUDFLARE_API_TOKEN_SANCIONAPRESIDENTE"], "docentes.magisteriofederal.org": ["magisteriofederal.org", "CLOUDFLARE_API_TOKEN"] };
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lista = Object.keys(DOMS);
lista.forEach((d, i) => console.log(`${i + 1}) ${d}`));
const dom = lista[Number(await rl.question("Número do domínio: ")) - 1];
if (!dom) { console.log("Domínio inválido."); process.exit(1); }
let nome = (await rl.question("Nome do registro TXT mostrado no SendPulse (ex.: sign._domainkey): ")).trim().replace(/\.$/, "");
const valor = (await rl.question("Valor do registro (v=DKIM1; k=rsa; p=...): ")).trim().replace(/^"|"$/g, "");
rl.close();
if (!/^v=DKIM1/i.test(valor) || valor.length < 100) { console.log("O valor não parece um DKIM (deve começar com v=DKIM1). Nada foi gravado."); process.exit(1); }
if (!nome.endsWith(dom) && !nome.endsWith(DOMS[dom][0])) nome = `${nome}.${dom}`;
const [zona, envTok] = DOMS[dom];
const H = { Authorization: "Bearer " + getKey(envTok), "content-type": "application/json" };
const cf = async (p, o = {}) => (await fetch("https://api.cloudflare.com/client/v4" + p, { headers: H, ...o })).json();
const zid = (await cf(`/zones?name=${zona}`)).result?.[0]?.id;
if (!zid) { console.log("Zona não encontrada com a chave atual."); process.exit(1); }
const ex = (await cf(`/zones/${zid}/dns_records?type=TXT&name=${nome}`)).result ?? [];
if (ex.some((x) => x.content.replace(/"/g, "") === valor)) console.log("Esse DKIM já está no DNS.");
else { const r = await cf(`/zones/${zid}/dns_records`, { method: "POST", body: JSON.stringify({ type: "TXT", name: nome, content: valor, ttl: 1 }) }); console.log(r.success ? `Criado: TXT ${nome}` : "ERRO: " + JSON.stringify(r.errors)); }
const t = await (await fetch("https://api.sendpulse.com/oauth/access_token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant_type: "client_credentials", client_id: getKey("SENDPULSE_CLIENT_ID"), client_secret: getKey("SENDPULSE_CLIENT_SECRET") }) })).json();
console.log("Aguarde ~1 min e clique em verificar no SendPulse. Status atual:");
const l = await (await fetch("https://api.sendpulse.com/v2/email-service/smtp/sender_domains", { headers: { Authorization: "Bearer " + t.access_token } })).json();
for (const d of l.data.data) if (DOMS[d.service_value]) console.log(" ", d.service_value, "SPF", d.checks.check_spf, "DKIM", d.checks.check_dkim, "DMARC", d.checks.check_dmarc);
