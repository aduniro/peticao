import test from "node:test";
import assert from "node:assert/strict";
import { allInstitutionCampiInAmazonia, institutionAutofill, institutionMatchesDomain, type InstitutionDomainMatch } from "./institution-form-state";
import { matchesInstitutionSelection, rank, institutionSearchText, type Ifes } from "./datasets-client";
import { formValidationNotice } from "./form-validation-notice";
import { resolveInstitutionForEmail, type InstitutionDomainRule } from "./institution-domain-policy";

const unir: Ifes = { id: "ifes:unir", s: "UNIR", n: "Fundação Universidade Federal de Rondônia", k: "U", u: "RO", m: 1100205, c: [1100122, 1100304] };
const ufam: Ifes = { id: "ifes:ufam", s: "UFAM", n: "Universidade Federal do Amazonas", k: "U", u: "AM", m: 1302603, c: [1301902] };
const match = (institution: Ifes, matchedDomain: string): InstitutionDomainMatch => ({ institutionId: institution.id!, acronym: institution.s, fullName: institution.n, matchedDomain });

test("e-mail preenche instituição uma vez e preserva seleção manual conflitante até correção", () => {
  const initial = institutionAutofill({ domain: null, applied: false }, "pessoa@unir.br", match(unir, "unir.br"), [unir, ufam]);
  assert.equal(initial.institution, unir);
  assert.equal(institutionMatchesDomain(ufam, match(unir, "unir.br")), false);
  assert.equal(institutionMatchesDomain(unir, null), false, "domínio sem vínculo conhecido não valida instituição selecionada");
  const localPartEdit = institutionAutofill(initial.state, "outro@unir.br", match(unir, "unir.br"), [unir, ufam]);
  assert.equal(localPartEdit.institution, null, "não sobrescrever escolha manual após editar só o nome do e-mail");
  const nextDomain = institutionAutofill(localPartEdit.state, "outro@ufam.edu.br", match(ufam, "ufam.edu.br"), [unir, ufam]);
  assert.equal(nextDomain.institution, ufam);
  assert.equal(institutionMatchesDomain(ufam, match(ufam, "ufam.edu.br")), true);
});

test("catálogo tardio permite preenchimento, e voltar a domínio anterior reaplica a instituição", () => {
  const beforeCatalog = institutionAutofill({ domain: null, applied: false }, "pessoa@unir.br", match(unir, "unir.br"), []);
  assert.equal(beforeCatalog.state.applied, false);
  const afterCatalog = institutionAutofill(beforeCatalog.state, "pessoa@unir.br", match(unir, "unir.br"), [unir]);
  assert.equal(afterCatalog.institution, unir);
  const unknown = institutionAutofill(afterCatalog.state, "pessoa@desconhecido.example", null, [unir]);
  assert.equal(unknown.institution, null);
  const back = institutionAutofill(unknown.state, "pessoa@unir.br", match(unir, "unir.br"), [unir]);
  assert.equal(back.institution, unir);
});

test("instituição permanece consistente quando há domínio alternativo ou subdomínio da mesma instituição", () => {
  for (const domain of ["unir.br", "unir.edu.br", "departamento.unir.br"]) {
    const result = institutionAutofill({ domain: null, applied: false }, `pessoa@${domain}`, match(unir, domain), [unir]);
    assert.equal(result.institution, unir);
    assert.equal(institutionMatchesDomain(result.institution, match(unir, domain)), true);
  }
});

test("identificador institucional prevalece, e aliases mantêm a seleção reconhecida", () => {
  const iffar: Ifes = { id: "ifes:farroupilha", s: "IFFAR", a: ["IFFarroupilha", "IFFar"], n: "Instituto Federal Farroupilha", k: "IF", u: "RS", m: 4316907, c: [] };
  assert.equal(matchesInstitutionSelection("IFFarroupilha", iffar), true);
  assert.equal(matchesInstitutionSelection("IFFar", iffar), true);
  assert.equal(rank([iffar], "IFFarroupilha", institutionSearchText)[0]?.id, iffar.id, "buscar alias histórico continua mostrando a instituição oficial");
  assert.equal(institutionMatchesDomain(iffar, match(iffar, "iffarroupilha.edu.br")), true);
  assert.equal(institutionMatchesDomain({ ...iffar, id: "ifes:outra" }, match(iffar, "iffarroupilha.edu.br")), false);
});

test("checkbox automática exige todos os locais na Amazônia, não apenas a sede ou parte dos campi", () => {
  const legalAmazonia = new Set([1100205, 1100122, 1100304, 1302603, 1301902]);
  assert.equal(allInstitutionCampiInAmazonia(unir, legalAmazonia), true);
  assert.equal(allInstitutionCampiInAmazonia(ufam, legalAmazonia), true);
  assert.equal(allInstitutionCampiInAmazonia({ ...unir, c: [...unir.c, 3550308] }, legalAmazonia), false);
  assert.equal(allInstitutionCampiInAmazonia(null, legalAmazonia), false);
});

test("modal explica divergência uma única vez mesmo quando os dois campos estão inválidos", () => {
  const copy = "Este e-mail não corresponde à instituição selecionada.";
  const result = formValidationNotice({ email: "institution_email_mismatch", institution: "institution_email_mismatch" }, { nameMismatch: "Nome inválido", validationText: (detail) => detail }, () => copy);
  assert.equal(result.text, copy);
  assert.equal(result.titleKey, "field.validationTitle");
});


test("domínios reais do resolver: dois domínios e subdomínio, regra específica e fronteira de ponto", () => {
  const rule = (domain: string): InstitutionDomainRule => ({ institutionId: unir.id!, acronym: unir.s, fullName: unir.n, domain, status: "approved", includeSubdomains: true });
  const rules: InstitutionDomainRule[] = [rule("unir.br"), rule("unir.edu.br"), { ...rule("bloqueado.unir.br"), status: "rejected" }];
  for (const email of ["pessoa@unir.br", "pessoa@unir.edu.br", "pessoa@departamento.unir.br"]) {
    const recognized = resolveInstitutionForEmail(email, rules);
    assert.equal(institutionMatchesDomain(unir, recognized), true, email);
    assert.equal(institutionMatchesDomain(ufam, recognized), false, email);
  }
  for (const email of ["pessoa@fakeunir.br", "pessoa@unir.br.evil.example", "pessoa@bloqueado.unir.br"]) {
    assert.equal(resolveInstitutionForEmail(email, rules), null, email);
  }
});
