import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { receberMensagens } from "../ponte/vigia-state.mjs";
import { listarChaves } from "../ponte/ler.mjs";
const message = id => ({ id, recebido: "2026-11-06T22:00:00Z", de: "operator-1608598f41@example.invalid", auth: "dkim=pass header.d=protonmail.com", assunto: "Pedido fictício", raw: "Content-Type: text/plain\n\nPedido fictício" });
test("vigia guarda mensagens distintas com mesmo horário, exige DKIM e não duplica nem altera fila existente", () => {
  const dir = mkdtempSync(join(tmpdir(), "vigia-"));
  try {
    const messages = [message("m:1"), message("m:2"), { ...message("m:3"), auth:"dkim=pass header.d=example.org" }, { ...message("m:4"), de:"outro@example.org" }];
    const state = receberMensagens(messages, dir, {});
    assert.equal(state.novos, 2);
    const files = readdirSync(join(dir,"entrada"));
    assert.equal(files.length,2);
    const path = join(dir,"entrada",files[0]), before = readFileSync(path,"utf8");
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(receberMensagens(messages, dir, state).novos,0);
    assert.equal(readFileSync(path,"utf8"),before);
    assert.equal(JSON.parse(before).status,"aguardando_leitura");
    assert.match(JSON.parse(before).corpo,/Pedido fictício/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test("vigia não avança estado quando não pode persistir a entrada", () => {
  const dir = mkdtempSync(join(tmpdir(),"vigia-"));
  try {
    assert.throws(()=>receberMensagens([message("m:1")], join(dir,"ausente","arquivo"), {}, ()=>{throw new Error("falha de processo");}));
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test("ponte percorre paginação completa e recusa erro ou cursor repetido", async () => {
  const paths=[];
  const keys=await listarChaves(async p=>{paths.push(p);return paths.length===1?{success:true,result:[{name:"m:1"}],result_info:{cursor:"next+/="}}:{success:true,result:[{name:"m:2"}],result_info:{cursor:""}};},"account","box");
  assert.deepEqual(keys.map(k=>k.name),["m:1","m:2"]);
  assert.match(paths[1],/cursor=next%2B%2F%3D/);
  await assert.rejects(listarChaves(async()=>({success:false}),"a","b"));
  await assert.rejects(listarChaves(async()=>({success:true,result:[],result_info:{cursor:"again"}}),"a","b"),/repetida/);
});
