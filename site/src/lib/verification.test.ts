import test from "node:test";
import assert from "node:assert/strict";
import { classifyDomain, domainMatches, emailDomain, type ApprovedDomain } from "./institutional";
import { checkCpfName, cpfBrasilProvider, namesMatch, motherNameMatches, birthMatches, ProviderUnavailable, type CpfProvider } from "./cpf-check";
import { maskBirth, normalizeRegistryBirth, parseBirth } from "./birth";
import { checkMx, dedupEmail, isDisposable, _setMxResolverForTests } from "./email-check";

const approved: ApprovedDomain[] = [
  { domain: "unir.br", kind: "ifes", status: "approved" },
  { domain: "ufrj.br", kind: "ifes", status: "approved" },
  { domain: "faculdadeprivada.edu.br", kind: "outro", status: "rejected" },
];

test("domínios: casamento seguro com limite em ponto", () => {
  assert.equal(domainMatches("x.unir.br", "unir.br"), true);
  assert.equal(domainMatches("unir.br", "unir.br"), true);
  assert.equal(domainMatches("fakeunir.br", "unir.br"), false);
  assert.equal(domainMatches("unir.br.evil.com", "unir.br"), false);
});

test("domínios: classificação (aprovados, sufixos, discentes, gratuitos, rejeitados)", () => {
  assert.deepEqual(classifyDomain("unir.br", approved), { kind: "ifes", base: "unir.br" });
  assert.equal(classifyDomain("ppgeb.unir.br", approved)?.kind, "ifes");
  assert.equal(classifyDomain("fakeunir.br", approved), null);
  assert.equal(classifyDomain("unir.br.evil.com", approved), null);
  assert.equal(classifyDomain("gmail.com", approved), null);
  assert.equal(classifyDomain("sp.gov.br", approved)?.kind, "governo");
  assert.equal(classifyDomain("camara.leg.br", approved)?.kind, "legislativo");
  assert.equal(classifyDomain("tjro.jus.br", approved)?.kind, "judiciario");
  assert.equal(classifyDomain("mpro.mp.br", approved)?.kind, "ministerio-publico");
  assert.equal(classifyDomain("usp.edu.br", approved)?.kind, "ensino-edu-br");
  assert.equal(classifyDomain("aluno.ufrj.br", approved)?.kind, "discente");
  assert.equal(classifyDomain("discente.unir.br", approved)?.kind, "discente");
  assert.equal(classifyDomain("faculdadeprivada.edu.br", approved), null); // rejeição vence o sufixo
  assert.equal(classifyDomain("outra.edu.br", approved)?.kind, "ensino-edu-br");
  assert.equal(classifyDomain("empresa.com.br", approved), null);
});

test("domínios: extração do domínio do e-mail (IDN, maiúsculas)", () => {
  assert.equal(emailDomain("Maria@UNIR.br"), "unir.br");
  assert.equal(emailDomain("a@universidade.edu.br."), "universidade.edu.br");
  assert.equal(emailDomain("a@água.gov.br"), "xn--gua-dla.gov.br");
  assert.equal(emailDomain("semarroba"), null);
});

test("nome do CPF: acentos, partículas e cortes obedecem aos mínimos por quantidade; iniciais não bastam", () => {
  assert.equal(namesMatch("MARIA DA SILVA SANTOS", "Maria da Silva Santos"), true);
  assert.equal(namesMatch("JOSÉ AUGUSTO DE OLIVEIRA", "Jose Augusto Oliveira"), true);
  assert.equal(namesMatch("ANA PAULA FERREIRA LIMA", "Ana Lima"), false); // 2 de 4 não atingem o mínimo de 3
  assert.equal(namesMatch("ANA PAULA FERREIRA LIMA", "Ana Costa"), false); // mesmo primeiro nome, sobrenome diferente
  assert.equal(namesMatch("ANA PAULA FERREIRA LIMA", "Ana Paula Lima"), true);
  assert.equal(namesMatch("MARIA SOUZA", "M. Souza"), false);
  assert.equal(namesMatch("MARIA SOUZA", "Joana Souza"), false);
  assert.equal(namesMatch("", "Maria"), false);
});

const rec = (nome: string, mae: string | null = null, nasc: string | null = null) => ({ nome, mae, nasc });

test("nome do CPF: provedor simulado e falhas nunca bloqueiam", async () => {
  const ok: CpfProvider = { name: "x", lookup: async () => rec("MARIA DA SILVA") };
  const other: CpfProvider = { name: "x", lookup: async () => rec("JOSE PEREIRA") };
  const none: CpfProvider = { name: "x", lookup: async () => null };
  const down: CpfProvider = { name: "x", lookup: async () => { throw new ProviderUnavailable("NETWORK"); } };
  assert.equal(await checkCpfName("52998224725", "Maria da Silva", ok), "match");
  assert.equal(await checkCpfName("52998224725", "Maria da Silva", other), "mismatch");
  assert.equal(await checkCpfName("52998224725", "Maria da Silva", none), "mismatch");
  assert.equal(await checkCpfName("52998224725", "Maria da Silva", down), "indisponivel");
  assert.equal(await checkCpfName("52998224725", "Maria da Silva", null), "nao_verificado");
});

test("nome da mãe: sem acento, qualquer caixa, mas palavras e espaços corretos", () => {
  const reg = "MARIA JOSÉ DA CONCEIÇÃO";
  assert.equal(motherNameMatches(reg, "Maria Jose da Conceicao"), true);
  assert.equal(motherNameMatches(reg, "MARIA JOSE DA CONCEICAO"), true);
  assert.equal(motherNameMatches(reg, "maria josé da conceição"), true);
  assert.equal(motherNameMatches(reg, "  Maria   Jose  da   Conceicao  "), true); // espaços repetidos não importam
  assert.equal(motherNameMatches(reg, "MariaJose da Conceicao"), false); // espaço no lugar errado
  assert.equal(motherNameMatches(reg, "Maria Jose Conceicao"), false); // faltou "da": nome incompleto
  assert.equal(motherNameMatches(reg, "Maria"), false);
  assert.equal(motherNameMatches(reg, "Maria Jose da Conceicao Silva"), false); // nome a mais
  assert.equal(motherNameMatches(reg, "Maria Josa da Conceicao"), false); // digitado errado
  assert.equal(motherNameMatches("ROSEMAR MARIA P LUNA", "Rosemar Maria Pereira Luna"), true); // cadastro abreviado
  assert.equal(motherNameMatches("ROSEMAR MARIA P LUNA", "Rosemar Maria Souza Luna"), false);
  assert.equal(motherNameMatches(null, "Maria Silva"), false);
  assert.equal(motherNameMatches("", "Maria Silva"), false);
});

test("nascimento: máscara, datas reais e comparação com o cadastro", () => {
  assert.equal(maskBirth("01021980"), "01/02/1980");
  assert.equal(maskBirth("0102"), "01/02");
  assert.equal(maskBirth("01/02/19801234"), "01/02/1980");
  assert.equal(parseBirth("15/08/1985")?.text, "15/08/1985");
  assert.equal(parseBirth("15081985")?.text, "15/08/1985");
  assert.equal(parseBirth("31/02/1990"), null); // não existe
  assert.equal(parseBirth("29/02/2001"), null); // 2001 não é bissexto
  assert.equal(parseBirth("29/02/2000")?.text, "29/02/2000");
  assert.equal(parseBirth("01/01/1850"), null); // antes de 1900
  assert.equal(parseBirth("01/01/2999"), null); // futuro
  assert.equal(normalizeRegistryBirth("30/11/1899"), "30/11/1899");
  assert.equal(normalizeRegistryBirth("1985-08-15T00:00:00"), "15/08/1985");
  assert.equal(birthMatches("15/08/1985", "15081985"), true);
  assert.equal(birthMatches("15/08/1985", "16/08/1985"), false);
  assert.equal(birthMatches(null, "15/08/1985"), false);
});

test("provedor cpf-brasil v2.0: cabeçalho, URL, resposta com data e códigos de erro", async () => {
  const seen: { url: string; key: string | null }[] = [];
  const mk = (status: number, body: unknown) => (async (url: any, init: any) => { seen.push({ url: String(url), key: new Headers(init.headers).get("x-api-key") }); return new Response(JSON.stringify(body), { status }); }) as typeof fetch;
  const ok = { success: true, data: { CPF: "52998224725", NOME: "MARIA DA SILVA", SEXO: "Feminino", NASC: "15/08/1985", NOME_MAE: "ANA DA SILVA" }, meta: {} };
  assert.deepEqual(await cpfBrasilProvider("K", mk(200, ok)).lookup("52998224725"), { nome: "MARIA DA SILVA", mae: "ANA DA SILVA", nasc: "15/08/1985", sexo: "Feminino" });
  assert.deepEqual(seen[0], { url: "https://api.cpf-brasil.org/cpf/52998224725", key: "K" });
  assert.equal(await cpfBrasilProvider("K", mk(404, { code: "CPF_NOT_FOUND" })).lookup("52998224725"), null);
  assert.deepEqual(await cpfBrasilProvider("K", mk(200, { NOME: "A B" })).lookup("52998224725"), { nome: "A B", mae: null, nasc: null, sexo: null }); // formato plano
  assert.equal((await cpfBrasilProvider("K", mk(200, { success: true, data: { NOME: "A B", NOME_MAE: "", NASC: "" } })).lookup("1"))?.mae, null);
  for (const [status, code] of [[401, "QUOTA_EXCEEDED"], [401, "TOKEN_EXPIRED"], [401, "INVALID_API_KEY"], [401, "PLAN_EXPIRED"], [500, "DATABASE_ERROR"]] as const) {
    await assert.rejects(() => cpfBrasilProvider("K", mk(status, { code })).lookup("52998224725"), (e: any) => e instanceof ProviderUnavailable && e.code === code);
  }
  const net = (async () => { throw new Error("rede"); }) as unknown as typeof fetch;
  await assert.rejects(() => cpfBrasilProvider("K", net).lookup("1"), (e: any) => e instanceof ProviderUnavailable && e.code === "NETWORK");
});

test("nome do CPF: sem chave configurada nenhuma chamada externa acontece", async () => {
  delete process.env.CPF_BRASIL_API_KEY; delete process.env.CPF_MOCK_DATA;
  process.env.SECRETS_DIR = "/nao/existe";
  const orig = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response("{}"); }) as typeof fetch;
  try { assert.equal(await checkCpfName("52998224725", "Maria da Silva"), "nao_verificado"); } finally { globalThis.fetch = orig; delete process.env.SECRETS_DIR; }
  assert.equal(calls, 0);
});

test("e-mail: descartáveis, Gmail e MX", async () => {
  assert.equal(isDisposable("a@mailinator.com"), true);
  assert.equal(isDisposable("a@x.mailinator.com"), true);
  assert.equal(isDisposable("a@unir.br"), false);
  assert.equal(dedupEmail("Maria.Souza+petição@Gmail.com"), "mariasouza@gmail.com");
  assert.equal(dedupEmail("m.souza+x@unir.br"), "m.souza@unir.br");
  _setMxResolverForTests(async (d) => (d === "inexistente.example" ? "none" : d === "caiu.example" ? "erro" : "ok"));
  try {
    assert.equal(await checkMx("a@unir.br"), "ok");
    assert.equal(await checkMx("a@inexistente.example"), "none");
    assert.equal(await checkMx("a@caiu.example"), "erro"); // erro de rede nunca é tratado como "não existe"
  } finally { _setMxResolverForTests(null); }
});

test("máscara do CPF: digitação, colagem e limite", async () => {
  const { maskCpf } = await import("./cpf-mask");
  assert.equal(maskCpf(""), "");
  assert.equal(maskCpf("5"), "5");
  assert.equal(maskCpf("5299"), "529.9");
  assert.equal(maskCpf("529982"), "529.982");
  assert.equal(maskCpf("5299822"), "529.982.2");
  assert.equal(maskCpf("529982247"), "529.982.247");
  assert.equal(maskCpf("5299822472"), "529.982.247-2");
  assert.equal(maskCpf("52998224725"), "529.982.247-25");
  assert.equal(maskCpf("529.982.247-25"), "529.982.247-25"); // colar já formatado
  assert.equal(maskCpf("529982247259999"), "529.982.247-25"); // limite de 11 dígitos
  assert.equal(maskCpf("abc529x982"), "529.982"); // ignora letras
});
