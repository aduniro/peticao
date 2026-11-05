import test from "node:test";
import assert from "node:assert/strict";
import { suggestDomain, suggestEmail } from "./email-typos";

test("sugere o domínio certo para erros de digitação e não incomoda domínios conhecidos", () => {
  assert.equal(suggestDomain("gmial.com"), "gmail.com");
  assert.equal(suggestDomain("hormail.com"), "hotmail.com");
  assert.equal(suggestDomain("outlook.con"), "outlook.com");
  assert.equal(suggestDomain("ifro.edu.be"), "ifro.edu.br");
  assert.equal(suggestDomain("ufmt.com"), "ufmt.br");
  assert.equal(suggestDomain("ufnt.esu.br"), "ufnt.edu.br");
  assert.equal(suggestDomain("iffarrroupilha.edu.br"), "iffarroupilha.edu.br");
  assert.equal(suggestDomain("ufpel.edu.gov"), "ufpel.edu.br");
});
test("domínio conhecido não gera sugestão; .edu.br legítimo nunca é tratado como erro", () => {
  for (const d of ["unir.br", "ufpa.edu.br", "ifma.edu.br", "gmail.com", "ufgd.edu.br"]) assert.equal(suggestDomain(d), null, d);
  assert.equal(suggestDomain("exemplo.org.br"), null);
  assert.equal(suggestDomain("empresa-xyz.com.br"), null);
});
test("com o servidor de e-mail inexistente, sugere outro domínio conhecido com a mesma sigla (ufpa.edu.br → ufpa.br)", () => {
  assert.equal(suggestDomain("ufpa.edu.br", { semServidor: true }), "ufpa.br");
  assert.equal(suggestEmail("catia.favacho@ufpa.edu.br", { semServidor: true }), "catia.favacho@ufpa.br");
  assert.equal(suggestEmail("maria@gmial.com"), "maria@gmail.com");
  assert.equal(suggestEmail("semarroba"), null);
});
