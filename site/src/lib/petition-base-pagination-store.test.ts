import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { parseBaseInventoryCursor, baseInventoryCursor } from "./petition-base-pagination";

(process.env as Record<string,string>).NODE_ENV="test";
process.env.MAIL_PROVIDER="dev";
process.env.GOVBR_BASE_ENABLED="1";
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const stamp="2026-11-10T10:00:00.123456Z";
const bytes=Buffer.from("%PDF-1.7 QA BASE INVENTORY - FICTITIOUS ONLY");
const hash=createHash("sha256").update(bytes).digest("hex");
async function fixture(schema:string) {
 const db=await import("./db"),U=await import("./admin-users"),S=await import("./petition-base-store");
 await db._openForTests(schema);process.env.GOVBR_BASE_ENABLED="1";
 await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash)VALUES(1,'qa-inventory-owner@example.test','QA Inventory Owner','total','QA-NOT-A-LOGIN-HASH'),(2,'qa-inventory-reader@example.test','QA Inventory Reader','leitura','QA-NOT-A-LOGIN-HASH')");
 const session=await U.abrirSessao(1,"127.0.0.1");await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=1");
 const actor=(await U.sessaoPorToken(session.token))!;
 const insert=async(n:number,at=stamp)=>db.query("INSERT INTO petition_base_artifacts(id,bytes,sha256,uploaded_by,uploaded_at)VALUES($1,$2,$3,1,$4::timestamptz)",[uuid(n),bytes,hash,at]);
 const snapshot=async()=>(await db.query("SELECT row_to_json(a)::text data FROM petition_base_artifacts a ORDER BY id")).rows;
 const noEffects=async()=>{assert.equal((await db.query("SELECT 1 FROM petition_base_validations UNION ALL SELECT 1 FROM petition_base_selections UNION ALL SELECT 1 FROM batch_packages UNION ALL SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM batch_sends")).rowCount,0);};
 return{db,U,S,session,actor,insert,snapshot,noEffects};
}
test("SQL cursor preserves microseconds and UUID order across inserts between explicit pages",async()=>{
 const c=await fixture("t_base_inventory_pagination_micro");try{
  for(let n=1;n<=45;n++)await c.insert(n);
  const first=await c.S.listStagedPetitionBases(c.actor);assert.ok(first.ok);assert.equal(first.artifacts.length,20);assert.equal(first.hasMore,true);assert.ok(first.nextCursor);
  assert.deepEqual(first.artifacts.map(x=>x.artifactId),Array.from({length:20},(_,n)=>uuid(45-n)));
  assert.equal(parseBaseInventoryCursor(first.nextCursor)?.uploadedAt,stamp);assert.equal(first.artifacts.at(-1)?.uploadedAt,stamp);
  await c.insert(80,"2026-11-10T10:00:00.123457Z");await c.insert(81);await c.insert(82,"2026-11-10T10:00:00.123455Z");
  const second=await c.S.listStagedPetitionBases(c.actor,first.nextCursor);assert.ok(second.ok);assert.ok(second.nextCursor);assert.equal(second.hasMore,true);
  const third=await c.S.listStagedPetitionBases(c.actor,second.nextCursor);assert.ok(third.ok);assert.equal(third.nextCursor,null);assert.equal(third.hasMore,false);
  const combined=[...first.artifacts,...second.artifacts,...third.artifacts];assert.equal(new Set(combined.map(x=>x.artifactId)).size,46);assert.equal(combined.length,46);
  assert.ok(Array.from({length:45},(_,n)=>uuid(n+1)).every(id=>combined.some(row=>row.artifactId===id)));assert.ok(combined.some(row=>row.artifactId===uuid(82)));assert.ok(!combined.some(row=>[uuid(80),uuid(81)].includes(row.artifactId)));
  const refreshed=await c.S.listStagedPetitionBases(c.actor);assert.ok(refreshed.ok);assert.deepEqual(refreshed.artifacts.slice(0,2).map(x=>x.artifactId),[uuid(80),uuid(81)]);
  assert.ok(combined.every(x=>x.usableInPackage===false));assert.equal(JSON.stringify(combined).includes('"bytes"'),false);await c.noEffects();
 }finally{await c.db._closeDbForTests();}
});
test("microseconds within one JS millisecond remain distinct at the page boundary",async()=>{
 const c=await fixture("t_base_inventory_micro_boundary");try{
  for(let n=1;n<=25;n++)await c.insert(n,`2026-11-10T10:00:00.${String(123400+n).padStart(6,"0")}Z`);
  const first=await c.S.listStagedPetitionBases(c.actor);assert.ok(first.ok);assert.ok(first.nextCursor);assert.equal(parseBaseInventoryCursor(first.nextCursor)?.uploadedAt,"2026-11-10T10:00:00.123406Z");
  const second=await c.S.listStagedPetitionBases(c.actor,first.nextCursor);assert.ok(second.ok);assert.deepEqual(second.artifacts.map(x=>x.artifactId),[5,4,3,2,1].map(uuid));assert.equal(second.nextCursor,null);
  await c.noEffects();
 }finally{await c.db._closeDbForTests();}
});
test("cursor reads require current Total+stepup and never modify immutable artifacts",async()=>{
 const c=await fixture("t_base_inventory_cursor_auth");try{
  await c.insert(1);const before=await c.snapshot(),cursor=baseInventoryCursor({artifactId:uuid(2),uploadedAt:stamp});
  assert.deepEqual(await c.S.listStagedPetitionBases(null,cursor),{ok:false,error:"forbidden"});
  await c.db.query("UPDATE admin_sessions SET stepup_ate=NULL WHERE user_id=1");assert.deepEqual(await c.S.listStagedPetitionBases(c.actor,cursor),{ok:false,error:"forbidden"});
  await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes' WHERE user_id=1;UPDATE admin_users SET nivel='edicao' WHERE id=1");assert.deepEqual(await c.S.listStagedPetitionBases(c.actor,cursor),{ok:false,error:"forbidden"});
  assert.deepEqual(await c.snapshot(),before);await c.noEffects();
 }finally{await c.db._closeDbForTests();}
});
test("HTTP cursor is bounded/exclusive with requestId and preserves metadata/auth/error distinctions",async()=>{
 const c=await fixture("t_base_inventory_cursor_http");try{
  const {GET,POST}=await import("../app/api/admin/documentos/base/route");await c.insert(1);
  const cursor=baseInventoryCursor({artifactId:uuid(2),uploadedAt:stamp});
  const req=(query="",cookie=`adm=${c.session.token}`,method="GET")=>new NextRequest("http://localhost/api/admin/documentos/base"+query,{method,headers:{host:"localhost",origin:"http://localhost",cookie}});
  const response=await GET(req("?cursor="+encodeURIComponent(cursor)));assert.equal(response.status,200);assert.match(response.headers.get("cache-control")??"",/no-store/);
  const page=await response.json();assert.equal(page.artifacts.length,1);assert.equal(page.artifacts[0].uploadedAt,stamp);assert.equal(page.nextCursor,null);
  for(const query of ["?cursor=bad","?cursor=","?cursor="+"x".repeat(81),"?cursor="+encodeURIComponent(cursor)+"&requestId="+randomUUID(),"?cursor="+encodeURIComponent(cursor)+"&cursor="+encodeURIComponent(cursor),"?unknown=1"]){assert.equal((await GET(req(query))).status,400,query);}
  assert.equal((await GET(req("?cursor="+encodeURIComponent(cursor),""))).status,401);
  const reader=await c.U.abrirSessao(2,"127.0.0.1");assert.equal((await GET(req("?cursor="+encodeURIComponent(cursor),`adm=${reader.token}`))).status,403);
  assert.equal((await POST(req("?cursor="+encodeURIComponent(cursor),undefined,"POST"))).status,400);
  await c.db.query("UPDATE admin_sessions SET stepup_ate=NULL WHERE user_id=1");assert.equal((await GET(req("?cursor="+encodeURIComponent(cursor)))).status,403);
  await c.noEffects();
 }finally{await c.db._closeDbForTests();}
});
test("exact upload request recovery still works with inventory disabled and cannot be combined with pagination",async()=>{
 const c=await fixture("t_base_inventory_exact_recovery");try{
  const requestId=randomUUID(),staged=await c.S.stagePetitionBase({requestId,bytes},c.actor);assert.ok(staged.ok);
  const before=await c.snapshot();process.env.GOVBR_BASE_ENABLED="0";
  assert.deepEqual(await c.S.listStagedPetitionBases(c.actor),{ok:false,error:"disabled"});
  const {GET}=await import("../app/api/admin/documentos/base/route");const req=(query:string)=>new NextRequest("http://localhost/api/admin/documentos/base"+query,{headers:{host:"localhost",cookie:`adm=${c.session.token}`}});
  const recovered=await GET(req("?requestId="+requestId));assert.equal(recovered.status,200);assert.equal((await recovered.json()).artifactId,staged.artifactId);
  assert.equal((await GET(req("?requestId="+requestId+"&cursor="+encodeURIComponent(baseInventoryCursor({artifactId:uuid(1),uploadedAt:stamp}))))).status,400);
  assert.deepEqual(await c.snapshot(),before);await c.noEffects();
 }finally{process.env.GOVBR_BASE_ENABLED="1";await c.db._closeDbForTests();}
});
