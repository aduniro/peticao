import test from "node:test";
import assert from "node:assert/strict";
import { geoFromCfHeaders } from "./geo";

test("localização pelos cabeçalhos da Cloudflare: só com TRUST_CF_HEADER e o mesmo IP; corrige acentos", () => {
  const h = new Headers({ "cf-connecting-ip": "200.129.140.79", "cf-ipcity": Buffer.from("Ji-Paraná", "utf8").toString("latin1"), "cf-region": "Rondônia", "cf-ipcountry": "BR", "cf-iplatitude": "-10.8777", "cf-iplongitude": "-61.9322" });
  delete process.env.TRUST_CF_HEADER;
  assert.equal(geoFromCfHeaders(h, "200.129.140.79"), null);
  process.env.TRUST_CF_HEADER = "1";
  const g = geoFromCfHeaders(h, "200.129.140.79")!;
  assert.equal(g.city, "Ji-Paraná"); assert.equal(g.region, "Rondônia"); assert.equal(g.country, "BR");
  assert.equal(g.lat, -10.8777); assert.equal(g.lon, -61.9322);
  assert.equal(geoFromCfHeaders(h, "8.8.8.8"), null); // outro IP: não usa os cabeçalhos desta requisição
  assert.equal(geoFromCfHeaders(new Headers({ "cf-connecting-ip": "1.2.3.4", "cf-ipcity": "S%C3%A3o%20Paulo" }), "1.2.3.4")!.city, "São Paulo");
  delete process.env.TRUST_CF_HEADER;
});
