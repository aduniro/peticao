import test from "node:test";
import assert from "node:assert/strict";
import { IFES, regionCampusIds } from "./ifes-data";
import { regionOf } from "./geo-data";
import domains from "./ifes-domains.json";

test("IFAM tem Manicoré e Santo Antônio do Içá (campi pedidos pela ADUNIR), ambos na região elegível", () => {
  const ifam = IFES.find((i) => i.s === "IFAM")!;
  for (const id of [1302702, 1303700]) {
    assert.ok(ifam.c.includes(id), String(id));
    assert.ok(regionCampusIds(ifam).includes(id), `${id} deveria ser elegível`);
  }
  assert.ok(ifam.c.includes(1303809)); // São Gabriel da Cachoeira continua
  assert.equal(new Set(ifam.c).size, ifam.c.length);
});

test("IFRS tem Ibirubá na lista de campi, mas fora da Amazônia Legal/faixa de fronteira (não conta como lotação na região)", () => {
  const ifrs = IFES.find((i) => i.s === "IFRS")!;
  assert.ok(ifrs.c.includes(4310009));
  assert.deepEqual(regionOf(4310009), { amazoniaLegal: false, faixaFronteira: false });
  assert.ok(!regionCampusIds(ifrs).includes(4310009));
});

test("IF Catarinense: ifc.edu.br e ifcatarinense.edu.br apontam para a mesma instituição da lista", () => {
  const d = domains as { domain: string; acronym: string; institution: string }[];
  const a = d.find((x) => x.domain === "ifc.edu.br")!, b = d.find((x) => x.domain === "ifcatarinense.edu.br")!;
  assert.ok(a && b);
  assert.equal(a.acronym, b.acronym);
  assert.ok(IFES.some((i) => i.s === a.acronym));
});
