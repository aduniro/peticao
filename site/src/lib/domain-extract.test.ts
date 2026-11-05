import test from "node:test";
import assert from "node:assert/strict";
import { extractDomains, registrableDomain } from "./domain-extract";

test("domínio registrável: .br com e sem segundo nível", () => {
  assert.equal(registrableDomain("www.reitoria.unir.br"), "unir.br");
  assert.equal(registrableDomain("x.sp.gov.br"), "sp.gov.br");
  assert.equal(registrableDomain("a.b.com.br"), "b.com.br");
  assert.equal(registrableDomain("cp2.g12.br"), "cp2.g12.br");
  assert.equal(registrableDomain("www.ufpa.br"), "ufpa.br");
  assert.equal(registrableDomain("localhost"), null);
  assert.equal(registrableDomain("a..b.br"), null);
});

test("extração de domínios de e-mails e sites em texto livre (formato do SIORG)", () => {
  const siorg = JSON.stringify([[{ telefone: ["(55) (69) 21822019"], email: ["reitoria@unir.br", "gab@Reitoria.UNIR.br"], site: [] }], [{ site: ["http://www.ufpa.br/portal", "facebook.com/colegio"] }]]);
  assert.deepEqual(extractDomains(siorg).sort(), ["facebook.com", "ufpa.br", "unir.br"].sort());
  assert.deepEqual(extractDomains(null), []);
  assert.deepEqual(extractDomains("sem nada aqui"), []);
});
