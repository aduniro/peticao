import test from "node:test";
import assert from "node:assert/strict";
import { loadIfes, matchesInstitutionSelection, mergeInstitutionCatalog, type Ifes } from "./datasets-client";

const unir: Ifes = { s: "UNIR", n: "Fundação Universidade Federal de Rondônia", k: "U", u: "RO", m: 1100205, c: [1100205] };
const ebserh: Ifes = { s: "EBSERH", n: "Empresa Brasileira de Serviços Hospitalares", k: "O", u: "DF", m: 5300108, c: [] };

test("instituição no cliente: aceita somente opção reconhecida e rejeita texto livre ou seleção antiga", () => {
  assert.equal(matchesInstitutionSelection("unir", unir), true);
  assert.equal(matchesInstitutionSelection("Fundacao Universidade Federal de Rondonia", unir), true);
  assert.equal(matchesInstitutionSelection("UNIR — Fundação Universidade Federal de Rondônia", unir), true);
  assert.equal(matchesInstitutionSelection("470553", unir), false);
  assert.equal(matchesInstitutionSelection("Pessoa Fictícia Teste", unir), false);
  assert.equal(matchesInstitutionSelection("UNIR - Pessoa Fictícia Teste", unir), false);
  assert.equal(matchesInstitutionSelection("Universidade inexistente", null), false);
  assert.equal(matchesInstitutionSelection("UFAM", unir), false);
  assert.equal(matchesInstitutionSelection("", unir), false);
});

test("instituição no cliente: reúne o catálogo publicado e entradas autorizadas sem sobrescrever uma instituição", () => {
  const institutions = mergeInstitutionCatalog([unir], [ebserh]);
  assert.deepEqual(institutions.map((institution) => institution.s), ["UNIR", "EBSERH"]);
  assert.equal(matchesInstitutionSelection("Empresa Brasileira de Serviços Hospitalares", institutions[1]), true);
  assert.throws(() => mergeInstitutionCatalog([unir], [{ ...unir, s: "unir" }]), /Duplicate institution/);
});

test("instituição no cliente: falha ao carregar catálogo adicional não libera texto livre e permite nova tentativa", async () => {
  const originalFetch = globalThis.fetch;
  let failExtras = true;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url === "/data/ifes.json") return new Response(JSON.stringify([unir]));
    if (url === "/data/server-institution-extras.json") {
      if (failExtras) return new Response("unavailable", { status: 503 });
      return new Response(JSON.stringify([ebserh]));
    }
    throw new Error("Unexpected URL");
  };
  try {
    await assert.rejects(loadIfes(), /server-institution-extras/);
    failExtras = false;
    const institutions = await loadIfes();
    assert.deepEqual(institutions.map((institution) => institution.s), ["UNIR", "EBSERH"]);
    assert.equal(calls.filter((url) => url === "/data/ifes.json").length, 1);
    assert.equal(calls.filter((url) => url === "/data/server-institution-extras.json").length, 2);
    assert.equal(await loadIfes(), institutions);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
