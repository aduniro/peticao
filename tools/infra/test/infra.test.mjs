import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "infra-test-"));
process.env.PETICAO_INFRA_DIR = join(dir, "cfg");
const K = await import("../lib/keystore.mjs");
const { createClient, VultrError } = await import("../lib/vultr-api.mjs");
const C = await import("../lib/commands.mjs");

const res = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => (typeof body === "string" ? body : JSON.stringify(body ?? {})) });

test("cofre: comentário acima da chave, troca só o bloco, preserva as outras, permissões 600/700", () => {
  K.setKey("VULTR_API_KEY", "AAAA1111", "CHAVE API PARA VULTR (teste)");
  K.setKey("CLOUDFLARE_API_TOKEN", "BBBB2222", "CHAVE API PARA CLOUDFLARE (teste)");
  let txt = readFileSync(K.filePath(), "utf8");
  assert.match(txt, /^# CHAVE API PARA VULTR \(teste\)\nVULTR_API_KEY=AAAA1111\n\n# CHAVE API PARA CLOUDFLARE \(teste\)\nCLOUDFLARE_API_TOKEN=BBBB2222\n$/);
  K.setKey("VULTR_API_KEY", "CCCC3333", "CHAVE API PARA VULTR (nova)");
  txt = readFileSync(K.filePath(), "utf8");
  assert.equal(K.getKey("VULTR_API_KEY"), "CCCC3333");
  assert.equal(K.getKey("CLOUDFLARE_API_TOKEN"), "BBBB2222");
  assert.equal((txt.match(/CHAVE API PARA VULTR/g) ?? []).length, 1); // sem comentário duplicado
  assert.ok(txt.includes("CHAVE API PARA CLOUDFLARE (teste)"));
  assert.equal(statSync(K.filePath()).mode & 0o777, 0o600);
  assert.equal(statSync(K.dirPath()).mode & 0o777, 0o700);
  assert.ok(!existsSync(`${K.filePath()}.tmp`));
});

test("cofre: listagem nunca traz o valor; remover tira chave e comentário; recusa espaços", () => {
  const l = K.listKeys();
  assert.deepEqual(l.map((k) => k.name), ["VULTR_API_KEY", "CLOUDFLARE_API_TOKEN"]);
  assert.ok(!JSON.stringify(l).includes("CCCC3333") && !JSON.stringify(l).includes("BBBB2222"));
  assert.ok(l[0].comment.includes("CHAVE API PARA VULTR"));
  assert.throws(() => K.setKey("VULTR_API_KEY", "com espaço", "x"));
  assert.throws(() => K.setKey("vultr", "abc", "x"));
  assert.equal(K.removeKey("VULTR_API_KEY"), true);
  const txt = readFileSync(K.filePath(), "utf8");
  assert.ok(!txt.includes("VULTR") && txt.includes("CLOUDFLARE_API_TOKEN=BBBB2222"));
  assert.equal(K.mask("maria@exemplo.org"), "m***@exemplo.org");
});

test("cliente: Bearer no cabeçalho, erros 401/403/429 em português e sem vazar a chave", async () => {
  const seen = [];
  const mk = (status, body) => createClient({ key: "SEGREDO123", fetchImpl: async (url, init) => { seen.push({ url, init }); return res(status, body); } });
  const ok = await mk(200, { account: { name: "ADUNIR", email: "a@b.org" } }).account();
  assert.equal(ok.account.name, "ADUNIR");
  assert.equal(seen[0].init.headers.Authorization, "Bearer SEGREDO123");
  assert.ok(!seen[0].url.includes("SEGREDO123")); // nunca na URL
  for (const [st, re] of [[401, /inválida/], [403, /Access Control/], [429, /Limite/]]) {
    await assert.rejects(() => mk(st, { error: "x" }).account(), (e) => e instanceof VultrError && re.test(e.message) && !e.message.includes("SEGREDO123"));
  }
});

test("URL da ISO: aceita link direto; recusa ?, redirecionamento, não-.iso e ≥ 10 GB", async () => {
  const f = (status, h = {}) => async () => res(status, "", h);
  assert.equal((await C.checkIsoUrl("https://releases.ubuntu.com/24.04.4/ubuntu-24.04.4-live-server-amd64.iso", f(200, { "content-length": "3400000000" }))).ok, true);
  const q = await C.checkIsoUrl("https://x.org/a.iso?token=1", f(200)); assert.ok(!q.ok && q.problems.some((p) => /parâmetros/.test(p)));
  const r = await C.checkIsoUrl("https://x.org/a.iso", f(302, { location: "https://y.org/a.iso" })); assert.ok(!r.ok && r.problems.some((p) => /redireciona/.test(p)));
  const n = await C.checkIsoUrl("https://x.org/a.img", f(200)); assert.ok(!n.ok && n.problems.some((p) => /\.iso/.test(p)));
  const big = await C.checkIsoUrl("https://x.org/a.iso", f(200, { "content-length": String(11 * 1024 ** 3) })); assert.ok(!big.ok);
  assert.ok(!(await C.checkIsoUrl("https://u:p@x.org/a.iso", f(200))).ok);
});

test("ISO: limite de 2 por conta, criação, espera até 'complete', comparação do SHA-512", async () => {
  const calls = [];
  const client = { get: async (p) => { calls.push(["GET", p]); if (p.startsWith("/iso?")) return { isos: [{ id: "1", status: "complete" }] }; return { iso: { id: "9", status: calls.filter((c) => c[1] === "/iso/9").length < 3 ? "pending" : "complete", sha512sum: "ABCDEF" } }; }, post: async (p, b) => { calls.push(["POST", p, b]); return { iso: { id: "9", status: "pending" } }; } };
  const iso = await C.createIso(client, "https://x.org/a.iso");
  assert.equal(iso.id, "9");
  assert.deepEqual(calls.find((c) => c[0] === "POST").slice(1), ["/iso", { url: "https://x.org/a.iso" }]);
  const done = await C.waitIso(client, "9", { intervalMs: 0, sleep: async () => {} });
  assert.equal(done.status, "complete");
  assert.ok(C.sha512Matches(done, "abcdef") && !C.sha512Matches(done, "000000"));
  const full = { get: async () => ({ isos: [{ id: "1", status: "complete" }, { id: "2", status: "complete" }] }), post: async () => { throw new Error("não devia chamar"); } };
  await assert.rejects(() => C.createIso(full, "https://x.org/a.iso"), /limite de 2/);
});

test("instância: simulação por padrão NÃO chama a API; --sim envia o payload certo", async () => {
  let posts = 0;
  const client = { post: async (p, b) => { posts++; assert.equal(p, "/instances"); assert.equal(b.iso_id, "9"); return { instance: { id: "i1", status: "pending" } }; } };
  const o = { iso: "9", plano: "vhf-2c-4gb", regiao: "sao", rotulo: "peticao-sp", hostname: "peticao-sp", backups: true, ipv6: false };
  const sim = await C.createInstance(client, o, false);
  assert.equal(sim.simulacao, true); assert.equal(posts, 0);
  assert.deepEqual(sim.payload, { region: "sao", plan: "vhf-2c-4gb", iso_id: "9", label: "peticao-sp", hostname: "peticao-sp", backups: "enabled", enable_ipv6: false });
  const real = await C.createInstance(client, o, true);
  assert.equal(real.instance.id, "i1"); assert.equal(posts, 1);
  assert.throws(() => C.instancePayload({ iso: "9" }), /Faltam opções/);
});

test("SHA-256 local: confere com o SHA256SUMS e apaga o arquivo baixado", async () => {
  const { createHash } = await import("node:crypto");
  const body = Buffer.from("conteudo-da-iso");
  const sum = createHash("sha256").update(body).digest("hex");
  const fetchImpl = async (url) => url.endsWith("SHA256SUMS")
    ? { ok: true, status: 200, text: async () => `${sum} *a.iso\n${"0".repeat(64)} outra.iso\n` }
    : { ok: true, status: 200, body: new ReadableStream({ start(c) { c.enqueue(body); c.close(); } }) };
  const out = join(dir, "iso");
  const v = await C.verifyLocalSha256("https://x.org/d/a.iso", out, { fetchImpl });
  assert.equal(v.ok, true);
  assert.ok(!existsSync(join(out, "a.iso")));
  const bad = await C.verifyLocalSha256("https://x.org/d/a.iso", out, { fetchImpl: async (u) => u.endsWith("SHA256SUMS") ? { ok: true, status: 200, text: async () => `${"1".repeat(64)}  a.iso\n` } : fetchImpl(u) });
  assert.equal(bad.ok, false);
});

test("firewall: prefixo /64 do IPv6, regras 443 só Cloudflare + SSH só do IP, limites e rollback", async () => {
  assert.equal(C.v6Prefix64("2804:14d:cc84:8308:f0cc:2dcb:c0ee:541b"), "2804:14d:cc84:8308::");
  assert.equal(C.v6Prefix64("2001:db8::1"), "2001:db8:0:0::");
  const cf = { v4: ["173.245.48.0/20"], v6: ["2400:cb00::/32"] };
  const rules = C.buildSiteRules({ cf, sshV4: "181.220.194.115", sshV6: "2804:14d:cc84:8308::1" });
  assert.deepEqual(rules.map((r) => `${r.ip_type} ${r.subnet}/${r.subnet_size}:${r.port}`), ["v4 173.245.48.0/20:443", "v6 2400:cb00::/32:443", "v4 181.220.194.115/32:22", "v6 2804:14d:cc84:8308::/64:22"]);
  assert.ok(!rules.some((r) => r.subnet === "0.0.0.0" || r.subnet === "::")); // nada aberto ao mundo
  assert.throws(() => C.buildSiteRules({ cf, sshV4: "999.1.1.1" }));
  const bad = async () => ({ ok: true, status: 200, text: async () => "1.2.3.4/99\n" });
  await assert.rejects(() => C.fetchCloudflareRanges(bad), /inesperada/);
  // limite de regras: apaga o grupo criado
  const calls = [];
  const cl = { post: async (p) => { calls.push(p); return p === "/firewalls" ? { firewall_group: { id: "g1", max_rule_count: 2 } } : {}; }, del: async (p) => { calls.push("DEL " + p); } };
  await assert.rejects(() => C.createSiteFirewall(cl, "x", rules), /limite do grupo/);
  assert.ok(calls.includes("DEL /firewalls/g1"));
  // aplicar: ok; e travou -> tenta desanexar
  const patches = [];
  const c2 = { patch: async (p, b) => { patches.push(b); return {}; } };
  assert.deepEqual(await C.applyFirewall(c2, "g1", "i1", { check: async () => true, waitMs: 0, sleep: async () => {} }), { ok: true });
  let n = 0; const blocked = async () => (n++ === 0);
  const r = await C.applyFirewall(c2, "g1", "i1", { check: blocked, waitMs: 0, sleep: async () => {} });
  assert.deepEqual(r, { ok: false, reverted: true });
  assert.deepEqual(patches.at(-1), { firewall_group_id: "" });
  await assert.rejects(() => C.applyFirewall(c2, "g1", "i1", { check: async () => false, waitMs: 0, sleep: async () => {} }), /ANTES/);
});

test("DNS do site: A/AAAA/CNAME com proxy; planeja criar/manter/conflito sem nunca apagar", async () => {
  const { siteRecords, planDns, createCfClient, CloudflareError } = await import("../lib/cloudflare-api.mjs");
  const want = siteRecords("sancionaintegral.org", { ipv4: "216.128.169.215", ipv6: "2001:19f0:b800:266e:5400:6ff:fefd:6233" });
  assert.deepEqual(want.map((r) => `${r.type} ${r.name} ${r.proxied}`), ["A sancionaintegral.org true", "AAAA sancionaintegral.org true", "CNAME www.sancionaintegral.org true"]);
  assert.deepEqual(planDns([], want).map((p) => p.action), ["criar", "criar", "criar"]);
  const ex = [{ type: "A", name: "sancionaintegral.org", content: "216.128.169.215", proxied: true }, { type: "AAAA", name: "sancionaintegral.org", content: "2001:19F0:B800:266E:5400:06FF:FEFD:6233", proxied: true }];
  assert.deepEqual(planDns(ex, want).map((p) => p.action), ["manter", "manter", "criar"]); // IPv6 igual com zeros/maiúsculas diferentes
  const clash = planDns([{ type: "A", name: "sancionaintegral.org", content: "1.2.3.4", proxied: false }, { type: "A", name: "www.sancionaintegral.org", content: "1.2.3.4" }], want);
  assert.equal(clash[0].action, "conflito"); assert.equal(clash[2].action, "conflito"); // CNAME x A existente
  // 403 vira mensagem útil e não vaza o token
  const cf = createCfClient({ token: "TOKSECRETO", fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ success: false, errors: [{ code: 10000, message: "Authentication error" }] }) }) });
  await assert.rejects(() => cf.get("/zones/x/dns_records"), (e) => e instanceof CloudflareError && /Zone → DNS → Edit/.test(e.message) && !e.message.includes("TOKSECRETO"));
});

test("cofre: uma chave por conta da Cloudflare, cada uma com seu comentário", () => {
  const dir2 = mkdtempSync(join(tmpdir(), "infra-test2-"));
  process.env.PETICAO_INFRA_DIR = join(dir2, "cfg");
  K.setKey(K.REGISTRY["cloudflare:sancionaintegral"].env, "GERALAAA", `CHAVE API PARA ${K.REGISTRY["cloudflare:sancionaintegral"].title}`);
  K.setKey(K.REGISTRY["cloudflare:sancionapresidente"].env, "OUTRABBB", `CHAVE API PARA ${K.REGISTRY["cloudflare:sancionapresidente"].title}`);
  assert.equal(K.getKey("CLOUDFLARE_API_TOKEN_SANCIONAINTEGRAL"), "GERALAAA");
  assert.equal(K.getKey("CLOUDFLARE_API_TOKEN_SANCIONAPRESIDENTE"), "OUTRABBB");
  const txt = readFileSync(K.filePath(), "utf8");
  assert.match(txt, /# CHAVE API PARA CLOUDFLARE — CONTA sancionaintegral\.org[^\n]*\nCLOUDFLARE_API_TOKEN_SANCIONAINTEGRAL=GERALAAA\n/);
  assert.match(txt, /# CHAVE API PARA CLOUDFLARE — CONTA sancionapresidente\.org[^\n]*\nCLOUDFLARE_API_TOKEN_SANCIONAPRESIDENTE=OUTRABBB\n/);
  assert.ok(!JSON.stringify(K.listKeys()).includes("GERALAAA"));
  process.env.PETICAO_INFRA_DIR = join(dir, "cfg");
});

test("Mailrelay: ping 204 válido, 401 recusado, chave só no cabeçalho X-AUTH-TOKEN", async () => {
  const { validateMailrelay } = await import("../lib/mailrelay-api.mjs");
  const seen = [];
  const mk = (status, body) => async (url, init) => { seen.push({ url, h: init.headers }); return { status, text: async () => (body ? JSON.stringify(body) : "") }; };
  const ok = await validateMailrelay("SEGREDOMR", { fetchImpl: async (u, i) => (u.endsWith("/ping") ? mk(204)(u, i) : mk(200, [{ email: "contato@magisteriofederal.org" }])(u, i)) });
  assert.match(ok, /Conexão OK com o Mailrelay.*contato@magisteriofederal\.org/);
  assert.equal(seen[0].url, "https://sancionapresidente.ipzmarketing.com/api/v1/ping");
  assert.equal(seen[0].h["X-AUTH-TOKEN"], "SEGREDOMR");
  assert.ok(!seen[0].url.includes("SEGREDOMR"));
  await assert.rejects(() => validateMailrelay("x", { fetchImpl: mk(401) }), (e) => /recusou a chave/.test(e.message) && !e.message.includes("SEGREDOMR"));
  await assert.rejects(() => validateMailrelay("x", { fetchImpl: mk(404) }), /não encontrada/);
});

test("Mailrelay: POST/PATCH enviam JSON e a chave só no cabeçalho", async () => {
  const { mailrelayCall } = await import("../lib/mailrelay-api.mjs");
  let seen;
  const f = async (url, init) => { seen = { url, init }; return { status: 201, text: async () => '{"id":2}' }; };
  const r = await mailrelayCall("/senders", "SEGREDOMR", { fetchImpl: f, method: "POST", body: { name: "X", email: "a@b.org" } });
  assert.equal(r.status, 201); assert.equal(r.json.id, 2);
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers["content-type"], "application/json");
  assert.equal(JSON.parse(seen.init.body).email, "a@b.org");
  assert.ok(!seen.url.includes("SEGREDOMR") && !seen.init.body.includes("SEGREDOMR"));
});

test("AWS SigV4: bate com o vetor oficial da documentação da AWS (IAM ListUsers)", async () => {
  const { signV4 } = await import("../lib/aws-api.mjs");
  const r = signV4({ method: "GET", url: "https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08", headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" }, service: "iam", region: "us-east-1", accessKey: "AKIDEXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", amzDate: "20150830T123600Z" });
  assert.equal(r.authorization, "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7");
});

test("AWS whoAmI: lê conta/ARN; chave recusada dá erro claro sem vazar a secret", async () => {
  const { whoAmI } = await import("../lib/aws-api.mjs");
  const ok = async () => ({ status: 200, text: async () => "<GetCallerIdentityResponse><GetCallerIdentityResult><Arn>arn:aws:iam::950171332722:user/claude-ses</Arn><Account>950171332722</Account></GetCallerIdentityResult></GetCallerIdentityResponse>" });
  assert.deepEqual(await whoAmI("AKIAX", "SEGREDOAWS", { fetchImpl: ok }), { account: "950171332722", arn: "arn:aws:iam::950171332722:user/claude-ses" });
  const bad = async () => ({ status: 403, text: async () => "<ErrorResponse><Error><Code>SignatureDoesNotMatch</Code></Error></ErrorResponse>" });
  await assert.rejects(() => whoAmI("AKIAX", "SEGREDOAWS", { fetchImpl: bad }), (e) => /SignatureDoesNotMatch/.test(e.message) && !e.message.includes("SEGREDOAWS"));
});
