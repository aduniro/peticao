import test from "node:test";
import assert from "node:assert/strict";
import { lookupIp, geoDbStatus } from "./geo";
import { nomeMunicipio, coordMunicipio, paisInfo } from "./geo-server";

// Regressão: as duas bases geográficas (IP e mapa) guardavam dados na mesma chave global e se quebravam mutuamente.
test("geolocalização por IP e base do mapa funcionam no mesmo processo, em qualquer ordem", async () => {
  assert.equal(nomeMunicipio(1100122)?.n, "Ji-Paraná");
  assert.ok(coordMunicipio(1100122));
  assert.equal(paisInfo("BR")?.n, "Brasil");
  assert.equal((await geoDbStatus()).city, true);
  assert.equal((await lookupIp("8.8.4.4")).city, "Mountain View");
  assert.equal(nomeMunicipio(1100122)?.uf, "RO");
  assert.equal(paisInfo("FR")?.n, "França");
});
