import test from "node:test";
import { NIVEIS, nivelOk, type Nivel } from "./admin-levels";
import assert from "node:assert/strict";
import { atalho } from "../components/admin/ui/SeletorPeriodo";
import { BARRA, GRUPOS, gruposVisiveis } from "../components/admin/shell/menu";

test("período: atalhos contam de hoje para trás (datas inclusivas); Tudo = sem limite", () => {
  const hoje = new Date(2026, 10, 5);
  assert.deepEqual(atalho(1, hoje), { de: "2026-11-05", ate: "2026-11-05" });
  assert.deepEqual(atalho(7, hoje), { de: "2026-10-30", ate: "2026-11-05" });
  assert.deepEqual(atalho(30, hoje), { de: "2026-10-07", ate: "2026-11-05" });
  assert.deepEqual(atalho(null, hoje), { de: "", ate: "" });
});

test("menu segue o nível real e mantém as rotas do Total e os atalhos do celular", () => {
  const hrefs = (nivel: Nivel) => gruposVisiveis(nivel).flatMap(g => g.itens.map(i => i.href));
  const reading = ["/admin", "/admin/mapa", "/admin/monitor", "/admin/assinaturas", "/admin/rankings", "/admin/indicacoes", "/admin/conta"];
  const editing = [...reading, "/admin/emails", "/admin/dominios", "/admin/contato", "/admin/dispersao"];
  assert.deepEqual(hrefs("leitura").sort(), reading.sort());
  assert.deepEqual(hrefs("edicao").sort(), editing.sort());
  assert.deepEqual(hrefs("exclusao").sort(), editing.sort());
  assert.deepEqual(gruposVisiveis("total"), GRUPOS);
  for (const nivel of NIVEIS) {
    assert.ok(hrefs(nivel).includes("/admin/conta"));
    assert.ok(gruposVisiveis(nivel).every(group => group.itens.length > 0));
  }
  assert.ok(!gruposVisiveis("leitura").some(group => group.id === "comunicacao"));
  assert.deepEqual(hrefs("not-a-role" as Nivel), []);
  const todos = new Set(GRUPOS.flatMap(g => g.itens.map(i => i.href)));
  for (const b of BARRA) { assert.ok(todos.has(b.href)); assert.ok(b.curto.length <= 8); }
  assert.ok(BARRA.length <= 5, "Menu + até cinco atalhos + Filtros");
  assert.deepEqual(BARRA.map(item => item.href), ["/admin", "/admin/mapa", "/admin/assinaturas", "/admin/emails", "/admin/rankings"]);
});

test("permissões compartilhadas recusam níveis desconhecidos sem ampliar acessos", () => {
  for (const [index, nivel] of NIVEIS.entries()) {
    for (const [required, minimo] of NIVEIS.entries()) assert.equal(nivelOk(nivel, minimo), index >= required);
  }
  assert.equal(nivelOk("unknown" as Nivel, "leitura"), false);
  assert.equal(nivelOk("leitura", "unknown" as Nivel), false);
  assert.equal(nivelOk("unknown" as Nivel, "unknown" as Nivel), false);
});
