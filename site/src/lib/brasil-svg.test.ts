import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const j = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "geo", "brasil-svg.json"), "utf8"));
test("mapa SVG do Brasil: 27 UFs com caminho, centro dentro da caixa e regiões completas", () => {
  const ufs = Object.keys(j.ufs); assert.equal(ufs.length, 27);
  for (const [uf, v] of Object.entries<any>(j.ufs)) { assert.ok(v.d.startsWith("M") && v.d.length > 40, uf); assert.ok(v.cx > 0 && v.cx < j.w && v.cy > 0 && v.cy < j.h, uf + " centro"); assert.ok(["N", "NE", "SE", "S", "CO"].includes(v.reg), uf); }
  const todas = Object.values<string[]>(j.regioes).flat().sort(); assert.deepEqual(todas, [...ufs].sort());
  for (const p of j.pequenos) assert.ok(j.ufs[p]);
  assert.ok(JSON.stringify(j).length < 90_000, "arquivo enxuto");
});
