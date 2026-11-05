#!/usr/bin/env node
// Operações no Vultr pela API, usando a chave do cofre (~/.config/peticao-infra/keys.env). A chave nunca é impressa.
// Uso: node vultr.mjs <comando> [opções]      (veja `node vultr.mjs ajuda`)
import { fileURLToPath } from "node:url";
import { getKey, REGISTRY } from "./lib/keystore.mjs";
import { VultrError, createClient } from "./lib/vultr-api.mjs";
import * as C from "./lib/commands.mjs";
import net from "node:net";

const ISO_DIR = "/mnt/dev/peticao/.cache/iso";
const [cmd, ...rest] = process.argv.slice(2);
const flags = {}, pos = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) { const k = rest[i].slice(2); const nx = rest[i + 1]; if (nx && !nx.startsWith("--")) { flags[k] = nx; i++; } else flags[k] = true; } else pos.push(rest[i]);
}
const AJUDA = `Comandos (somente leitura, exceto onde indicado):
  conta                         valida a chave e mostra a conta (e-mail mascarado)
  regioes                       lista as regiões (confirme o código de São Paulo: sao)
  planos [regiao] [filtro]      planos disponíveis na região (padrão: sao), com vCPU, RAM e preço; ex.: planos sao vhf
  instancia:ipv6 <id>           ativa o IPv6 (grátis) e mostra o endereço e o prefixo
  firewall:listar               grupos de firewall e quantas regras cada um tem
  firewall:criar-site --ssh-v4 <ip|auto> [--ssh-v6 <ip|auto>] [--nome peticao-web]
                                cria o grupo: 443 só dos IPs da Cloudflare; SSH só do seu IP. NÃO anexa à instância
  firewall:aplicar <grupo> <instancia>   anexa e testa o SSH; se travar, desanexa
  firewall:liberar-ssh <grupo> <ip>      acrescenta um IP à regra de SSH (use se o IP de casa mudar)
  firewall:apagar <grupo>
  iso:listar                    ISOs da conta (limite: 2)
  iso:criar <url> [--sha512 H] [--verificar-local]   envia a ISO ao Vultr (a URL precisa ser link direto, sem redirecionamento)
  iso:status <id> [--esperar] [--sha512 H]           estado da ISO (--esperar: aguarda ficar pronta)
  iso:apagar <id>
  instancia:listar | instancia:ver <id>
  instancia:criar --iso <id> --plano vhf-2c-4gb --regiao sao --rotulo X --hostname Y [--backups] [--ipv6] [--tag T] [--sim]
                                SEM --sim apenas SIMULA (mostra o que seria enviado). COM --sim cria e GERA COBRANÇA.
  instancia:destacar-iso <id>   solta a ISO depois de instalar o sistema (reinicia a máquina)
  instancia:apagar <id> --sim   apaga a instância (irreversível)`;

if (!cmd || cmd === "ajuda" || cmd === "--ajuda") { console.log(AJUDA); process.exit(0); }
const key = getKey(REGISTRY.vultr.env);
if (!key) { console.error("Não há chave do Vultr gravada. Rode antes:  node /mnt/dev/peticao/tools/infra/chave.mjs vultr"); process.exit(1); }
const client = createClient({ key });
const tabela = (rows) => rows.forEach((r) => console.log("  " + r.join("  ")));
const mb = (n) => (n ? `${(n / 1024 ** 2).toFixed(0)} MB` : "?");

try {
  switch (cmd) {
    case "conta": { const a = (await client.account())?.account ?? {}; console.log(`Conexão OK. Conta: ${a.name ?? "?"}  Saldo/crédito: ${a.balance ?? "?"}  Gasto pendente: ${a.pending_charges ?? "?"}`); break; }
    case "regioes": { const d = (await client.get("/regions?per_page=100"))?.regions ?? []; tabela(d.map((r) => [r.id.padEnd(5), `${r.city}, ${r.country}`])); break; }
    case "planos": {
      const reg = pos[0] ?? "sao", filtro = (pos[1] ?? "").toLowerCase();
      const avail = new Set((await client.get(`/regions/${reg}/availability?type=all`))?.available_plans ?? []);
      const all = (await client.get("/plans?type=all&per_page=500"))?.plans ?? [];
      const rows = all.filter((p) => avail.has(p.id) && (!filtro || p.id.toLowerCase().includes(filtro)) && !/^v(cg|bm)/.test(p.id)).sort((a, b) => a.monthly_cost - b.monthly_cost);
      console.log(`${avail.size} planos disponíveis em ${reg}${filtro ? ` (filtro: ${filtro})` : ""}. Preço de tabela por mês (a região pode ter acréscimo):`);
      tabela(rows.slice(0, 60).map((p) => [p.id.padEnd(22), `${p.vcpu_count} vCPU`.padEnd(8), `${Math.round(p.ram / 1024)} GB`.padEnd(6), `${p.disk} GB`.padEnd(8), `US$ ${p.monthly_cost}`]));
      break;
    }
    case "instancia:ipv6": { const id = pos[0]; if (!id) throw new Error("Informe o id da instância."); await C.enableIpv6(client, id); const i = await C.getInstance(client, id); console.log(`IPv6 ativado.\nendereço: ${i.v6_main_ip || "(ainda sem; aguarde alguns segundos e rode instancia:ver)"}\nrede: ${i.v6_network}/${i.v6_network_size}`); break; }
    case "firewall:listar": {
      const g = await C.listFirewalls(client); if (!g.length) console.log("Nenhum grupo.");
      for (const x of g) { const n = (await C.listFirewallRules(client, x.id)).length; console.log(`  ${x.id}  ${n} regras  ${x.description}`); }
      break;
    }
    case "firewall:criar-site": {
      const pub = async (u) => (await fetch(u, { signal: AbortSignal.timeout(10_000) })).text().then((t) => t.trim()).catch(() => "");
      const sshV4 = flags["ssh-v4"] === "auto" ? await pub("https://api.ipify.org") : flags["ssh-v4"];
      const sshV6 = flags["ssh-v6"] === "auto" ? await pub("https://api6.ipify.org") : flags["ssh-v6"];
      if (!sshV4 && !sshV6) throw new Error("Informe --ssh-v4 <ip|auto> (e, se quiser, --ssh-v6).");
      const rules = C.buildSiteRules({ cf: await C.fetchCloudflareRanges(), sshV4, sshV6: sshV6 || undefined });
      const g = await C.createSiteFirewall(client, flags.nome ?? "peticao-web", rules);
      console.log(`Grupo criado: ${g.id} (${rules.length} regras). 443 só da Cloudflare; SSH só de ${[sshV4, sshV6 && `${sshV6.split(":").slice(0, 4).join(":")}::/64`].filter(Boolean).join(" e ")}.\nAinda NÃO está anexado a nenhuma instância. Próximo: firewall:aplicar ${g.id} <instancia>`);
      break;
    }
    case "firewall:aplicar": {
      const [gid, iid] = pos; if (!gid || !iid) throw new Error("Uso: firewall:aplicar <grupo> <instancia>");
      const inst = await C.getInstance(client, iid);
      const check = () => new Promise((res) => { const s = net.connect({ host: inst.main_ip, port: 22, timeout: 6000 }); s.once("connect", () => { s.destroy(); res(true); }); s.once("timeout", () => { s.destroy(); res(false); }); s.once("error", () => res(false)); });
      const r = await C.applyFirewall(client, gid, iid, { check });
      if (r.ok) console.log("Firewall aplicado e o SSH continua acessível daqui.");
      else { console.error(r.reverted ? "O SSH deixou de responder; o grupo foi DESANEXADO para não te trancar fora. Confira o IP da regra de SSH." : "O SSH deixou de responder E não consegui desanexar. Use o painel: Instance → Firewall → desanexar (ou o console VNC)."); process.exit(4); }
      break;
    }
    case "firewall:liberar-ssh": {
      const [gid, ip] = pos; if (!gid || !ip) throw new Error("Uso: firewall:liberar-ssh <grupo> <ip>");
      const v6 = ip.includes(":"); const rule = v6 ? { ip_type: "v6", protocol: "tcp", subnet: C.v6Prefix64(ip), subnet_size: 64, port: "22", notes: "SSH - IP acrescentado" } : { ip_type: "v4", protocol: "tcp", subnet: ip, subnet_size: 32, port: "22", notes: "SSH - IP acrescentado" };
      if (!v6 && !net.isIPv4(ip)) throw new Error("IP inválido."); await client.post(`/firewalls/${gid}/rules`, rule); console.log(`Regra de SSH acrescentada para ${v6 ? rule.subnet + "/64" : ip}.`); break;
    }
    case "firewall:apagar": { if (!pos[0]) throw new Error("Informe o grupo."); await client.del(`/firewalls/${pos[0]}`); console.log("Grupo apagado."); break; }
    case "iso:listar": { const l = await C.listIsos(client); if (!l.length) console.log("Nenhuma ISO na conta."); tabela(l.map((i) => [i.id, i.status.padEnd(9), mb(i.size).padStart(8), i.filename ?? ""])); break; }
    case "iso:criar": {
      const url = pos[0]; if (!url) throw new Error("Informe a URL da ISO.");
      const chk = await C.checkIsoUrl(url);
      if (!chk.ok) { console.error("A URL não serve para o Vultr:\n- " + chk.problems.join("\n- ")); process.exit(2); }
      console.log(`URL ok (${chk.size ? mb(chk.size) : "tamanho não informado"}).`);
      if (flags["verificar-local"]) {
        console.log("Baixando para conferir o SHA-256 oficial (pode demorar)…");
        const v = await C.verifyLocalSha256(url, ISO_DIR);
        console.log(v.ok ? `SHA-256 confere com ${v.sumsUrl}` : `SHA-256 NÃO CONFERE! esperado ${v.expected}, obtido ${v.got}`);
        if (!v.ok) process.exit(3);
      }
      const iso = await C.createIso(client, url);
      console.log(`ISO enviada ao Vultr. id: ${iso.id}  estado: ${iso.status}`);
      console.log(`Acompanhe com:  node ${fileURLToPath(import.meta.url)} iso:status ${iso.id} --esperar${flags.sha512 ? ` --sha512 ${flags.sha512}` : ""}`);
      break;
    }
    case "iso:status": {
      const id = pos[0]; if (!id) throw new Error("Informe o id da ISO.");
      const iso = flags.esperar ? await C.waitIso(client, id, { onTick: (i) => process.stdout.write(`\r  estado: ${i?.status ?? "?"}   `) }) : (await client.get(`/iso/${id}`))?.iso;
      if (flags.esperar) process.stdout.write("\n");
      console.log(`id: ${iso.id}\narquivo: ${iso.filename}\nestado: ${iso.status}\ntamanho: ${mb(iso.size)}\nmd5: ${iso.md5sum ?? "?"}\nsha512: ${iso.sha512sum ?? "?"}`);
      if (flags.sha512 && typeof flags.sha512 === "string") console.log(C.sha512Matches(iso, flags.sha512) ? "SHA-512 CONFERE com o oficial." : "SHA-512 NÃO CONFERE com o oficial informado!");
      break;
    }
    case "iso:apagar": { const id = pos[0]; if (!id) throw new Error("Informe o id."); await client.del(`/iso/${id}`); console.log("ISO apagada."); break; }
    case "instancia:listar": { const l = await C.listInstances(client); if (!l.length) console.log("Nenhuma instância."); tabela(l.map((i) => [i.id, String(i.status).padEnd(8), i.plan, i.region, i.label ?? ""])); break; }
    case "instancia:ver": { const i = await C.getInstance(client, pos[0]); console.log(`id: ${i.id}\nestado: ${i.status} / ${i.power_status} / ${i.server_status}\nplano: ${i.plan}  região: ${i.region}\nrótulo: ${i.label}\nIPv4: ${i.main_ip}\nIPv6: ${i.v6_main_ip || "-"}\nsenha de root: (use o console VNC; a API devolve a senha só na criação)`); break; }
    case "instancia:criar": {
      const r = await C.createInstance(client, { iso: flags.iso, plano: flags.plano, regiao: flags.regiao, rotulo: flags.rotulo, hostname: flags.hostname, backups: !!flags.backups, ipv6: !!flags.ipv6, tag: flags.tag }, !!flags.sim);
      if (r.simulacao) { console.log("SIMULAÇÃO (nada foi criado, nada foi cobrado). Seria enviado:\n" + JSON.stringify(r.payload, null, 2) + "\n\nPara criar de verdade (a cobrança por hora começa na criação), repita o comando com --sim."); break; }
      console.log(`Instância criada. id: ${r.instance.id}  estado: ${r.instance.status}\nAbra o console VNC no painel do Vultr (Instances → View Console) e conclua a instalação. Depois rode: instancia:destacar-iso ${r.instance.id}`);
      break;
    }
    case "instancia:destacar-iso": { await C.detachIso(client, pos[0]); console.log("ISO destacada; a instância será reiniciada."); break; }
    case "instancia:apagar": { if (!flags.sim) { console.log("Isto apaga a instância de forma irreversível. Repita com --sim para confirmar."); break; } await C.deleteInstance(client, pos[0]); console.log("Instância apagada."); break; }
    default: console.error(`Comando desconhecido: ${cmd}\n\n${AJUDA}`); process.exit(1);
  }
} catch (e) {
  console.error(e instanceof VultrError ? e.message : `Erro: ${e.cause?.code ? `rede (${e.cause.code})` : e.message}`);
  process.exit(1);
}
