import test from "node:test";
import assert from "node:assert/strict";
import { isPublicIp, isValidHostname, probeDomain, academicEvidence } from "./domain-probe.mjs";

const resolverFor = (map: Record<string, string[] | "ENOTFOUND" | "EAI_AGAIN">, mx: string[] = []) => ({
  lookup: async (h: string) => {
    const v = map[h];
    if (v === undefined || v === "ENOTFOUND") throw Object.assign(new Error("nf"), { code: "ENOTFOUND" });
    if (v === "EAI_AGAIN") throw Object.assign(new Error("net"), { code: "EAI_AGAIN" });
    return v.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  },
  resolveMx: async (h: string) => { if (mx.includes(h)) return [{ exchange: "mx.example", priority: 10 }]; throw Object.assign(new Error("nodata"), { code: "ENODATA" }); },
});

test("SSRF: só endereços públicos passam", () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "fe80::1", "fc00::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1", "ff02::1", "192.0.2.1"])
    assert.equal(isPublicIp(ip), false, ip);
  for (const ip of ["8.8.8.8", "172.32.0.1", "200.160.2.3", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) assert.equal(isPublicIp(ip), true, ip);
  assert.equal(isPublicIp("não-é-ip"), false);
});

test("nomes de domínio: sintaxe", () => {
  for (const h of ["uni-heidelberg.de", "ox.ac.uk", "xn--bcher-kva.example"]) assert.equal(isValidHostname(h), true, h);
  for (const h of ["localhost", "a..b.com", "-x.com", "exemplo.c", "x".repeat(64) + ".com", "http://x.com", "x.com/caminho", "x .com", ""]) assert.equal(isValidHostname(h), false, h);
});

test("evidência acadêmica: TLD ou palavras", () => {
  assert.equal(academicEvidence("mit.edu").tld, true);
  assert.equal(academicEvidence("ox.ac.uk").tld, true);
  assert.equal(academicEvidence("uni-bonn.de").tld, true);
  assert.equal(academicEvidence("minhaempresa.com", "Loja de sapatos").ok, false);
  assert.equal(academicEvidence("x.com", "Universidad Nacional de Córdoba").words, true);
  assert.equal(academicEvidence("x.fr", "", "École polytechnique").words, true);
});

test("probe: caminho feliz, redirecionamento e bloqueios", async () => {
  const page = (title: string) => ({ status: 200, body: `<html><head><title>${title}</title></head></html>` });
  const calls: string[] = [];
  const mk = (handler: (host: string, path: string) => any) => async (host: string, path: string) => { calls.push(host + path); return handler(host, path); };

  assert.deepEqual((await probeDomain("uni-exemplo.org", { resolver: resolverFor({ "uni-exemplo.org": ["93.184.216.34"] }), fetchOnce: mk(() => page("Universität Beispiel")) })).ok, true);
  // .ac.uk sem conteúdo útil: o TLD acadêmico basta
  assert.equal((await probeDomain("ox.ac.uk", { resolver: resolverFor({ "ox.ac.uk": ["93.184.216.34"] }), fetchOnce: mk(() => page("Home")) })).ok, true);
  // empresa qualquer: real, mas não acadêmica
  const biz = await probeDomain("sapatos.com", { resolver: resolverFor({ "sapatos.com": ["93.184.216.34"] }), fetchOnce: mk(() => page("Loja de Sapatos")) });
  assert.deepEqual([biz.ok, biz.reason], [false, "not_academic"]);
  // domínio que aponta para IP interno: recusa ANTES de conectar
  calls.length = 0;
  const priv = await probeDomain("malicioso.com", { resolver: resolverFor({ "malicioso.com": ["10.0.0.5"] }), fetchOnce: mk(() => page("University")) });
  assert.deepEqual([priv.ok, priv.reason, calls.length], [false, "private_ip", 0]);
  const meta = await probeDomain("metadados.com", { resolver: resolverFor({ "metadados.com": ["169.254.169.254"] }), fetchOnce: mk(() => page("University")) });
  assert.equal(meta.reason, "private_ip");
  // um dos IPs é interno: recusa
  assert.equal((await probeDomain("misto.com", { resolver: resolverFor({ "misto.com": ["8.8.8.8", "127.0.0.1"] }), fetchOnce: mk(() => page("University")) })).reason, "private_ip");
  // redirecionamento para host interno ou http: recusa
  const redirPriv = await probeDomain("redir.com", { resolver: resolverFor({ "redir.com": ["8.8.8.8"], "interno.redir.com": ["192.168.0.1"] }), fetchOnce: mk((h) => (h === "redir.com" ? { status: 302, location: "https://interno.redir.com/" } : page("University"))) });
  assert.equal(redirPriv.reason, "private_ip");
  const redirHttp = await probeDomain("redir2.com", { resolver: resolverFor({ "redir2.com": ["8.8.8.8"] }), fetchOnce: mk(() => ({ status: 302, location: "http://redir2.com/" })) });
  assert.equal(redirHttp.reason, "no_site");
  // redirecionamentos válidos (2 saltos) funcionam; o 3º não
  const chain = (n: number) => mk((h, p) => (p === "/" ? { status: 301, location: "/a" } : p === "/a" ? { status: 301, location: "/b" } : n > 0 && p === "/b" ? { status: 301, location: "/c" } : page("University of X")));
  assert.equal((await probeDomain("salto.org", { resolver: resolverFor({ "salto.org": ["8.8.8.8"] }), fetchOnce: chain(0) })).ok, true);
  assert.equal((await probeDomain("salto.org", { resolver: resolverFor({ "salto.org": ["8.8.8.8"] }), fetchOnce: chain(1) })).reason, "no_site");
  // DNS: domínio que não existe x falha de rede
  assert.equal((await probeDomain("naoexiste.com", { resolver: resolverFor({}), fetchOnce: mk(() => page("x")) })).reason, "no_dns");
  assert.equal((await probeDomain("semrede.com", { resolver: resolverFor({ "semrede.com": "EAI_AGAIN" }), fetchOnce: mk(() => page("x")) })).reason, "network");
  assert.equal((await probeDomain("localhost")).reason, "invalid");
  // servidor que responde 403 a robôs: existe. Com TLD acadêmico basta; sem evidência, não passa
  assert.equal((await probeDomain("cam.ac.uk", { resolver: resolverFor({ "cam.ac.uk": ["8.8.8.8"] }), fetchOnce: mk(() => ({ status: 403, body: "Forbidden" })) })).ok, true);
  assert.equal((await probeDomain("loja.com", { resolver: resolverFor({ "loja.com": ["8.8.8.8"] }), fetchOnce: mk(() => ({ status: 403 })) })).reason, "not_academic");
  // site fora do ar: TLD de uso restrito (.edu) basta; domínio comum sem evidência não passa
  assert.equal((await probeDomain("fora.edu", { resolver: resolverFor({ "fora.edu": ["8.8.8.8"], "www.fora.edu": ["8.8.8.8"] }), fetchOnce: mk(() => ({ status: 0 })) })).ok, true);
  assert.equal((await probeDomain("uct.ac.za", { resolver: resolverFor({ "uct.ac.za": ["8.8.8.8"] }), fetchOnce: mk(() => ({ status: 0 })) })).ok, true);
  assert.equal((await probeDomain("fora.com", { resolver: resolverFor({ "fora.com": ["8.8.8.8"], "www.fora.com": ["8.8.8.8"] }), fetchOnce: mk(() => ({ status: 0 })) })).reason, "no_site");
  // raiz só recebe e-mail (sem A); o site é www.
  const mxOnly = await probeDomain("u-exemplo.ac.jp", { resolver: resolverFor({ "www.u-exemplo.ac.jp": ["8.8.8.8"] }, ["u-exemplo.ac.jp"]), fetchOnce: mk((h) => (h === "www.u-exemplo.ac.jp" ? page("Home") : { status: 0 })) });
  assert.equal(mxOnly.ok, true);
  // só MX, sem nenhum site: TLD comum não passa; domínio inexistente de verdade continua no_dns
  assert.equal((await probeDomain("so-mx.com", { resolver: resolverFor({}, ["so-mx.com"]), fetchOnce: mk(() => ({ status: 0 })) })).reason, "not_academic");
  assert.equal((await probeDomain("nada.edu", { resolver: resolverFor({}), fetchOnce: mk(() => ({ status: 0 })) })).reason, "no_dns");
});
