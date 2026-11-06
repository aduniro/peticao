import test from "node:test";
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

test("menu: itens 'total' só aparecem para o nível total; Minha conta sempre; barra inferior só com páginas que existem", () => {
  const hrefs = (t: boolean) => gruposVisiveis(t).flatMap((g) => g.itens.map((i) => i.href));
  for (const h of ["/admin/acoes", "/admin/terminal", "/admin/usuarios"]) { assert.ok(hrefs(true).includes(h), h); assert.ok(!hrefs(false).includes(h), h); }
  assert.ok(hrefs(false).includes("/admin/conta") && hrefs(true).includes("/admin/conta"));
  const todos = new Set(GRUPOS.flatMap((g) => g.itens.map((i) => i.href)));
  for (const b of BARRA) { assert.ok(todos.has(b.href), `a barra inferior aponta para ${b.href}, que não está no menu`); assert.ok(b.curto.length <= 8, `rótulo longo demais para a barra: ${b.curto}`); }
  assert.ok(BARRA.length <= 5, "a barra tem 7 colunas: Menu + até 5 atalhos + Filtros");
});
