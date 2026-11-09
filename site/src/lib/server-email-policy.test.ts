import test from "node:test";
import assert from "node:assert/strict";
import { acceptsServerDomain } from "./server-email-policy";
import { IFES, SERVER_INSTITUTIONS, findIfes } from "./ifes-data";
import { resolveInstitutionForEmail, resolveServerInstitutionForEmail } from "./institution-domain-policy";

test("Servidor: kind legado sozinho não autoriza; exige domínio de instituição MEC verificada", () => {
  for (const kind of [null, undefined, "ifes", "governo", "federal", "estadual", "municipal", "legislativo", "judiciario", "ministerio-publico", "ensino-edu-br", "discente", "universidade-estrangeira", "outro"] as const) {
    assert.equal(acceptsServerDomain(kind), false, String(kind));
  }
  for (const domain of ["unir.br", "departamento.unir.br", "ifam.edu.br"]) assert.equal(acceptsServerDomain("ifes", domain), true, domain);
  assert.equal(acceptsServerDomain("discente", "unir.br"), false);
});

test("MEC: militares e outros ministérios preservam titularidade mas não entram em Servidor", () => {
  assert.equal(resolveInstitutionForEmail("pessoa@eb.mil.br")?.institutionId, "org:exercito-brasileiro");
  assert.equal(resolveServerInstitutionForEmail("pessoa@eb.mil.br"), null);
  for (const domain of ["eb.mil.br", "aman.eb.mil.br", "ita.br", "ime.eb.br", "ence.ibge.gov.br"]) assert.equal(acceptsServerDomain("ifes", domain), false, domain);
  assert.ok(IFES.some((institution) => (institution.a ?? []).includes("AMAN") || institution.s === "AMAN"), "histórico original preservado");
  assert.equal(findIfes("AMAN"), null);
  assert.equal(SERVER_INSTITUTIONS.some((institution) => institution.s === "AMAN"), false);
});

test("EBSERH usa a mesma elegibilidade MEC e mantém domínios autorizados", () => {
  for (const domain of ["ebserh.gov.br", "hubrasil.gov.br", " HUBRASIL.GOV.BR ", "sub.ebserh.gov.br"]) {
    assert.equal(acceptsServerDomain("governo", domain), true, domain);
    assert.equal(acceptsServerDomain(null, domain), true, domain);
  }
  for (const domain of ["saude.gov.br", "ebserh.gov.br.evil.org", "fakehubrasil.gov.br", "hubrasil.gov", "", null]) assert.equal(acceptsServerDomain("governo", domain), false, String(domain));
});

test("binding confiável do DB admite domínio novo de instituição MEC e preserva rejeição", () => {
  const unir = resolveServerInstitutionForEmail("teste@unir.br")!;
  assert.ok(unir);
  assert.equal(acceptsServerDomain("ifes", "novo-dominio.example.invalid"), false);
  assert.equal(acceptsServerDomain("ifes", "novo-dominio.example.invalid", { institutionId: unir.institutionId, matchedDomain: "novo-dominio.example.invalid" }), true);
  assert.equal(acceptsServerDomain("ifes", "unir.br", null), false, "rejeição do DB não volta a ser aprovada pelo catálogo estático");
  assert.equal(acceptsServerDomain("ifes", "pessoal.example.invalid", { institutionId: unir.institutionId, matchedDomain: "novo-dominio.example.invalid" }), false);
  assert.equal(acceptsServerDomain("ifes", "eb.mil.br", { institutionId: "org:exercito-brasileiro", matchedDomain: "eb.mil.br" }), false);
});
