import test from "node:test";
import assert from "node:assert/strict";
import { RAMPA, classe, quantis } from "./quantis";

test("quantis: 5 classes, zero fica fora, mais assinaturas = mais azul", () => {
  const v = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55];
  const c = quantis(v);
  assert.equal(c.length, 4);
  assert.deepEqual([...c].sort((a, b) => a - b), c);
  assert.equal(classe(0, c), -1);
  assert.equal(classe(1, c), 0);
  assert.equal(classe(55, c), RAMPA.length - 1);
  const classes = v.filter((x) => x > 0).map((x) => classe(x, c));
  for (let i = 1; i < classes.length; i++) assert.ok(classes[i] >= classes[i - 1]); // monotônico
  assert.equal(new Set(classes).size, 5); // usa as 5 cores
  assert.equal(RAMPA[0], "#e34948"); assert.equal(RAMPA[4], "#2a78d6"); // vermelho → azul
});

test("quantis: um estado só e sem dados", () => {
  assert.deepEqual(quantis([]), []);
  assert.deepEqual(quantis([0, 0]), []);
  const c = quantis([9]);
  assert.ok(classe(9, c) >= 0 && classe(9, c) < RAMPA.length);
});
