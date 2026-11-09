import test from "node:test";
import assert from "node:assert/strict";
import { validate } from "./signatures";
import { IFES, SERVER_INSTITUTIONS, findIfes } from "./ifes-data";
import { municipalityById } from "./geo-data";
import { matchesInstitutionSelection } from "./datasets-client";
import { isInstitutionEligibleForServer } from "./institution-eligibility";

const base = {
  name: "Pessoa Fictícia Teste", email: "qa@uffs.edu.br", cpf: "529.982.247-25",
  category: "servidor", institution: "UFFS", role: "docente", regionDeclared: false, consent: true,
};

test("instituição: texto livre, nomes pessoais, números e sufixos desconhecidos são rejeitados no backend", () => {
  assert.equal(validate(base).ok, true);
  for (const institution of ["", " ", "470553", "Whudson Morais", "João da Silva", "apoio", "Universidade inventada", "UFFS - Nome Qualquer", "UFFS - Campus inventado"]) {
    for (const regionDeclared of [false, true]) {
      const result = validate({ ...base, institution, regionDeclared });
      assert.equal(result.ok, false, institution);
      if (!result.ok) assert.equal(result.errors.institution, "ifes_required", institution);
    }
  }
});

test("instituição: opções reconhecidas são gravadas com a sigla canônica", () => {
  const institution = findIfes("UFFS")!;
  for (const text of [institution.s, "uffs", institution.n, `${institution.s} - ${institution.n}`]) {
    const result = validate({ ...base, institution: text });
    assert.equal(result.ok, true, text);
    if (result.ok) {
      assert.equal(result.value.institution, "UFFS");
      assert.equal(result.value.ifesListed, true);
    }
  }
});

test("catálogo autorizado preserva IFES e acrescenta EBSERH sem duplicar siglas", () => {
  assert.equal(new Set(SERVER_INSTITUTIONS.map((x) => x.s)).size, SERVER_INSTITUTIONS.length);
  for (const institution of IFES) assert.equal(!!findIfes(institution.s), isInstitutionEligibleForServer(institution.id), institution.s);
  const ebserh = findIfes("EBSERH")!;
  assert.equal(ebserh.n, "Empresa Brasileira de Serviços Hospitalares");
  assert.equal(IFES.some((x) => x.s === "EBSERH"), false);
  for (const id of [ebserh.m, ...ebserh.c]) assert.ok(municipalityById(id), String(id));
});

test("catálogo: navegador e backend reconhecem os mesmos nomes e rejeitam sufixos livres", () => {
  for (const institution of SERVER_INSTITUTIONS) {
    for (const text of [institution.s, institution.n, `${institution.s} - ${institution.n}`, `${institution.s}—${institution.n}`]) {
      assert.equal(matchesInstitutionSelection(text, institution), true, text);
      assert.equal(findIfes(text)?.s, institution.s, text);
    }
    const invalid = `${institution.s} - Qualquer nome pessoal`;
    assert.equal(matchesInstitutionSelection(invalid, institution), false);
    assert.equal(findIfes(invalid), null);
  }
});

test("EBSERH: instituição, hospital e cidade são revalidados pelo catálogo autorizado", () => {
  const result = validate({ ...base, institution: "EBSERH", email: "qa@ebserh.gov.br", ebserhUnitId: "hugv-ufam", campus: "Manaus", campusIbge: 1302603, regionDeclared: true });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.institution, "EBSERH");
    assert.equal(result.value.campusIbge, 1302603);
    assert.equal(result.value.regionValidated, true);
  }
  const invalid = validate({ ...base, institution: "EBSERH", email: "qa@ebserh.gov.br", ebserhUnitId: "hospital-inexistente", campus: "São Gabriel da Cachoeira", campusIbge: 1303809, regionDeclared: true });
  assert.equal(invalid.ok, false);
});

test("correção de instituição não torna apoiador dependente de uma IFES", () => {
  const supporter = validate({ ...base, category: "apoiador", email: "qa@gmail.com", institution: "", uf: "RO", city: "Porto Velho" });
  assert.equal(supporter.ok, true);
});
