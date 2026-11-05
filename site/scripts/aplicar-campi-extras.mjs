#!/usr/bin/env node
// Aplica scripts/ifes-campi-extras.json em public/data/ifes.json (idempotente): inclui instituições novas e acrescenta os municípios dos campi extras.
// Uso (de site/): node scripts/aplicar-campi-extras.mjs [--verificar]   (--verificar só mostra o que mudaria)
import { readFileSync, writeFileSync } from "node:fs";
const dir = new URL("../", import.meta.url);
const IFES = new URL("public/data/ifes.json", dir), EXTRAS = new URL("scripts/ifes-campi-extras.json", dir);
const ifes = JSON.parse(readFileSync(IFES, "utf8")), ex = JSON.parse(readFileSync(EXTRAS, "utf8"));
const so = process.argv.includes("--verificar");
let novasInst = 0, novosCampi = 0;
for (const i of ex.instituicoes ?? []) {
  const a = ifes.find((x) => x.s === i.s);
  if (!a) { ifes.push({ s: i.s, n: i.n, k: i.k, u: i.u, m: i.m, c: [...i.c].sort((x, y) => x - y) }); novasInst++; }
  else for (const id of i.c) if (!a.c.includes(id)) { a.c.push(id); a.c.sort((x, y) => x - y); novosCampi++; }
}
for (const c of ex.campi ?? []) {
  const i = ifes.find((x) => x.s === c.sigla);
  if (!i) { console.error("sigla inexistente:", c.sigla); process.exitCode = 1; continue; }
  if (!i.c.includes(c.ibge) && i.m !== c.ibge) { i.c.push(c.ibge); i.c.sort((x, y) => x - y); novosCampi++; }
}
ifes.sort((a, b) => (a.k !== "U") - (b.k !== "U") || a.s.localeCompare(b.s)); // mesma ordem do gerador: universidades primeiro, depois por sigla
console.log(`instituições novas: ${novasInst} | municípios de campi acrescentados: ${novosCampi}`);
if (!so) writeFileSync(IFES, JSON.stringify(ifes));
