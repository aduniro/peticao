import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const DEPLOY = join(__dirname, "../../../deploy");
function ambiente(deployCodigo = 0) {
  const raiz = mkdtempSync(join(tmpdir(), "publicar-")), pedidos = join(raiz,"pedidos"), estado = join(raiz,"estado"), stage = join(raiz,"site");
  for (const p of [pedidos,estado,stage]) mkdirSync(p);
  writeFileSync(join(stage,"package.json"),'{"name":"fixture"}'); writeFileSync(join(stage,"VERSAO"),"a".repeat(40));
  const deploy = join(raiz,"deploy.sh");
  writeFileSync(deploy,`#!/bin/sh\nprintf '%s\\n' "$PETICAO_CANDIDATO_SHA256" >> '${join(raiz,"chamadas")}'\nexit ${deployCodigo}\n`,{mode:0o755});
  const env = {...process.env,PUBLICAR_TESTING:"1",PUBLICAR_PEDIDO:join(pedidos,"publicar.pedido"),PUBLICAR_ESTADO_DIR:estado,PUBLICAR_STAGE:stage,PUBLICAR_DEPLOY:deploy,PUBLICAR_LOCK:join(raiz,"request.lock"),PUBLICAR_DEPLOY_LOCK:join(raiz,"deploy.lock")};
  const prepare = () => JSON.parse(execFileSync("python3",[join(DEPLOY,"publication.py"),"--prepare"],{env,encoding:"utf8"}));
  const candidate = prepare();
  const rodar = () => execFileSync("bash",[join(DEPLOY,"peticao-publicar-executar.sh")],{env,stdio:"pipe"});
  const sinal = (extra:Record<string,unknown>={}) => writeFileSync(env.PUBLICAR_PEDIDO,JSON.stringify({id:"0123456789abcdef",candidato:candidate.sha256,por:"dona@example.org",...extra})+"\n");
  const chamadas = () => existsSync(join(raiz,"chamadas")) ? readFileSync(join(raiz,"chamadas"),"utf8").trim().split("\n") : [];
  return {raiz,env,stage,estado,prepare,candidate,rodar,sinal,chamadas,pedido:env.PUBLICAR_PEDIDO,estadoJson:()=>JSON.parse(readFileSync(join(estado,"publicar.estado"),"utf8"))};
}
function noEnv(a:ReturnType<typeof ambiente>) {process.env.PUBLICAR_PEDIDO=a.env.PUBLICAR_PEDIDO;process.env.PUBLICAR_ESTADO_DIR=a.env.PUBLICAR_ESTADO_DIR;delete process.env.PREVIEW_MODE;}

test("executor publica só o candidato preparado; consome o pedido uma vez e recusa replay",()=>{
 const a=ambiente();a.rodar();assert.equal(a.chamadas().length,0);
 a.sinal();a.rodar();assert.deepEqual(a.chamadas(),[a.candidate.sha256]);assert.equal(existsSync(a.pedido),false);
 assert.equal(a.estadoJson().estado,"ok");assert.equal(a.estadoJson().candidato,a.candidate.sha256);
 a.sinal();a.rodar();assert.equal(a.estadoJson().estado,"recusado");assert.equal(a.chamadas().length,1);
});
test("executor recusa stage alterado depois da preparação",()=>{
 const a=ambiente();a.sinal();writeFileSync(join(a.stage,"changed.ts"),"mudou");a.rodar();assert.equal(a.estadoJson().estado,"recusado");assert.equal(a.chamadas().length,0);
});
test("executor recusa hash diferente, manifesto ausente e sinais inválidos",()=>{
 const a=ambiente();
 for(const data of ['{"id":"nao-hex"}',JSON.stringify({id:"a".repeat(16),candidato:"0".repeat(64)}),"x".repeat(3000)]) {writeFileSync(a.pedido,data);a.rodar();assert.equal(a.estadoJson().estado,"recusado");}
 a.sinal({candidato:undefined});a.rodar();assert.equal(a.estadoJson().estado,"recusado");
 const target=join(a.raiz,"target");writeFileSync(target,"intacto");symlinkSync(target,a.pedido);a.rodar();assert.equal(a.estadoJson().estado,"recusado");assert.equal(readFileSync(target,"utf8"),"intacto");
 assert.equal(a.chamadas().length,0);
});
test("executor registra expiração e falha de deploy sem executar texto do pedido",()=>{
 const a=ambiente(3);a.sinal();const old=new Date(Date.now()-3600000);utimesSync(a.pedido,old,old);a.rodar();assert.equal(a.estadoJson().estado,"expirado");
 const marker=join(a.raiz,"injection");a.sinal({por:`$(touch ${marker})`,comando:`touch ${marker}`});a.rodar();assert.equal(a.estadoJson().estado,"falhou");assert.equal(a.estadoJson().codigo,3);assert.equal(existsSync(marker),false);
});
test("site exige o hash simulado e publica o sinal sem sobrescrever outro pedido",async()=>{
 const P=await import("./publicar");const a=ambiente();noEnv(a);
 assert.equal(P.candidatoPreparado()?.sha256,a.candidate.sha256);
 assert.deepEqual(P.pedirPublicacao("dona@example.org","0".repeat(64)),{ok:false,erro:"gravar"});
 const r=P.pedirPublicacao("dona@example.org",a.candidate.sha256);assert.ok(r.ok);
 const before=readFileSync(a.pedido,"utf8");assert.equal(JSON.parse(before).candidato,a.candidate.sha256);
 assert.deepEqual(P.pedirPublicacao("dona@example.org",a.candidate.sha256),{ok:false,erro:"ja_pedido"});assert.equal(readFileSync(a.pedido,"utf8"),before);
 a.rodar();assert.equal(P.situacaoPublicacao().ultimo?.estado,"ok");
 process.env.PREVIEW_MODE="1";assert.deepEqual(P.pedirPublicacao("x",a.candidate.sha256),{ok:false,erro:"preview"});delete process.env.PREVIEW_MODE;
 process.env.PUBLICAR_ESTADO_DIR=join(a.raiz,"absent");assert.deepEqual(P.pedirPublicacao("x",a.candidate.sha256),{ok:false,erro:"nao_instalado"});
});
test("site não substitui pedido expirado e rejeita troca do candidato após simular",async()=>{
 const P=await import("./publicar");const a=ambiente();noEnv(a);a.sinal();const old=new Date(Date.now()-3600000);utimesSync(a.pedido,old,old);
 const before=readFileSync(a.pedido,"utf8");assert.deepEqual(P.pedirPublicacao("x",a.candidate.sha256),{ok:false,erro:"ja_pedido"});assert.equal(readFileSync(a.pedido,"utf8"),before);a.rodar();
 writeFileSync(join(a.stage,"new.ts"),"alterado");a.prepare();assert.deepEqual(P.pedirPublicacao("x",a.candidate.sha256),{ok:false,erro:"gravar"});
});

test("ação vincula o pedido ao hash devolvido pela simulação e recusa parâmetros extras",async()=>{
 const {publicarPedir}=await import("./acoes/publicar");const a=ambiente();noEnv(a);
 assert.equal(publicarPedir.validar({comando:"outro"}).ok,false);
 assert.equal(publicarPedir.validar({candidato:"invalid"}).ok,false);
 assert.equal(publicarPedir.validar({}).ok,true);
 const simulated=await publicarPedir.simular({});
 const candidate=simulated.candidato as {sha256:string};assert.equal(candidate.sha256,a.candidate.sha256);
 await assert.rejects(publicarPedir.executar({}, {userId:1,email:"dona@example.org"}));assert.equal(existsSync(a.pedido),false);
 const result=await publicarPedir.executar({candidato:candidate.sha256},{userId:1,email:"dona@example.org"});
 assert.ok(result.pedido);assert.equal(JSON.parse(readFileSync(a.pedido,"utf8")).candidato,candidate.sha256);
});
