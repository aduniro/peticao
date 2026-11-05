import test from "node:test";
import assert from "node:assert/strict";
import { titleCaseName as n, lowerEmail } from "./name-case";

test("nomes: caixa normalizada, partículas em minúsculas, apóstrofo, hífen, Mc", () => {
  const cases: [string, string][] = [
    ["MARIA DA SILVA", "Maria da Silva"], ["mAria Da sILVA", "Maria da Silva"], ["maria da silva", "Maria da Silva"], ["maria dA silva", "Maria da Silva"],
    ["JOÃO DOS SANTOS E SOUZA", "João dos Santos e Souza"], ["ana das neves", "Ana das Neves"], ["PEDRO DE ALCÂNTARA DO NASCIMENTO", "Pedro de Alcântara do Nascimento"],
    ["luigi d'angelo", "Luigi D'Angelo"], ["MARY O'BRIEN", "Mary O'Brien"], ["anne-marie ROY", "Anne-Marie Roy"], ["ronald MCDONALD", "Ronald McDonald"],
    ["ludwig VAN beethoven", "Ludwig van Beethoven"], ["alexander VON humboldt", "Alexander von Humboldt"], ["jan VAN DER berg", "Jan van der Berg"], ["peter van den BROEK", "Peter van den Broek"],
    ["hernando DE soto", "Hernando de Soto"], ["maria DE LA cruz", "Maria de la Cruz"], ["juan de los SANTOS", "Juan de los Santos"], ["tomasi DI lampedusa", "Tomasi di Lampedusa"],
    ["lorenzo DE' medici", "Lorenzo de' Medici"], ["jean DU pont", "Jean du Pont"], ["ahmad BIN abdullah", "Ahmad bin Abdullah"], ["graf ZU pappenheim", "Graf zu Pappenheim"],
    ["carlos III", "Carlos III"], ["JOSÉ SILVA jr", "José Silva Jr"], ["maria macedo machado", "Maria Macedo Machado"], // Mac* não é alterado
    ["ÉLODIE DUBOIS", "Élodie Dubois"], ["ŁUKASZ NOWAK", "Łukasz Nowak"], ["søren ØRSTED", "Søren Ørsted"],
  ];
  for (const [i, o] of cases) assert.equal(n(i, { final: true }), o, i);
});

test("nomes: Mc com hífen, sobrenomes que parecem partícula e a última palavra", () => {
  assert.equal(n("mcdonald-smith", { final: true }), "McDonald-Smith");
  assert.equal(n("MARIA DEL", { final: true }), "Maria Del"); // última palavra é sobrenome
  assert.equal(n("wei dai", { final: true }), "Wei Dai");
  assert.equal(n("ana ten", { final: true }), "Ana Ten");
  assert.equal(n("maria op", { final: true }), "Maria Op");
  assert.equal(n("joão da", { final: true }), "João Da");
  assert.equal(n("luis ortega y gasset", { final: true }), "Luis Ortega y Gasset"); // ambígua só com 3+ palavras
  assert.equal(n("peter van den broek", { final: true }), "Peter van den Broek");
  assert.equal(n("jan ten hoor", { final: true }), "Jan ten Hoor");
});

test("caixa de e-mail e de nomes não usa o idioma do navegador (turco: I → ı)", () => {
  assert.equal(lowerEmail("IBRAHIM@GMAIL.COM"), "ibrahim@gmail.com");
  assert.ok(!n("IBRAHIM", { final: true }).includes("ı"));
});

test("nomes: a primeira palavra sempre começa com maiúscula, mesmo sendo partícula", () => {
  assert.equal(n("da silva", { final: true }), "Da Silva");
  assert.equal(n("DE SOUZA", { final: true }), "De Souza");
  assert.equal(n("van gogh", { final: true }), "Van Gogh"); // só "van" depois de um primeiro nome é minúsculo
});

test("nomes: durante a digitação preserva o espaço final; ao finalizar remove duplicados e pontas", () => {
  assert.equal(n("maria "), "Maria ");
  assert.equal(n("maria  da "), "Maria  da ");
  assert.equal(n("  maria   DA   silva  ", { final: true }), "Maria da Silva");
  assert.equal(n("MARIA D"), "Maria D");
  assert.equal(n(""), "");
  const once = n("mAria Da sILVA", { final: true });
  assert.equal(n(once, { final: true }), once); // idempotente
});

test("e-mail: minúsculas e sem espaços nas pontas", () => {
  assert.equal(lowerEmail("  Maria.SILVA@UNIR.BR "), "maria.silva@unir.br");
});
