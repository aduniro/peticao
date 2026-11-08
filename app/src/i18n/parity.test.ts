import { test } from "node:test";
import assert from "node:assert/strict";
import { DICTS } from "./messages";
import { LOCALES } from "./index";
import { PETICAO_BR, PETICAO_EST } from "@/content/peticao";

test("os 5 dicionários têm exatamente as mesmas chaves e nenhum texto vazio", () => {
  const ref = Object.keys(DICTS.pt).sort();
  for (const l of LOCALES) {
    assert.deepEqual(Object.keys(DICTS[l]).sort(), ref, `chaves de ${l}`);
    for (const [k, v] of Object.entries(DICTS[l])) assert.ok(v.trim(), `${l}.${k} vazio`);
  }
});
test("variáveis {x} iguais em todos os idiomas", () => {
  const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const l of LOCALES) for (const k of Object.keys(DICTS.pt) as (keyof typeof DICTS.pt)[]) assert.equal(vars(DICTS[l][k]), vars(DICTS.pt[k]), `${l}.${k}`);
});
test("textos da petição: mesma quantidade de parágrafos e razões; razão da fixação de servidores presente", () => {
  for (const l of LOCALES) {
    assert.equal(PETICAO_BR[l].intro.length, PETICAO_BR.pt.intro.length, l);
    assert.equal(PETICAO_BR[l].reasons.length, PETICAO_BR.pt.reasons.length, l);
    assert.equal(PETICAO_EST[l].intro.length, PETICAO_BR.pt.intro.length, l);
    assert.match(PETICAO_EST[l].intro[0], /\{where\}/);
  }
});
