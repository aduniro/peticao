import test from "node:test";
import assert from "node:assert/strict";
import { IFES, regionCampusIds } from "./ifes-data";
import { FF_EXCECOES, regionOf } from "./geo-data";
import domains from "./ifes-domains.json";
import extras from "../../scripts/ifes-campi-extras.json";

test("IFAM tem Manicoré e Santo Antônio do Içá (campi pedidos pela ADUNIR), ambos na região elegível", () => {
  const ifam = IFES.find((i) => i.s === "IFAM")!;
  for (const id of [1302702, 1303700]) {
    assert.ok(ifam.c.includes(id), String(id));
    assert.ok(regionCampusIds(ifam).includes(id), `${id} deveria ser elegível`);
  }
  assert.ok(ifam.c.includes(1303809)); // São Gabriel da Cachoeira continua
  assert.equal(new Set(ifam.c).size, ifam.c.length);
});

test("IFRS: Ibirubá é exceção decidida pela ADUNIR (faixa de fronteira) e conta como lotação na região; Porto Alegre segue fora", () => {
  const ifrs = IFES.find((i) => i.s === "IFRS")!;
  assert.ok(ifrs.c.includes(4310009));
  assert.deepEqual(regionOf(4310009), { amazoniaLegal: false, faixaFronteira: true }); // não consta das listas do IBGE; exceção documentada em regiao.json
  assert.ok(FF_EXCECOES.includes(4310009));
  assert.ok(regionCampusIds(ifrs).includes(4310009));
  assert.ok(ifrs.c.includes(4314902)); // Porto Alegre
  assert.deepEqual(regionOf(4314902), { amazoniaLegal: false, faixaFronteira: false });
  assert.ok(!regionCampusIds(ifrs).includes(4314902));
});

test("IF Catarinense: ifc.edu.br e ifcatarinense.edu.br apontam para a mesma instituição da lista", () => {
  const d = domains as { domain: string; acronym: string; institution: string }[];
  const a = d.find((x) => x.domain === "ifc.edu.br")!, b = d.find((x) => x.domain === "ifcatarinense.edu.br")!;
  assert.ok(a && b);
  assert.equal(a.acronym, b.acronym);
  assert.ok(IFES.some((i) => i.s === a.acronym));
});

test("UFFN (Lei 15.520/2026): instituição criada por desmembramento da Unifap, com o Campus Oiapoque", () => {
  const uffn = IFES.find((i) => i.s === "UFFN")!;
  assert.ok(uffn);
  assert.equal(uffn.m, 1600501); assert.deepEqual(uffn.c, [1600501]); assert.equal(uffn.k, "U");
  assert.ok(regionCampusIds(uffn).includes(1600501)); // Oiapoque: Amazônia Legal e faixa de fronteira
  assert.ok(IFES.find((i) => i.s === "UNIFAP")!.c.includes(1600501)); // transição: continua na lista da Unifap
  assert.ok(domains.some((d) => d.domain === "unifap.br")); // os servidores da UFFN usam o domínio da Unifap
});

test("acréscimos (ifes-campi-extras.json): todo campus tem fonte e situação, está na região elegível e consta no ifes.json", () => {
  const e = extras as { instituicoes: { s: string; c: number[]; fonte_url: string }[]; campi: { sigla: string; ibge: number; situacao: string; fonte_url: string }[] };
  for (const i of e.instituicoes) { assert.match(i.fonte_url, /^https?:\/\//); assert.ok(IFES.some((x) => x.s === i.s), i.s); }
  const sit = new Set(["em_funcionamento", "autorizado", "em_implantacao", "aprovado"]);
  for (const c of e.campi) {
    const i = IFES.find((x) => x.s === c.sigla); assert.ok(i, c.sigla);
    assert.match(c.fonte_url, /^https?:\/\//, `${c.sigla} ${c.ibge}`); assert.ok(sit.has(c.situacao), `${c.sigla} ${c.ibge}`);
    assert.ok(i.c.includes(c.ibge) || i.m === c.ibge, `${c.sigla} ${c.ibge} não está no ifes.json (rode scripts/aplicar-campi-extras.mjs)`);
    const r = regionOf(c.ibge); assert.ok(r.amazoniaLegal || r.faixaFronteira, `${c.sigla} ${c.ibge} fora da região`);
  }
});
