import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

(process.env as Record<string, string>).NODE_ENV = "test";

test("configuração do painel: popups ligados por padrão; grava e lê; só chaves conhecidas", async () => {
  const dbmod = await import("./db"); await dbmod._openForTests("t_painel_config");
  try {
    const C = await import("./painel-config");
    assert.deepEqual(await C.lerConfigPainel(), { popupEstado: true, popupRegiao: true });
    await C.gravarConfigPainel("popupRegiao", false);
    assert.deepEqual(await C.lerConfigPainel(), { popupEstado: true, popupRegiao: false });
    await C.gravarConfigPainel("popupEstado", false); await C.gravarConfigPainel("popupRegiao", true);
    assert.deepEqual(await C.lerConfigPainel(), { popupEstado: false, popupRegiao: true });
    assert.equal((await dbmod.query<{ value: string }>("SELECT value FROM settings WHERE key='painel_popup_estado'")).rows[0].value, "0");
    for (const x of ["popupEstado", "popupRegiao"]) assert.ok(C.ehChavePainel(x));
    for (const x of ["admin_password", "reenvio_ativo", "__proto__", "toString", "", undefined, 1]) assert.ok(!C.ehChavePainel(x), String(x));
  } finally { await dbmod._closeDbForTests(); }
});

test("rota de configurações: gravar exige nível total e usa só a lista fixa; ler vale para qualquer nível", () => {
  const rota = readFileSync(join(__dirname, "../app/api/admin/configuracoes/route.ts"), "utf8");
  assert.match(rota, /export async function POST[\s\S]*exigirNivel\(req, "total"/);
  assert.match(rota, /export async function GET[\s\S]*exigirNivel\(req, "leitura"/);
  assert.match(rota, /ehChavePainel\(b\?\.chave\)/);
  const pag = readFileSync(join(__dirname, "../app/admin/configuracoes/page.tsx"), "utf8");
  assert.match(pag, /nivelOk\(s\.nivel, "total"\)/);
});
