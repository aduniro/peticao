import test from "node:test";
import assert from "node:assert/strict";
import { validate } from "./signatures";
import { findIfes } from "./ifes-data";
import { normalizedInstitutionEmailDomain, resolveInstitutionForEmail } from "./institution-domain-policy";

const base = { name: "Pessoa Fictícia", email: "teste@unir.br", cpf: "52998224725", category: "servidor", institution: "UNIR", role: "docente", campus: "Porto Velho", campusIbge: 1100205, regionDeclared: false, consent: true };

test("backend exige correspondência instituição-domínio, inclusive sem binding externo", () => {
  for (const email of ["teste@ufam.edu.br", "teste@desconhecido.example", "teste@unir.br.exemplo.org", "teste@eb.mil.br"]) {
    const result = validate({ ...base, email });
    assert.equal(result.ok, false, email);
    if (!result.ok) {
      assert.equal(result.errors.email, "institution_email_mismatch", email);
      assert.equal(result.errors.institution, "institution_email_mismatch", email);
    }
  }
});

test("backend marca Amazônia automaticamente e exige campus mesmo com checkbox falsa", () => {
  const missing = validate({ ...base, campus: "", campusIbge: null });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.errors.campus, "campus_required");
  const valid = validate(base);
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.value.regionDeclared, true);
    assert.equal(valid.value.regionValidated, true);
    assert.equal(valid.value.institution, findIfes("UNIR")!.s);
  }
});

test("binding atual do banco prevalece sobre catálogo estático e rejeição bloqueia", () => {
  const recognized = resolveInstitutionForEmail(base.email)!;
  const fresh = validate({ ...base, email: "teste@novo-dominio.example" }, { institutionMatch: { ...recognized, matchedDomain: "novo-dominio.example" } });
  assert.equal(fresh.ok, true);
  const rejected = validate(base, { institutionMatch: null });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.errors.email, "institution_email_mismatch");
});

test("parser de domínio rejeita URL, múltiplos arrobas, rótulos malformados e espaços", () => {
  for (const value of ["a@b@unir.br", "a@unir.br/path", "a@unir.br:80", "a@-unir.br", "a@unir..br", "a b@unir.br"]) assert.equal(normalizedInstitutionEmailDomain(value), null, value);
  assert.equal(normalizedInstitutionEmailDomain("a@UNIR.BR"), "unir.br");
});
