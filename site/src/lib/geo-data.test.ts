import test from "node:test";
import assert from "node:assert/strict";
import { findByName, findMunicipality, municipalityById, norm, regionCriteria, regionOf, REGION_COUNTS, UFS } from "./geo-data";

test("municípios: contagens oficiais e UFs", () => {
  assert.equal(REGION_COUNTS.municipios, 5571);
  assert.equal(REGION_COUNTS.amazoniaLegal, 773);
  assert.equal(REGION_COUNTS.faixaFronteira, 588);
  assert.equal(UFS.length, 27);
});

test("UF × cidade: par válido, acento, caixa, apóstrofo e homônimos", () => {
  assert.equal(findMunicipality("RO", "Porto Velho")?.id, 1100205);
  assert.equal(findMunicipality("ro", "PORTO VELHO")?.id, 1100205);
  assert.equal(findMunicipality("RO", "ji-parana")?.name, "Ji-Paraná");
  assert.equal(findMunicipality("RS", "santana do livramento")?.name, "Sant'Ana do Livramento");
  assert.equal(findMunicipality("SP", "Porto Velho"), null); // cidade existe, mas em outra UF
  assert.equal(findMunicipality("RO", "Cidade Inventada"), null);
  assert.ok(findByName("Bom Jesus").length > 1); // homônimos exigem a UF
  assert.equal(findByName("Porto Velho").length, 1);
  assert.equal(norm("São José d'Oeste"), "sao jose d oeste");
});

test("regiões: Amazônia Legal e faixa de fronteira (listas oficiais do IBGE)", () => {
  const id = (u: string, n: string) => findMunicipality(u, n)!.id;
  assert.equal(regionCriteria(regionOf(id("RO", "Ji-Paraná"))), "amazonia_legal");
  assert.equal(regionCriteria(regionOf(id("RO", "Vilhena"))), "ambos");
  assert.equal(regionCriteria(regionOf(id("PR", "Foz do Iguaçu"))), "faixa_fronteira");
  assert.equal(regionCriteria(regionOf(id("MS", "Corumbá"))), "faixa_fronteira");
  assert.equal(regionCriteria(regionOf(id("SP", "São Paulo"))), null);
  assert.equal(regionCriteria(regionOf(id("DF", "Brasília"))), null);
  assert.equal(regionCriteria(regionOf(id("MA", "São Luís"))), "amazonia_legal"); // oeste do meridiano 44°: MA entra por município
  assert.equal(regionCriteria(regionOf(id("MA", "Caxias"))), null); // leste do meridiano 44°: fora
  assert.equal(regionOf(null).amazoniaLegal, false);
  assert.equal(municipalityById(1100205)?.uf, "RO");
});
