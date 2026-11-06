import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
(process.env as Record<string,string>).NODE_ENV="test";

test("terminal API records request before execution and audits actual success, failure and rejection",async()=>{
 const db=await import("./db");await db._openForTests("t_terminal_result");
 const U=await import("./admin-users"),T=await import("./terminal");
 const {ADMIN_COOKIE}=await import("./admin");const {NextRequest}=await import("next/server");
 const {POST}=await import("../app/api/admin/terminal/route");
 const S=await import("../../scripts/terminal-servico.mjs" as string);
 delete process.env.PREVIEW_MODE;delete process.env.ADMIN_NO_PASSWORD;
 const key="test-terminal-key-".repeat(4);process.env.TERMINAL_SECRET=key;
 const service=S.criarServidor({segredo:key,log:()=>{}});let requests=0,legacy=false,forged=false;
 const gateway=createServer(async(req,res)=>{
  if(req.method === "GET") {
   if(legacy){res.writeHead(404);res.end();}else service.emit("request",req,res);
   return;
  }
  requests++;
  try {
   const row=(await db.query("SELECT ok,resultado FROM admin_acoes WHERE acao='terminal.comando' ORDER BY id DESC LIMIT 1")).rows[0];
   assert.equal(row.ok,false);assert.equal(row.resultado.estado,"solicitado");
   assert.equal(req.headers.accept,"application/x-ndjson");
   if(forged){
    const identity=JSON.parse(Buffer.from(String(req.headers["x-ticket"]).split(".")[0],"base64url").toString("utf8"));
    res.writeHead(200,{"content-type":"application/x-ndjson"});
    res.end(JSON.stringify({type:"result",code:0,signal:null,timedOut:false,truncated:false,spawnError:false,bytes:0,nonce:identity.n,commandHash:identity.h,signature:"0".repeat(64)})+"\n");return;
   }
   if(legacy){res.writeHead(200,{"content-type":"text/plain"});res.end("legacy output");return;}
   service.emit("request",req,res);
  }catch{res.writeHead(500);res.end();}
 });
 await new Promise<void>(resolve=>gateway.listen(0,"127.0.0.1",resolve));
 process.env.TERMINAL_URL=`http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
 try {
  const user=await U.criarUsuario({email:"terminal-owner@example.org",nome:"Dona Teste",nivel:"total",senha:"Uma-Senha-Forte-2026"});assert.ok(user.ok);
  const session=await U.abrirSessao(user.usuario.id,"127.0.0.1");await T.ligarTerminal(5);
  const request=(command:string,authenticated=true)=>new NextRequest("http://localhost/api/admin/terminal",{method:"POST",headers:{host:"localhost",origin:"http://localhost",cookie:authenticated?`${ADMIN_COOKIE}=${session.token}`:"","x-forwarded-for":"10.18.0.1","content-type":"application/json"},body:JSON.stringify({comando:command})});
  assert.equal((await POST(request("echo should-not-run",false))).status,401);
  assert.equal((await POST(request("echo needs-stepup"))).status,403);assert.equal(requests,0);
  await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE user_id=$1",[user.usuario.id]);
  const failed=await POST(request("printf 'olá'; exit 7"));assert.equal(failed.status,200);assert.match(await failed.text(),/olá.*\[saiu com 7\]/s);
  const success=await POST(request("printf success; exit 0"));assert.equal(success.status,200);await success.text();
  legacy=true;assert.equal((await POST(request("legacy"))).status,502);
  legacy=false;forged=true;
  const invalid=await POST(request("forged response"));assert.equal(invalid.status,200);await assert.rejects(invalid.text());
  const rows=(await db.query("SELECT email,ok,resultado FROM admin_acoes WHERE acao='terminal.comando' ORDER BY id")).rows;
  assert.equal(requests,3);assert.equal(rows.length,4);assert.ok(rows.every(row=>row.email===user.usuario.email));
  assert.deepEqual(rows.map(row=>[row.ok,row.resultado.estado,row.resultado.code]),[[false,"falhou",7],[true,"concluido",0],[false,"recusado",null],[false,"indeterminado",null]]);
  assert.equal(rows[2].resultado.reason,"protocol");assert.equal(rows[3].resultado.reason,"protocol");
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_log WHERE event='terminal_resultado'")).rows[0].n,4);
  assert.ok((await db.verifyAuditChain()).ok);
 }finally{
  gateway.closeAllConnections();await new Promise<void>(resolve=>gateway.close(()=>resolve()));
  delete process.env.TERMINAL_SECRET;delete process.env.TERMINAL_URL;await db._closeDbForTests();
 }
});

test("terminal journal rolls back success when its audit fails and finalizes each request once",async()=>{
 const db=await import("./db");await db._openForTests("t_terminal_atomic");
 const {recordTerminalRequest,recordTerminalResult}=await import("./terminal-audit");
 const actor={userId:1,email:"owner@example.org"};
 const result={estado:"concluido" as const,code:0,signal:null,timedOut:false,truncated:false,spawnError:false,bytes:0};
 try{
  const id=await recordTerminalRequest(actor,"echo fixture");
  await db.query(`CREATE FUNCTION fail_terminal_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='terminal_resultado' THEN RAISE EXCEPTION 'terminal audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_terminal_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_terminal_audit();`);
  await assert.rejects(recordTerminalResult(id,actor,result),/terminal audit failure/);
  const row=(await db.query("SELECT ok,resultado FROM admin_acoes WHERE id=$1",[id])).rows[0];
  assert.equal(row.ok,false);assert.equal(row.resultado.estado,"solicitado");
  await db.query("DROP TRIGGER fail_terminal_audit ON audit_log");
  await recordTerminalResult(id,actor,result);await recordTerminalResult(id,actor,result);
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_log WHERE event='terminal_resultado'")).rows[0].n,1);
  assert.ok((await db.verifyAuditChain()).ok);
 }finally{await db._closeDbForTests();}
});
