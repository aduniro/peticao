import test from "node:test";
import assert from "node:assert/strict";
import registry from "../../public/data/institution-registry.json";
import { getInstitutionEligibility, isInstitutionEligibleForServer } from "./institution-eligibility";
import { resolveInstitutionForEmail as resolveOwner } from "./institution-domain-policy";

test("MEC: instituições desconhecidas falham fechado e titularidade não é autorização", () => {
  for (const id of [null, undefined, "", "ifes:9999", "org:fiocruz", "test:institution"]) {
    assert.equal(isInstitutionEligibleForServer(id), false, String(id));
  }
  const owner = resolveOwner("pessoa@eb.mil.br");
  assert.equal(owner?.institutionId, "org:exercito-brasileiro");
  assert.equal(owner?.fullName, "Exército Brasileiro");
  assert.equal(isInstitutionEligibleForServer(owner?.institutionId), false);
  assert.equal(resolveOwner("pessoa@fakeeb.mil.br"), null);
});

test("MEC: catálogo conserva instituições históricas e bloqueia todos os dez casos externos", () => {
  const excluded = ["ifes:0071", "ifes:0074", "ifes:0076", "ifes:0077", "ifes:0078", "ifes:0079", "ifes:0080", "ifes:0119", "ifes:0121", "ifes:0122"];
  for (const id of excluded) {
    assert.ok(registry.some((institution) => institution.id === id), `histórico ${id} preservado`);
    assert.equal(isInstitutionEligibleForServer(id), false, id);
  }
  assert.equal(registry.filter((institution) => institution.id.startsWith("ifes:")).length, 122);
});

test("MEC: universidades, IFs, CPII, INES, novas UFCIs e EBSERH têm evidência e IDs estáveis", () => {
  for (const id of ["ifes:0001", "ifes:0017", "ifes:0060", "ifes:0067", "ifes:0072", "ifes:0073", "ifes:0075", "ifes:0095", "ifes:0120", "org:ebserh"]) {
    assert.equal(isInstitutionEligibleForServer(id), true, id);
    const evidence = getInstitutionEligibility(id);
    assert.ok(evidence?.evidenceUrls.every((url) => url.startsWith("https://")), id);
    assert.ok(evidence?.verifiedAt);
  }
  const copy = getInstitutionEligibility("ifes:0067")!;
  copy.linkedToMec = false;
  copy.evidenceUrls.length = 0;
  assert.equal(isInstitutionEligibleForServer("ifes:0067"), true, "leitores não alteram a política central em memória");
});
