import test from "node:test";
import assert from "node:assert/strict";
import { classifyCpfName } from "./cpf-name";
import { nameCheckFromRecord } from "./cpf-check";

const registry = "ANA PAULA DE SOUZA LIMA";

test("nome: palavras completas, acentos, partículas, espaços e pontuação", () => {
  for (const name of ["Ana Paula de Souza Lima", "Ána  Paula Souza Lima", "ANA PAULA SOUZA LIMA", "Ana-Paula Souza Lima"]) {
    assert.equal(classifyCpfName(registry, name), "complete", name);
  }
  assert.equal(classifyCpfName("JOÃO D’ÁVILA", "Joao D'Avila"), "complete");
  assert.equal(classifyCpfName("BRUNO DE SOUZA BARRETO", "Bruno Souza Barreto"), "complete");
});

test("nome: omissões em ordem e segundo termo exigem confirmação adicional", () => {
  const rec = { nome: registry, mae: "Helena Souza", nasc: "01/02/1990" };
  for (const name of ["Ana Souza", "Ana Lima", "Ana Paula Lima", "Paula Lima", "Paula Souza Lima"]) {
    assert.equal(classifyCpfName(registry, name), "partial", name);
    assert.equal(nameCheckFromRecord(rec, name), "mismatch", "nome parcial isolado não aprova");
    assert.equal(nameCheckFromRecord(rec, name, true), "match");
  }
});

test("nome: grafia, iniciais, termos extras, ausência de prenome e ordem incompatível não aprovam", () => {
  for (const name of ["Ana P. Lima", "A Paula Souza Lima", "Ana Paula Sousa Lima", "Lima Ana Paula", "Ana Carla Lima", "Ana Souza Paula", "Souza Lima", "Ana", "Ana Paula", "Ana Souza Lima Extra", "Ana2 Paula Souza Lima", "", "Ana Paula Souza Souza Lima"]) {
    assert.equal(classifyCpfName(registry, name), "mismatch", name);
    assert.equal(nameCheckFromRecord({ nome: registry, mae: null, nasc: null }, name, true), "mismatch");
  }
  assert.equal(classifyCpfName("MARIA SOUZA", "M. Souza"), "mismatch");
  assert.equal(classifyCpfName("JOAO SEGUNDO", "Joao II"), "mismatch");
  assert.equal(classifyCpfName("ANA P LIMA", "Ana Paula Lima"), "mismatch");
});

test("nome: palavras repetidas precisam de ocorrências suficientes e ordenadas", () => {
  assert.equal(classifyCpfName("ANA MARIA MARIA LIMA", "Ana Maria Lima"), "partial");
  assert.equal(classifyCpfName("ANA MARIA LIMA", "Ana Maria Maria Lima"), "mismatch");
  assert.equal(classifyCpfName("ANA MARIA LIMA SOUZA", "Ana Souza Lima"), "mismatch");
});
