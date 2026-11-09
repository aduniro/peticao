import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";
const um = async () => { const dbmod = await import("./db"); await dbmod._openForTests("t_rankings"); return { dbmod, R: await import("./rankings"), E: await import("./assinaturas-explorar"), F: await import("./assinaturas-filtros"), H: await import("./security") }; };

type L = { cat: "servidor" | "apoiador" | "estrangeiro"; st: "confirmed" | "pending"; ifes?: string; campus?: number; role?: string | null; city?: number; country?: string; uni?: string; criada?: string; regiao?: string };
async function semear(c: Awaited<ReturnType<typeof um>>, linhas: L[]) {
  let n = 0;
  for (const l of linhas) {
    n++;
    await c.dbmod.query(
      `INSERT INTO signatures(name,email,email_hash,category,text_version,consent_at,status,created_at,confirmed_at,token_hash,token_expires_at,institution,ifes_acronym,campus_ibge,role,city_ibge,country,university,region_criteria,region_validated)
       VALUES($1,$2,$3,$4,'v',$5,$6,$5,$7,$8,'2026-12-01T00:00:00Z',$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [`Pessoa ${n}`, `p${n}@rank.example`, c.H.hmac("rk" + n), l.cat, l.criada ?? "2026-11-04T12:00:00.000Z", l.st, l.st === "confirmed" ? "2026-11-04T12:30:00.000Z" : null, "t" + n,
        l.ifes ?? null, l.ifes ?? null, l.campus ?? null, l.role === undefined ? (l.cat === "servidor" ? "docente" : null) : l.role, l.city ?? null, l.country ?? null, l.uni ?? null, l.regiao ?? null, l.regiao ? true : null]);
  }
}
const PVH = 1100205, JIP = 1100122, RBR = 1200401, SP = 3550308, CAMP = 3509502;
const BASE: L[] = [
  { cat: "servidor", st: "confirmed", ifes: "UNIR", campus: PVH, role: "docente" }, { cat: "servidor", st: "confirmed", ifes: "UNIR", campus: PVH, role: "docente" },
  { cat: "servidor", st: "confirmed", ifes: "UNIR", campus: PVH, role: "tae" }, { cat: "servidor", st: "confirmed", ifes: "UNIR", campus: PVH, role: null },
  { cat: "servidor", st: "pending", ifes: "UNIR", campus: JIP, role: "docente" }, { cat: "servidor", st: "confirmed", ifes: "UNIR", campus: JIP, role: "tae" },
  { cat: "servidor", st: "confirmed", ifes: "UFAC", campus: RBR, role: "docente" }, { cat: "servidor", st: "pending", ifes: "UFAC", campus: RBR, role: "tae" },
  { cat: "apoiador", st: "confirmed", city: SP }, { cat: "apoiador", st: "confirmed", city: SP }, { cat: "apoiador", st: "pending", city: CAMP }, { cat: "apoiador", st: "confirmed", city: PVH },
  { cat: "estrangeiro", st: "confirmed", country: "PT", uni: "Universidade de Lisboa" }, { cat: "estrangeiro", st: "pending", country: "AR", uni: "UBA" }, { cat: "estrangeiro", st: "confirmed", country: "PT", uni: "Universidade do Porto" },
];

test("ranking de IFES: docente, técnico e não declarado; ordena por confirmadas", async () => {
  const c = await um();
  try {
    await semear(c, BASE);
    const r = await c.R.rankingIfes(c.F.filtrosVazios());
    assert.deepEqual(r.map((x) => x.ifes), ["UNIR", "UFAC"]);
    assert.deepEqual({ total: r[0].total, conf: r[0].conf, pend: r[0].pend, docente: r[0].docente, tae: r[0].tae, nd: r[0].nd }, { total: 6, conf: 5, pend: 1, docente: 3, tae: 2, nd: 1 });
    assert.deepEqual({ total: r[1].total, conf: r[1].conf, pend: r[1].pend }, { total: 2, conf: 1, pend: 1 });
    // só servidores entram
    assert.equal(r.reduce((a, x) => a + x.total, 0), 8);
    // filtro de status e de período valem
    assert.equal((await c.R.rankingIfes({ ...c.F.filtrosVazios(), status: ["confirmed"] }))[0].total, 5);
    assert.equal((await c.R.rankingIfes({ ...c.F.filtrosVazios(), de: "2026-11-05" })).length, 0);
    assert.equal((await c.R.rankingIfes({ ...c.F.filtrosVazios(), de: "2026-11-04", ate: "2026-11-04" }))[0].total, 6);
  } finally { await c.dbmod._closeDbForTests(); }
});

test("ranking de campi: município do campus dentro da IFES; sem campus usa a sede", async () => {
  const c = await um();
  try {
    await semear(c, [...BASE, { cat: "servidor", st: "confirmed", ifes: "UNIR", role: "docente" }]); // sem campus: cai na sede da IFES
    const todos = await c.R.rankingCampi(c.F.filtrosVazios());
    const unirPvh = todos.find((x) => x.ifes === "UNIR" && x.ibge === PVH)!;
    assert.equal(unirPvh.municipio, "Porto Velho"); assert.equal(unirPvh.uf, "RO");
    assert.ok(unirPvh.total >= 4 && unirPvh.docente >= 2 && unirPvh.tae === 1 && unirPvh.nd === 1);
    const soUnir = await c.R.rankingCampi(c.F.filtrosVazios(), "UNIR");
    assert.ok(soUnir.length >= 2 && soUnir.every((x) => x.ifes === "UNIR"));
    assert.equal(soUnir[0].ibge, PVH); // o campus com mais confirmadas vem primeiro
    const jip = soUnir.find((x) => x.ibge === JIP)!; assert.deepEqual({ conf: jip.conf, pend: jip.pend }, { conf: 1, pend: 1 });
    assert.equal(todos.some((x) => x.ifes === "UFAC" && x.uf === "AC"), true);
  } finally { await c.dbmod._closeDbForTests(); }
});

test("apoiadores por estado e por cidade; estrangeiros por país e universidade", async () => {
  const c = await um();
  try {
    await semear(c, BASE);
    const a = await c.R.rankingApoiadores(c.F.filtrosVazios());
    assert.deepEqual(a.porUf.map((x) => [x.nome, x.conf, x.pend]), [["SP", 2, 1], ["RO", 1, 0]]);
    assert.deepEqual(a.porCidade.map((x) => [x.nome, x.uf, x.conf, x.pend]).slice(0, 1), [["São Paulo", "SP", 2, 0]]);
    assert.equal(a.porCidade.length, 3);
    const e = await c.R.rankingExterior(c.F.filtrosVazios());
    assert.deepEqual(e.porPais.map((x) => [x.chave, x.conf, x.pend]), [["PT", 2, 0], ["AR", 0, 1]]);
    assert.equal(e.porPais[0].nome, "Portugal");
    assert.equal(e.porUniversidade.length, 3);
    assert.equal(e.porUniversidade[0].pais, "PT");
  } finally { await c.dbmod._closeDbForTests(); }
});

test("resumo por UF e por região: categorias dentro de confirmadas e aguardando, IFES e campus líderes", async () => {
  const c = await um();
  try {
    await semear(c, BASE);
    const r = await c.R.resumoPorUf(10);
    assert.deepEqual(r.RO.cat.conf, { docente: 2, tae: 2, nd: 1, apoiador: 1 }); // 2 doc + 1 tae + 1 nd em PVH, tae em JIP, apoiador de PVH
    assert.deepEqual(r.RO.cat.pend, { docente: 1, tae: 0, nd: 0, apoiador: 0 });
    assert.equal(r.RO.rankIfes[0].sigla, "UNIR"); assert.equal(r.RO.rankIfes[0].conf, 5);
    assert.deepEqual({ nome: r.RO.rankCampi[0].nome, ifes: r.RO.rankCampi[0].ifes, conf: r.RO.rankCampi[0].conf }, { nome: "Porto Velho", ifes: "UNIR", conf: 4 });
    assert.equal(r.SP.cat.conf.apoiador, 2); assert.equal(r.SP.rankIfes.length, 0); // sem servidores em SP
    assert.deepEqual(r.SP.rankCidades.map((x) => [x.nome, x.conf, x.pend]), [["São Paulo", 2, 0], ["Campinas", 0, 1]]); // cidades dos apoiadores
    assert.deepEqual(r.RO.rankCidades.map((x) => [x.nome, x.uf, x.conf]), [["Porto Velho", "RO", 1]]);
    assert.equal(r.AC.rankCampi[0].nome, "Rio Branco");
    assert.ok(!("PT" in r) && !Object.keys(r).some((u) => u.length !== 2)); // estrangeiros não entram no mapa por estado
    // junta estados numa região (Norte = RO + AC): soma categorias e refaz os rankings
    const norte = c.R.juntarUfs([r.RO, r.AC], 10);
    assert.deepEqual(norte.rankIfes.map((x) => [x.sigla, x.conf, x.pend]), [["UNIR", 5, 1], ["UFAC", 1, 1]]);
    assert.equal(norte.cat.conf.docente, 3); assert.equal(norte.cat.pend.tae, 1);
    assert.equal(c.R.juntarUfs([], 10).rankIfes.length, 0);
    const sudeste = c.R.juntarUfs([r.SP, r.RO], 10); // SP + RO só para somar cidades de estados diferentes
    assert.deepEqual(sudeste.rankCidades.map((x) => `${x.nome}/${x.uf}`), ["São Paulo/SP", "Porto Velho/RO", "Campinas/SP"]);
    // limite
    assert.equal((await c.R.resumoPorUf(1)).RO.rankCampi.length, 1);
  } finally { await c.dbmod._closeDbForTests(); }
});

test("filtro de região: aceita o vocabulário da tela (amazonia_legal/faixa_fronteira/ambos) e o curto (al/ff)", async () => {
  const c = await um();
  try {
    await semear(c, [
      { cat: "servidor", st: "confirmed", ifes: "UNIR", campus: PVH, regiao: "amazonia_legal" }, { cat: "servidor", st: "confirmed", ifes: "UNIR", campus: PVH, regiao: "faixa_fronteira" },
      { cat: "servidor", st: "confirmed", ifes: "UNIR", campus: PVH, regiao: "ambos" }, { cat: "servidor", st: "confirmed", ifes: "UFAC", campus: RBR },
    ]);
    const conta = async (regiao: string[]) => (await c.E.totais({ ...c.F.filtrosVazios(), regiao })).confirmadas;
    assert.equal(await conta(["amazonia_legal"]), 2); assert.equal(await conta(["al"]), 2); // amazonia_legal + ambos
    assert.equal(await conta(["faixa_fronteira"]), 2); assert.equal(await conta(["ff"]), 2);
    assert.equal(await conta(["ambos"]), 1);
    assert.equal(await conta(["amazonia_legal", "faixa_fronteira"]), 3); // união
    assert.equal(await conta(["fora"]), 1);
    assert.equal(await conta([]), 4);
  } finally { await c.dbmod._closeDbForTests(); }
});

test("rota de rankings exige nível leitura e só devolve contagens", async () => {
  const { readFileSync } = await import("node:fs"); const { join } = await import("node:path");
  const rota = readFileSync(join(__dirname, "../app/api/admin/rankings/route.ts"), "utf8");
  assert.match(rota, /exigirNivel\(req, "leitura"/);
  const fonte = readFileSync(join(__dirname, "rankings.ts"), "utf8");
  assert.ok(!/s\.(name|email|cpf|wa_|email_hash|cpf_hash)/.test(fonte), "rankings não deve selecionar nome, e-mail, CPF ou WhatsApp");
});

test("funil de visitas segue o intervalo do calendário (início e fim inclusivos)", async () => {
  const c = await um();
  try {
    const M = await import("./monitor");
    const ev = (v: string, ts: string, bot = false) => c.dbmod.query("INSERT INTO events(ts,visitor_id,type,is_bot) VALUES($1,$2,'pageview',$3)", [ts, v, bot]);
    await ev("va", "2026-11-03T12:00:00.000Z"); await ev("vb", "2026-11-04T23:59:59.000Z"); await ev("vc", "2026-11-05T00:00:00.000Z"); await ev("vbot", "2026-11-04T10:00:00.000Z", true);
    const n = async (de: string, ate: string) => { const i = M.intervaloIso(de, ate); return (await M.monitorSummary(i.since, i.until)).visitors; };
    assert.equal(await n("2026-11-03", "2026-11-03"), 1);        // só o dia 3
    assert.equal(await n("2026-11-04", "2026-11-04"), 1);        // até 23:59:59 do dia 4 conta; 00:00 do dia 5 não
    assert.equal(await n("2026-11-03", "2026-11-05"), 3);        // os três (robô nunca conta)
    assert.equal(await n("2026-11-04", ""), 2);                  // sem fim: até agora
    assert.equal(await n("", "2026-11-03"), 1);                  // sem início
    assert.equal((await M.monitorSummary("2026-11-03T00:00:00.000Z")).visitors, 3); // chamada antiga continua igual
  } finally { await c.dbmod._closeDbForTests(); }
});

test("CSV dos rankings: separador ;, BOM, aspas e proteção contra fórmula de planilha", async () => {
  const { paraCsv, COLUNAS } = await import("./rankings-csv");
  const csv = paraCsv(COLUNAS.ifes, [{ ifes: "UNIR", docente: 21, tae: 8, nd: 2, total: 34, conf: 29, pend: 5 }, { ifes: '=HYPERLINK("http://x")', docente: 0, tae: 0, nd: 0, total: 0, conf: 0, pend: 0 }, { ifes: 'Inst; "X"', docente: 1, tae: 1, nd: 1, total: 3, conf: 3, pend: 0 }]);
  assert.ok(csv.startsWith("﻿IFES;Docentes;Técnicos;Não declarados;Total;Confirmadas;Aguardando\r\n"));
  assert.ok(csv.includes("\r\nUNIR;21;8;2;34;29;5\r\n"));
  assert.ok(csv.includes("'=HYPERLINK"), "texto que começa com = vira texto, não fórmula");
  assert.ok(csv.includes('"Inst; ""X"""'));
  for (const k of ["ifes", "campi", "uf", "cidade", "pais", "universidade"]) assert.ok(COLUNAS[k].length >= 4, k);
  assert.ok(!Object.values(COLUNAS).flat().some(([c]) => /name|email|cpf|nome_pessoa/.test(c) && c !== "nome"), "sem colunas de pessoas");
});

test("ranking regional soma antes do limite de exibição dos estados", async () => {
  const c = await um();
  try {
    const rows: L[] = [];
    for (const campus of [PVH, RBR]) {
      const prefix = campus === PVH ? "RO" : "AC";
      for (let i = 0; i < 10; i++) for (let n = 0; n < 3; n++) rows.push({ cat: "servidor", st: "confirmed", ifes: `${prefix}-LOCAL-${i}`, campus });
      for (let n = 0; n < 2; n++) rows.push({ cat: "servidor", st: "confirmed", ifes: "IFES-REGIONAL", campus });
    }
    await semear(c, rows);
    const full = await c.R.resumoPorUf(Number.POSITIVE_INFINITY);
    const shown = c.R.limitarResumo(full.RO, 10);
    assert.equal(shown.rankIfes.length, 10);
    assert.ok(!shown.rankIfes.some(r => r.sigla === "IFES-REGIONAL"));
    const region = c.R.juntarUfs([full.RO, full.AC], 10);
    assert.equal(region.rankIfes[0].sigla, "IFES-REGIONAL");
    assert.equal(region.rankIfes[0].conf, 4);
    assert.equal(full.RO.rankIfes.length, 11); // Apresentação não mutila a fonte regional.
    assert.equal(region.cat.conf.docente, 64);
  } finally { await c.dbmod._closeDbForTests(); }
});
