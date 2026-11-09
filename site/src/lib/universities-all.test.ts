import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { _openForTests, _closeDbForTests, query } from "./db";
import { GET } from "../app/api/universidades/route";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";

test("universidades: all=1 sem texto lista país completo; padrão e digitação preservam40 sugestões", async () => {
  await _openForTests("test_universities_all_20261109_a");
  try {
    await query(`INSERT INTO world_universities(name,country,domain,web,state)
      SELECT 'Universidade Fictícia '||lpad(n::text,2,'0'),'PT','pt-'||n||'.example.invalid','',''
      FROM generate_series(1,55)n`);
    await query(`INSERT INTO world_universities(name,country,domain,web,state) VALUES
      ('Universidade Fictícia 01','PT','duplicate.example.invalid','',''),
      ('Universidade Espanhola Fictícia','ES','es.example.invalid','','')`);
    const get = async (search: string) => {
      const response = await GET(new NextRequest("http://127.0.0.1/api/universidades?" + search, { headers: { "x-forwarded-for": "127.0.0.48" } }));
      assert.equal(response.status, 200);
      return (await response.json()).items as { name: string; domain: string }[];
    };
    const all = await get("c=PT&all=1");
    assert.equal(all.length, 55, "não truncar além de40; remover só nome duplicado");
    assert.ok(all.every((i) => i.domain.startsWith("pt-") || i.domain === "duplicate.example.invalid"), "nenhuma universidade espanhola vaza para o país PT");
    assert.equal(new Set(all.map((i) => i.name)).size, 55);
    assert.equal((await get("c=PT")).length, 40);
    assert.equal((await get("c=PT&all=0")).length, 40);
    assert.equal((await get("c=PT&all=true")).length, 40);
    assert.equal((await get("c=PT&all=1&q=Universidade")).length, 40, "texto digitado preserva limite mesmo com all=1");
    const typed = await get("c=PT&q=ficticia%2001");
    assert.equal(typed.length, 1);
    assert.equal(typed[0].name, "Universidade Fictícia 01", "filtro sem diferença de caixa e acento preservado");
    assert.deepEqual(await get("c=PT&all=1&q=inexistente"), []);
    const other = await get("c=ES&all=1");
    assert.equal(other.length, 1);
    assert.equal(other[0].domain, "es.example.invalid");
    assert.deepEqual(await get("c=INVALID&all=1"), []);
    assert.deepEqual(await get("all=1"), []);
    assert.equal((await get("c=pt&all=1")).length, 55, "normalização de país existente preservada");
  } finally {
    await _closeDbForTests();
  }
});
