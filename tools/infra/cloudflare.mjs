#!/usr/bin/env node
// Operações DNS na Cloudflare usando o token do cofre (~/.config/peticao-infra/keys.env). O token nunca é impresso.
// Uso:  node cloudflare.mjs zonas
//       node cloudflare.mjs dns:listar <dominio>
//       node cloudflare.mjs dns:site <dominio> --ipv4 <ip> [--ipv6 <ip>] [--aplicar]     (sem --aplicar só simula)
import { getKey, REGISTRY, setKey } from "./lib/keystore.mjs";
import { CloudflareError, createCfClient, findZone, listDns, planDns, siteRecords } from "./lib/cloudflare-api.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const flags = {}, pos = [];
for (let i = 0; i < rest.length; i++) { if (rest[i].startsWith("--")) { const nx = rest[i + 1]; if (nx && !nx.startsWith("--")) { flags[rest[i].slice(2)] = nx; i++; } else flags[rest[i].slice(2)] = true; } else pos.push(rest[i]); }
// Conta: --conta sancionaintegral|sancionapresidente|cabanos (padrão: sancionaintegral se houver a chave geral; senão o token antigo)
const conta = flags.conta && flags.conta !== true ? String(flags.conta) : null;
const regKey = conta ? `cloudflare:${conta}` : getKey(REGISTRY["cloudflare:sancionaintegral"].env) ? "cloudflare:sancionaintegral" : "cloudflare";
if (!REGISTRY[regKey]) { console.error(`Conta desconhecida: ${conta}. Opções: sancionaintegral, sancionapresidente, cabanos`); process.exit(1); }
// --usando antigo: usa o token antigo (CLOUDFLARE_API_TOKEN) como quem executa, p.ex. para criar o token geral novo.
const usingReg = flags.usando === "antigo" ? "cloudflare" : regKey;
const token = getKey(REGISTRY[usingReg].env);
if (!cmd || cmd === "ajuda") { console.log("Comandos: zonas | endurecer [dominio] [--aplicar] | token:criar-geral [dominio] [--aplicar] | ajustar <dominio> [--https] [--tls12] [--dnssec] | auditar <dominio> | dns:listar <dominio> | dns:site <dominio> --ipv4 IP [--ipv6 IP] [--aplicar]"); process.exit(0); }
if (!token) { console.error(`Sem token para a conta "${usingReg}". Rode: node /mnt/apps/peticao-final/peticao/tools/infra/chave.mjs ${usingReg}`); process.exit(1); }
const cf = createCfClient({ token });
const show = (r) => `${r.type.padEnd(6)} ${r.name.padEnd(30)} ${String(r.content).padEnd(42)} ${r.proxied ? "proxy LIGADO" : "só DNS"}`;
try {
  if (cmd === "zonas") { for (const z of (await cf.get("/zones?per_page=50")).result) console.log(`  ${z.name}  (${z.status})  ${z.id}`); }
  else if (cmd === "dns:listar" || cmd === "dns:site") {
    const dom = pos[0]; if (!dom) throw new Error("Informe o domínio.");
    const zone = await findZone(cf, dom); if (!zone) throw new Error(`A zona ${dom} não está visível para este token.`);
    const existing = await listDns(cf, zone.id);
    console.log(`Zona ${zone.name} (${zone.status}). Registros atuais: ${existing.length}`);
    existing.forEach((r) => console.log("  " + show(r)));
    if (cmd === "dns:site") {
      if (!flags.ipv4 && !flags.ipv6) throw new Error("Informe --ipv4 e/ou --ipv6.");
      const plan = planDns(existing, siteRecords(dom, { ipv4: flags.ipv4, ipv6: flags.ipv6 }));
      console.log("\nPlano:"); plan.forEach((p) => console.log(`  ${p.action.toUpperCase().padEnd(8)} ${show(p.record)}${p.note ? `  — ${p.note}` : ""}`));
      if (plan.some((p) => p.action === "conflito")) { console.error("\nHá CONFLITOS: nada foi alterado. Resolva no painel (ou me diga como tratar)."); process.exit(3); }
      if (!flags.aplicar) { console.log("\nSIMULAÇÃO: nada foi criado. Repita com --aplicar."); }
      else {
        for (const p of plan.filter((x) => x.action === "criar")) { const r = (await cf.post(`/zones/${zone.id}/dns_records`, p.record)).result; console.log(`  criado: ${show(r)}`); }
        console.log("\nOK. Conferindo:"); (await listDns(cf, zone.id)).forEach((r) => console.log("  " + show(r)));
      }
    }
  } else if (cmd === "auditar") {
    const dom = pos[0]; if (!dom) throw new Error("Informe o domínio.");
    const zone = await findZone(cf, dom); if (!zone) throw new Error(`A zona ${dom} não está visível para este token.`);
    const z = zone.id, tryGet = async (label, path, fmt) => { try { const r = await cf.get(path); console.log(`  OK   ${label}: ${fmt(r.result)}`); return r.result; } catch (e) { console.log(`  --   ${label}: ${e.status === 403 ? "o token NÃO tem permissão para ler isto" : e.message}`); return null; } };
    console.log(`Zona ${zone.name}: status ${zone.status}, plano ${zone.plan?.name ?? "?"}, servidores de nomes: ${(zone.name_servers ?? []).join(", ")}`);
    console.log("\nConfigurações (Zone Settings):");
    const set = await tryGet("lista de configurações", `/zones/${z}/settings`, (r) => `${r.length} itens`);
    if (set) { const m = Object.fromEntries(set.map((x) => [x.id, x.value])); for (const k of ["ssl", "always_use_https", "min_tls_version", "tls_1_3", "automatic_https_rewrites", "opportunistic_encryption", "security_level", "browser_check", "challenge_ttl", "ipv6", "http3", "brotli", "email_obfuscation", "hotlink_protection", "development_mode", "always_online"]) if (k in m) console.log(`       ${k.padEnd(26)} ${typeof m[k] === "object" ? JSON.stringify(m[k]) : m[k]}`); }
    console.log("\nDNSSEC:"); await tryGet("DNSSEC", `/zones/${z}/dnssec`, (r) => r.status);
    console.log("\nRegras de segurança (WAF/ruleset):"); await tryGet("rulesets", `/zones/${z}/rulesets`, (r) => r.map((x) => `${x.phase}(${x.kind})`).join(", ") || "nenhum");
    console.log("\nPage Rules:"); await tryGet("page rules", `/zones/${z}/pagerules`, (r) => (r.length ? r.map((x) => `${x.targets?.[0]?.constraint?.value} → ${x.actions.map((a) => a.id).join("+")} [${x.status}]`).join(" | ") : "nenhuma"));
    console.log("\nDNS: " + (await listDns(cf, z)).length + " registros (use dns:listar para ver).");
  } else if (cmd === "ajustar") {
    // Aplica só o que foi pedido, lendo antes e conferindo depois. Uso: ajustar <dominio> [--https] [--tls12] [--dnssec]
    const dom = pos[0]; if (!dom) throw new Error("Informe o domínio.");
    const zone = await findZone(cf, dom); if (!zone) throw new Error(`A zona ${dom} não está visível para este token.`);
    const z = zone.id, wanted = [];
    if (flags.https) wanted.push({ id: "always_use_https", value: "on", label: "Always Use HTTPS" });
    if (flags.tls12) wanted.push({ id: "min_tls_version", value: "1.2", label: "TLS mínimo" });
    for (const w of wanted) {
      const before = (await cf.get(`/zones/${z}/settings/${w.id}`)).result.value;
      if (before === w.value) { console.log(`  já estava: ${w.label} = ${before}`); continue; }
      try { await cf.patch(`/zones/${z}/settings/${w.id}`, { value: w.value }); }
      catch (e) { console.log(`  FALHOU:  ${w.label}: ${e.status === 403 ? "o token não tem Zone → Zone Settings → Edit" : e.message}`); continue; }
      const after = (await cf.get(`/zones/${z}/settings/${w.id}`)).result.value;
      console.log(`  alterado: ${w.label}: ${before} → ${after}${after === w.value ? "  (confirmado)" : "  (ATENÇÃO: não confirmou)"}`);
    }
    if (flags.dnssec) {
      const d0 = (await cf.get(`/zones/${z}/dnssec`)).result;
      if (d0.status === "active") console.log("  já estava: DNSSEC ativo");
      else {
        try { await cf.patch(`/zones/${z}/dnssec`, { status: "active" }); } catch (e) { console.log(`  FALHOU:  DNSSEC: ${e.status === 403 ? "o token não tem Zone → DNSSEC → Edit" : e.message}`); process.exit(5); }
        const d1 = (await cf.get(`/zones/${z}/dnssec`)).result;
        console.log(`  alterado: DNSSEC: ${d0.status} → ${d1.status}`);
        console.log(`  DS (para o registrador, se ele não for a Cloudflare): ${d1.ds ?? "(ainda sem)"}`);
      }
    }
  } else if (cmd === "endurecer") {
    // Regras de segurança da zona: (1) /admin só dos IPs de casa; (2) limite de requisições nos formulários; (3) HSTS. Sem --aplicar só mostra o plano.
    const dom = pos[0] ?? "sancionaintegral.org";
    const zone = await findZone(cf, dom); if (!zone) throw new Error(`A zona ${dom} não está visível para este token.`);
    const z = zone.id, pub = async (u) => (await fetch(u, { signal: AbortSignal.timeout(10_000) })).text().then((t) => t.trim()).catch(() => "");
    const { v6Prefix64 } = await import("./lib/commands.mjs");
    const v4 = flags["ipv4"] && flags["ipv4"] !== "auto" ? String(flags["ipv4"]) : await pub("https://api.ipify.org");
    const v6a = flags["ipv6"] && flags["ipv6"] !== "auto" ? String(flags["ipv6"]) : await pub("https://api6.ipify.org");
    const allow = [v4 && /^\d+\.\d+\.\d+\.\d+$/.test(v4) ? v4 : null, v6a.includes(":") ? `${v6Prefix64(v6a)}/64` : null, ...(flags.mais ? String(flags.mais).split(",") : [])].filter(Boolean);
    if (!allow.length) throw new Error("Não consegui descobrir o seu IP (use --ipv4 e/ou --ipv6).");
    const adminRule = { description: "Admin só dos IPs de casa (IPv4 atual e prefixo IPv6)", action: "block", enabled: true,
      expression: `(starts_with(http.request.uri.path, "/admin") or starts_with(http.request.uri.path, "/api/admin/")) and not ip.src in {${allow.join(" ")}}` };
    const rlRule = { description: "Limite de envios nos formulários (assinar e contato)", action: "block", enabled: true,
      expression: `(http.request.method eq "POST" and http.request.uri.path in {"/api/assinar" "/api/contato"})`,
      ratelimit: { characteristics: ["cf.colo.id", "ip.src"], period: 10, requests_per_period: 8, mitigation_timeout: 10 } };
    const hsts = { strict_transport_security: { enabled: true, max_age: 15552000, include_subdomains: false, preload: false, nosniff: true } };
    const entry = async (phase) => { try { return (await cf.get(`/zones/${z}/rulesets/phases/${phase}/entrypoint`)).result; } catch (e) { if (e.status === 404) return { rules: [] }; throw e; } };
    const cust = await entry("http_request_firewall_custom"), rate = await entry("http_ratelimit");
    const keep = (rs, desc) => (rs.rules ?? []).filter((r) => r.description !== desc && !/\/admin/.test(r.expression ?? "") === (desc !== adminRule.description) || (r.description !== desc && !(desc === adminRule.description && /\/admin/.test(r.expression ?? ""))));
    const custKeep = (cust.rules ?? []).filter((r) => !(/\/admin/.test(r.expression ?? "")));
    const rateKeep = (rate.rules ?? []).filter((r) => r.description !== rlRule.description);
    console.log(`IPs liberados no /admin: ${allow.join("  ")}`);
    console.log(`\n(1) WAF personalizado — hoje: ${(cust.rules ?? []).map((r) => `[${r.action}] ${r.expression}`).join(" | ") || "nenhuma regra"}`);
    console.log(`    depois: [block] ${adminRule.expression}${custKeep.length ? `\n    + mantidas: ${custKeep.length} outra(s) regra(s)` : ""}`);
    console.log(`(2) Limite de taxa — hoje: ${(rate.rules ?? []).length} regra(s); depois: ${rlRule.ratelimit.requests_per_period} POSTs/${rlRule.ratelimit.period}s por IP em /api/assinar e /api/contato, bloqueio de ${rlRule.ratelimit.mitigation_timeout}s`);
    console.log(`(3) HSTS — depois: max-age ${hsts.strict_transport_security.max_age}s (6 meses), sem includeSubDomains, sem preload, nosniff ligado`);
    if (!flags.aplicar) { console.log("\nSIMULAÇÃO: nada foi alterado. Repita com --aplicar."); process.exit(0); }
    const put = async (phase, rules, label) => { try { await cf.put(`/zones/${z}/rulesets/phases/${phase}/entrypoint`, { rules }); console.log(`  OK    ${label}`); } catch (e) { console.log(`  FALHOU ${label}: ${e.message}`); } };
    await put("http_request_firewall_custom", [adminRule, ...custKeep].map(({ id, version, last_updated, ref, ...r }) => r), "WAF: /admin só dos IPs de casa");
    await put("http_ratelimit", [rlRule, ...rateKeep].map(({ id, version, last_updated, ref, ...r }) => r), "Limite de taxa nos formulários");
    try { await cf.patch(`/zones/${z}/settings/security_header`, { value: hsts }); console.log("  OK    HSTS (6 meses)"); } catch (e) { console.log(`  FALHOU HSTS: ${e.message}`); }
  } else if (cmd === "token:criar-geral") {
    // Cria um token GERAL novo, com as permissões abaixo, usando o poder (API Tokens: Write) do token em uso.
    // O valor do token novo vai DIRETO para o cofre (CLOUDFLARE_API_TOKEN_<CONTA>) e nunca é impresso. Sem --aplicar, só mostra o plano.
    const dom = pos[0] ?? "sancionaintegral.org";
    const zone = await findZone(cf, dom); if (!zone) throw new Error(`A zona ${dom} não está visível para este token.`);
    const acc = zone.account.id;
    const groups = (await cf.get(`/accounts/${acc}/tokens/permission_groups`)).result;
    const pick = (names, scope) => names.map((n) => ({ n, g: groups.find((g) => g.name === n && (g.scopes ?? []).includes(scope)) }));
    const ACCOUNT = ["Account Settings Read", "Account API Tokens Write", "Account Rulesets Write", "Account Firewall Access Rules Write", "Transform Rules Write", "Email Routing Addresses Write", "Turnstile Sites Write", "Registrar Domains Read", "Logs Read"];
    const ZONE = ["Zone Write", "Zone Settings Write", "DNS Write", "SSL and Certificates Write", "Firewall Services Write", "Zone WAF Write", "Cache Purge", "Page Rules Write", "Transform Rules Write", "Email Routing Rules Write", "Config Rules Write", "Analytics Read", "Zone Read"];
    const A = pick(ACCOUNT, "com.cloudflare.api.account"), Z = pick(ZONE, "com.cloudflare.api.account.zone");
    console.log(`Conta ${zone.account.name}. Plano do token geral:`);
    console.log("  Conta:", A.map((x) => `${x.g ? "✓" : "✗ (não existe)"} ${x.n}`).join("\n         "));
    console.log("  Zonas (todas):", Z.map((x) => `${x.g ? "✓" : "✗ (não existe)"} ${x.n}`).join("\n                "));
    if (!flags.aplicar) { console.log("\nSIMULAÇÃO: nada foi criado. Repita com --aplicar."); process.exit(0); }
    const policies = [
      { effect: "allow", resources: { [`com.cloudflare.api.account.${acc}`]: "*" }, permission_groups: A.filter((x) => x.g).map((x) => ({ id: x.g.id })) },
      { effect: "allow", resources: { [`com.cloudflare.api.account.${acc}`]: { "com.cloudflare.api.account.zone.*": "*" } }, permission_groups: Z.filter((x) => x.g).map((x) => ({ id: x.g.id })) },
    ];
    const name = `geral-${(conta ?? "sancionaintegral")}-${new Date().toISOString().slice(0, 10)}`;
    const made = await cf.post(`/accounts/${acc}/tokens`, { name, policies });
    const value = made.result?.value; if (!value) throw new Error("A Cloudflare criou o token mas não devolveu o valor.");
    const targetReg = REGISTRY[`cloudflare:${conta ?? "sancionaintegral"}`];
    setKey(targetReg.env, value, `CHAVE API PARA ${targetReg.title} (criada por API em ${new Date().toISOString().slice(0, 10)}; token "${name}")`);
    console.log(`\nToken "${name}" criado (id ${made.result.id.slice(0, 6)}…) e gravado em ${targetReg.env} (${value.length} caracteres), sem exibir o valor.`);
  } else { console.error(`Comando desconhecido: ${cmd}`); process.exit(1); }
} catch (e) { console.error(e instanceof CloudflareError ? e.message : `Erro: ${e.cause?.code ? `rede (${e.cause.code})` : e.message}`); process.exit(1); }
