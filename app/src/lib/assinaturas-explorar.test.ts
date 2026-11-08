import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";

test("explorador: filtros combinados valem igualmente para tabela, mapa, facetas e totais", async () => {
  const dbmod = await import("./db"); await dbmod._openForTests("t_explorar");
  const { query } = dbmod;
  const { explorar, parseFiltros, filtrosParaQuery, filtrosVazios } = await import("./assinaturas-explorar");
  let n = 0;
  const mk = async (o: Record<string, unknown>) => { n++; const c = { name: `Pessoa ${n}`, email: `p${n}@exemplo.org`, email_hash: `h${n}`, category: "apoiador", status: "confirmed", text_version: "v", consent_at: "x", created_at: "2026-11-0" + (1 + (n % 3)) + "T10:00:00Z", ...o };
    const cols = Object.keys(c); await query(`INSERT INTO signatures(${cols.join(",")}) VALUES(${cols.map((_, i) => "$" + (i + 1)).join(",")})`, Object.values(c)); };
  // servidores: UNIR em Porto Velho (campus), Ji-Paraná; UFPR (fora da região); apoiadores; estrangeiros
  await mk({ category: "servidor", institution: "UNIR", ifes_acronym: "UNIR", role: "docente", campus: "Porto Velho", campus_ibge: 1100205, region_validated: true, region_criteria: "amazonia_legal", cpf_name_check: "match" });
  await mk({ category: "servidor", institution: "UNIR", ifes_acronym: "UNIR", role: "tae", campus: "Ji-Paraná", campus_ibge: 1100122, region_validated: true, region_criteria: "amazonia_legal", status: "pending" });
  await mk({ category: "servidor", institution: "UNILA", ifes_acronym: "UNILA", role: "docente", campus: "Foz do Iguaçu", campus_ibge: 4108304, region_validated: true, region_criteria: "faixa_fronteira" });
  await mk({ category: "servidor", institution: "UFPR", ifes_acronym: "UFPR", role: "docente", region_validated: false });
  await mk({ category: "apoiador", city: "Porto Velho", uf: "RO", city_ibge: 1100205 });
  await mk({ category: "apoiador", city: "Porto Velho", uf: "RO", city_ibge: 1100205, status: "pending" });
  await mk({ category: "apoiador", city: "São Paulo", uf: "SP", city_ibge: 3550308 });
  await mk({ category: "estrangeiro", country: "FR", university: "Université Paris Cité" });
  await mk({ category: "estrangeiro", country: "US", university: "SANS Technology Institute", status: "pending" });

  const todos = await explorar(filtrosVazios(), { limite: 100 });
  assert.equal(todos.total, 9);
  assert.deepEqual([todos.totais.confirmadas, todos.totais.pendentes, todos.totais.servidores, todos.totais.apoiadores, todos.totais.estrangeiros, todos.totais.cpfConferido], [6, 3, 4, 3, 2, 1]);
  // mapa: Porto Velho agrega servidor (campus) e apoiadores; a soma dos pontos + sem local = total
  const pv = todos.pontos.find((p) => p.chave === "m:1100205")!;
  assert.deepEqual([pv.conf, pv.pend, Object.keys(pv.por).sort()], [2, 1, ["apoiador", "servidor"]]);
  assert.ok(pv.lat < 0 && pv.lon < -60, "coordenadas de Porto Velho");
  assert.ok(todos.pontos.some((p) => p.chave === "p:FR" && p.nome === "França"));
  const somaPontos = todos.pontos.reduce((a, p) => a + p.conf + p.pend, 0);
  assert.equal(somaPontos + todos.semLocal, todos.total, "pontos do mapa + sem local = linhas da tabela");

  // filtros combinados (tabela, mapa e totais sempre iguais)
  const casos: [string, number][] = [
    ["categoria=servidor", 4], ["categoria=servidor&cargo=docente", 3], ["categoria=servidor&instituicao=UNIR", 2], ["regiao=al", 2], ["regiao=ff", 1], ["regiao=al,ff", 3], ["regiao=fora", 1],
    ["uf=RO", 4], ["cidade=1100205", 3], ["status=pending", 3], ["cpf=sim", 1], ["cpf=nao", 8], ["pais=FR", 1], ["universidade=SANS Technology Institute", 1], ["campus=Ji-Paraná", 1],
    ["q=Pessoa 7", 1], ["categoria=apoiador&uf=SP", 1], ["de=2026-11-02&ate=2026-11-02", 3],
  ];
  for (const [qs, esperado] of casos) {
    const f = parseFiltros(new URLSearchParams(qs)); const r = await explorar(f, { limite: 100 });
    assert.equal(r.total, esperado, `${qs}: tabela`); assert.equal(r.linhas.length, esperado, `${qs}: linhas`);
    assert.equal(r.pontos.reduce((a, p) => a + p.conf + p.pend, 0) + r.semLocal, esperado, `${qs}: mapa`); assert.equal(r.totais.confirmadas + r.totais.pendentes, esperado, `${qs}: totais`);
  }
  // facetas: cada lista ignora o próprio filtro (dá para trocar a escolha) e traz as contagens
  const fa = (await explorar(parseFiltros(new URLSearchParams("instituicao=UNIR")))).facetas;
  assert.deepEqual(fa.instituicao.map((x) => x.v).sort(), ["UFPR", "UNILA", "UNIR"]);
  assert.ok(fa.uf.some((u) => u.v === "RO") && fa.cidade.some((c) => c.rotulo === "Porto Velho/RO"));
  // ida e volta dos filtros pela URL, ordenação e paginação
  const f2 = parseFiltros(new URLSearchParams("categoria=servidor,apoiador&q=x&de=2026-11-01"));
  assert.equal(filtrosParaQuery(f2), "categoria=servidor%2Capoiador&q=x&de=2026-11-01");
  const pag = await explorar(filtrosVazios(), { limite: 4, pagina: 3, ordem: "nome", dir: "asc" }); assert.equal(pag.linhas.length, 1);
  assert.equal((await explorar(filtrosVazios(), { limite: 3, ordem: "nome", dir: "asc" })).linhas[0].nome, "Pessoa 1");
  // injeção: valores estranhos não quebram a consulta
  assert.equal((await explorar(parseFiltros(new URLSearchParams("categoria=servidor'; DROP TABLE signatures;--&q=%25_\\")))).total, 0);
  assert.equal((await query<any>("SELECT COUNT(*)::int n FROM signatures")).rows[0].n, 9);
});
