import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

(process.env as Record<string, string>).NODE_ENV = "test";
delete process.env.PREVIEW_MODE;
delete process.env.ADMIN_NO_PASSWORD;
const RECOVERY_SCHEMA_SQL=String.raw`-- Additive evolution; no backfill or inference of historical operation.
ALTER TABLE admin_referral_mutations ADD COLUMN IF NOT EXISTS operation TEXT;
ALTER TABLE admin_referral_mutations ADD COLUMN IF NOT EXISTS expected_version BIGINT;
DO $referral_recovery$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='admin_referral_mutations'::regclass AND conname='admin_referral_mutation_context_check') THEN
  ALTER TABLE admin_referral_mutations ADD CONSTRAINT admin_referral_mutation_context_check CHECK(
   (operation IS NULL AND expected_version IS NULL)
   OR (operation IS NOT NULL AND operation IN ('edit','archive','restore') AND expected_version IS NOT NULL AND expected_version>0)
  );
 END IF;
END; $referral_recovery$;
`;
async function setup(schema: string) {
  const db = await import("./db"); await db._openForTests(schema);await db.query(RECOVERY_SCHEMA_SQL);
  const users = await import("./admin-users"), M = await import("./admin-referral-management");
  const created = await users.criarUsuario({ email: "qa-management@example.test", nome: "QA Operator", nivel: "total", senha: "QA-Tests-2026-Ficticia" }); assert.ok(created.ok);
  const session = await users.abrirSessao(created.usuario.id, "127.0.0.1"), actor = (await users.sessaoPorToken(session.token))!;
  await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE id=$1", [actor.sessaoId]);
  const row = (await db.query("INSERT INTO referrers(code,manage_token_hash,label) VALUES('ABCDEFG','QA-SECRET-TOKEN-HASH','QA Original') RETURNING id")).rows[0];
  const input = (operation: "edit" | "archive" | "restore", version = "1", extra = {}) => ({ id: row.id, operation, version, requestId: randomUUID(), ...(operation === "edit" ? { label: "QA Alterado" } : {}), ...extra });
  return { db, users, M, actor, token: session.token, row, input };
}

test("label edit, archive and restoration preserve links, tokens, attribution and historical counts", async () => {
  const c = await setup("t_referral_manage_lifecycle");
  try {
    const ref = await import("./referrals");
    const s = (await c.db.query("INSERT INTO signatures(name,email,email_hash,category,text_version,consent_at,status,ref_code) VALUES('QA Pessoa','qa@example.test','QA-HASH','apoiador','QA',now(),'confirmed','ABCDEFG') RETURNING id")).rows[0];
    const before = (await c.db.query("SELECT row_to_json(s)::text raw FROM signatures s")).rows;
    const initial = await ref.referrerStats("ABCDEFG");
    const edit = await c.M.manageAdministrativeReferral(c.input("edit"), c.actor); assert.ok(edit.ok); assert.equal(edit.row.version, "2");
    const archived = await c.M.manageAdministrativeReferral(c.input("archive", "2"), c.actor); assert.ok(archived.ok); assert.ok(archived.row.archivedAt);
    assert.equal((await c.M.listAdministrativeReferrals(c.actor)).ok, true);
    const active = await c.M.listAdministrativeReferrals(c.actor), hidden = await c.M.listAdministrativeReferrals(c.actor, { filter: "archived" });
    assert.ok(active.ok && hidden.ok); assert.equal(active.rows.length, 0); assert.equal(hidden.rows.length, 1);
    assert.ok(await ref.referrerByCode("ABCDEFG")); assert.equal((await ref.allReferrerStats()).length, 1); assert.deepEqual(await ref.referrerStats("ABCDEFG"), initial);
    assert.deepEqual((await c.db.query("SELECT row_to_json(s)::text raw FROM signatures s")).rows, before);
    const restored = await c.M.manageAdministrativeReferral(c.input("restore", "3"), c.actor); assert.ok(restored.ok); assert.equal(restored.row.version, "4"); assert.equal(restored.row.archivedAt, null);
    assert.equal((await c.db.query("SELECT manage_token_hash FROM referrers WHERE id=$1", [c.row.id])).rows[0].manage_token_hash, "QA-SECRET-TOKEN-HASH");
    assert.equal((await c.db.query("SELECT count(*)::int n FROM admin_referral_mutations")).rows[0].n, 3); assert.ok((await c.db.verifyAuditChain()).ok);
    const audit = JSON.stringify((await c.db.query("SELECT data FROM audit_log WHERE event='admin_referral_managed'")).rows); assert.ok(!audit.includes("QA-SECRET-TOKEN-HASH"));
    assert.equal((await c.db.query("SELECT count(*)::int n FROM mail_outbox")).rows[0].n, 0); assert.ok(s.id);
  } finally { await c.db._closeDbForTests(); }
});

test("same intent replays exact result after later edits; conflicting reuse and concurrent stale versions cannot overwrite", async () => {
  const c = await setup("t_referral_manage_concurrent");
  try {
    const one = c.input("edit"); const pair = await Promise.all([c.M.manageAdministrativeReferral(one, c.actor), c.M.manageAdministrativeReferral(one, c.actor)]); assert.ok(pair[0].ok); assert.deepEqual(pair[0], pair[1]);
    const later = await c.M.manageAdministrativeReferral(c.input("edit", "2", { label: "QA Mais Novo" }), c.actor); assert.ok(later.ok);
    assert.deepEqual(await c.M.manageAdministrativeReferral(one, c.actor), pair[0]);
    assert.deepEqual(await c.M.manageAdministrativeReferral({ ...one, label: "QA Divergente" }, c.actor), { ok: false, error: "conflict" });
    const competing = await Promise.all([c.M.manageAdministrativeReferral(c.input("edit", "3", { label: "QA Concorrente A" }), c.actor), c.M.manageAdministrativeReferral(c.input("edit", "3", { label: "QA Concorrente B" }), c.actor)]);
    assert.equal(competing.filter(r => r.ok).length, 1); assert.equal(competing.filter(r => !r.ok && r.error === "conflict").length, 1);
    assert.equal((await c.db.query("SELECT count(*)::int n FROM admin_referral_mutations")).rows[0].n, 3);
  } finally { await c.db._closeDbForTests(); }
});

test("revoked accounts, identity, session, stepup and archival roles are rechecked before mutation or replay", async () => {
  const c = await setup("t_referral_manage_authorization");
  try {
    const input = c.input("archive");
    assert.deepEqual(await c.M.manageAdministrativeReferral(input, { ...c.actor, email: "wrong@example.test" }), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_sessions SET stepup_ate=NULL WHERE id=$1", [c.actor.sessaoId]); assert.deepEqual(await c.M.manageAdministrativeReferral(input, c.actor), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE id=$1", [c.actor.sessaoId]);
    await c.db.query("UPDATE admin_users SET nivel='edicao' WHERE id=$1", [c.actor.userId]); assert.deepEqual(await c.M.manageAdministrativeReferral(input, c.actor), { ok: false, error: "forbidden" });
    const edited = await c.M.manageAdministrativeReferral(c.input("edit"), c.actor); assert.ok(edited.ok);
    await c.db.query("UPDATE admin_users SET ativo=false WHERE id=$1", [c.actor.userId]); assert.deepEqual(await c.M.listAdministrativeReferrals(c.actor), { ok: false, error: "forbidden" });
    await c.db.query("UPDATE admin_users SET ativo=true WHERE id=$1", [c.actor.userId]); await c.users.encerrarSessao(c.token); assert.deepEqual(await c.M.manageAdministrativeReferral(c.input("edit", "2"), c.actor), { ok: false, error: "forbidden" });
  } finally { await c.db._closeDbForTests(); }
});

test("audit failure rolls back label, version, archive and intention together", async () => {
  const c = await setup("t_referral_manage_rollback");
  try {
    const before = (await c.db.query("SELECT row_to_json(r)::text raw FROM referrers r")).rows;
    await c.db.query("CREATE FUNCTION fail_referral_manage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='admin_referral_managed' THEN RAISE EXCEPTION 'QA audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_referral_manage BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_referral_manage()");
    await assert.rejects(c.M.manageAdministrativeReferral(c.input("archive"), c.actor), /QA audit failure/);
    assert.deepEqual((await c.db.query("SELECT row_to_json(r)::text raw FROM referrers r")).rows, before); assert.equal((await c.db.query("SELECT count(*)::int n FROM admin_referral_mutations")).rows[0].n, 0);
  } finally { await c.db._closeDbForTests(); }
});

test("personal referrals are excluded, invalid state and input cannot become arbitrary column edits", async () => {
  const c = await setup("t_referral_manage_validation");
  try {
    const person = (await c.db.query("INSERT INTO referrers(code,display_name) VALUES('HJKMNPQ','QA Pessoa') RETURNING id")).rows[0];
    assert.deepEqual(await c.M.manageAdministrativeReferral({ ...c.input("edit"), id: person.id }, c.actor), { ok: false, error: "not_found" });
    for (const patch of [{ version: "01" }, { version: "9223372036854775808" }, { requestId: "bad" }, { label: "x" }, { label: "a".repeat(81) }]) assert.deepEqual(await c.M.manageAdministrativeReferral(c.input("edit", "1", patch), c.actor), { ok: false, error: "invalid" });
    assert.deepEqual(await c.M.manageAdministrativeReferral(c.input("restore"), c.actor), { ok: false, error: "conflict" });
    const noop = await c.M.manageAdministrativeReferral(c.input("edit", "1", { label: "QA Original" }), c.actor); assert.ok(noop.ok); assert.equal(noop.changed, false); assert.equal(noop.row.version, "1");
    assert.deepEqual(await c.M.listAdministrativeReferrals(c.actor, { filter: "other" as "all" }), { ok: false, error: "invalid" });
  } finally { await c.db._closeDbForTests(); }
});

test("HTTP guards identity/origin/stepup, bounds input and returns conflicts without changing existing creation flow", async () => {
  const c = await setup("t_referral_manage_http");
  try {
    const { NextRequest } = await import("next/server"), api = await import("../app/api/admin/indicacoes/gestao/route");
    const req = (body: unknown, authenticated = true, origin = "http://localhost") => new NextRequest("http://localhost/api/admin/indicacoes/gestao", { method: "POST", headers: { host: "localhost", origin, cookie: authenticated ? `adm=${c.token}` : "", "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await api.POST(req(c.input("edit"), false))).status, 401);
    assert.equal((await api.POST(req(c.input("edit"), true, "http://other.test"))).status, 403);
    assert.equal((await api.POST(req({ ...c.input("edit"), code: "HJKMNPQ" }))).status, 400);
    assert.equal((await api.POST(req({ ...c.input("edit"), label: "a".repeat(5000) }))).status, 413);
    const input = c.input("edit"); const first = await api.POST(req(input)); assert.equal(first.status, 200); const content = await first.json();
    assert.deepEqual(await (await api.POST(req(input))).json(), content);
    assert.equal((await api.POST(req({ ...input, label: "QA Different" }))).status, 409);
    await c.db.query("UPDATE admin_sessions SET stepup_ate=NULL WHERE id=$1", [c.actor.sessaoId]);
    assert.equal((await api.POST(req(c.input("archive", "2")))).status, 403);
    const read = await api.GET(new NextRequest("http://localhost/api/admin/indicacoes/gestao?filter=all", { headers: { host: "localhost", cookie: `adm=${c.token}` } })); assert.equal(read.status, 200); assert.equal((await read.json()).rows.length, 1);
  } finally { await c.db._closeDbForTests(); }
});

test("administrative pagination keeps active and archived inventories separate without changing public statistics", async () => {
  const c = await setup("t_referral_manage_pages");
  try {
    await c.db.query("INSERT INTO referrers(code,label) VALUES('HJKMNPQ','QA Segundo'),('RSTUVWX','QA Terceiro')");
    await c.M.manageAdministrativeReferral(c.input("archive"), c.actor);
    const page = await c.M.listAdministrativeReferrals(c.actor, { filter: "all", limit: 2 }); assert.ok(page.ok); assert.equal(page.rows.length, 2); assert.ok(page.nextBefore);
    const next = await c.M.listAdministrativeReferrals(c.actor, { filter: "all", limit: 2, before: page.nextBefore! }); assert.ok(next.ok); assert.equal(next.rows.length, 1); assert.equal(next.nextBefore, null); assert.equal(next.rows[0].id, c.row.id);
    const active = await c.M.listAdministrativeReferrals(c.actor, { filter: "active" }); assert.ok(active.ok); assert.equal(active.rows.length, 2);
    const archived = await c.M.listAdministrativeReferrals(c.actor, { filter: "archived" }); assert.ok(archived.ok); assert.equal(archived.rows.length, 1);
    assert.equal((await (await import("./referrals")).allReferrerStats()).length, 3);
  } finally { await c.db._closeDbForTests(); }
});


test("recovery returns exact durable operation/context after newer mutations, scoped to actor",async()=>{
 const c=await setup("t_referral_recovery_exact");try{
  const input=c.input("edit");const result=await c.M.manageAdministrativeReferral(input,c.actor);assert.ok(result.ok);assert.deepEqual(result,{ok:true,requestId:input.requestId,operation:"edit",context:{id:c.row.id,expectedVersion:"1"},row:{id:c.row.id,code:"ABCDEFG",label:"QA Alterado",version:"2",archivedAt:null},changed:true});
  assert.ok((await c.M.manageAdministrativeReferral(c.input("edit","2",{label:"QA Later"}),c.actor)).ok);
  const before=(await c.db.query("SELECT row_to_json(r)::text raw FROM referrers r")).rows;
  assert.deepEqual(await c.M.readAdministrativeReferralMutation(input.requestId,c.actor),result);
  assert.deepEqual((await c.db.query("SELECT row_to_json(r)::text raw FROM referrers r")).rows,before);
  const other=(await c.db.query("INSERT INTO admin_users(email,nome,nivel,senha_hash)VALUES('qa-other@example.test','QA Other','total','QA-NO-LOGIN')RETURNING id")).rows[0];const session=await c.users.abrirSessao(other.id,"127.0.0.1");const actor=(await c.users.sessaoPorToken(session.token))!;
  assert.deepEqual(await c.M.readAdministrativeReferralMutation(input.requestId,actor),{ok:false,error:"not_found"});
  assert.deepEqual(await c.M.readAdministrativeReferralMutation(randomUUID(),c.actor),{ok:false,error:"not_found"});
  assert.equal((await c.db.query("SELECT 1 FROM admin_referral_mutations")).rowCount,2);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}
});
test("recovery authorization derives archival operation from ledger, not current role or request",async()=>{
 const c=await setup("t_referral_recovery_permissions");try{
  const edit=c.input("edit");assert.ok((await c.M.manageAdministrativeReferral(edit,c.actor)).ok);const archive=c.input("archive","2");assert.ok((await c.M.manageAdministrativeReferral(archive,c.actor)).ok);
  await c.db.query("UPDATE admin_sessions SET stepup_ate=NULL WHERE id=$1",[c.actor.sessaoId]);
  assert.ok((await c.M.readAdministrativeReferralMutation(edit.requestId,c.actor)).ok);assert.deepEqual(await c.M.readAdministrativeReferralMutation(archive.requestId,c.actor),{ok:false,error:"forbidden"});assert.deepEqual(await c.M.manageAdministrativeReferral(archive,c.actor),{ok:false,error:"forbidden"});
  await c.db.query("UPDATE admin_users SET nivel='edicao' WHERE id=$1",[c.actor.userId]);await c.db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '15 minutes' WHERE id=$1",[c.actor.sessaoId]);
  assert.deepEqual(await c.M.readAdministrativeReferralMutation(archive.requestId,c.actor),{ok:false,error:"forbidden"});assert.ok((await c.M.readAdministrativeReferralMutation(edit.requestId,c.actor)).ok);
  await c.db.query("UPDATE admin_users SET nivel='leitura' WHERE id=$1",[c.actor.userId]);assert.deepEqual(await c.M.readAdministrativeReferralMutation(edit.requestId,c.actor),{ok:false,error:"forbidden"});
  await c.db.query("UPDATE admin_users SET nivel='total',ativo=false WHERE id=$1",[c.actor.userId]);assert.deepEqual(await c.M.readAdministrativeReferralMutation(edit.requestId,c.actor),{ok:false,error:"forbidden"});
 }finally{await c.db._closeDbForTests();}
});
test("legacy schema evolution preserves historical result and POST replay but GET fails closed",async()=>{
 const c=await setup("t_referral_recovery_legacy");try{
  // Reproduce the old ledger schema before applying the additive migration.
  await c.db.query("ALTER TABLE admin_referral_mutations DROP CONSTRAINT admin_referral_mutation_context_check;ALTER TABLE admin_referral_mutations DROP COLUMN operation;ALTER TABLE admin_referral_mutations DROP COLUMN expected_version");
  const input=c.input("edit");const legacy={ok:true,row:{id:c.row.id,code:"ABCDEFG",label:"QA Alterado",version:"2",archivedAt:null},changed:true};
  const {hmac}=await import("./security");const hash=hmac("admin-referral-mutation:v1:"+JSON.stringify([c.actor.userId,c.row.id,"1","edit","QA Alterado"]));
  await c.db.query("UPDATE referrers SET label='QA Alterado',admin_version=2 WHERE id=$1",[c.row.id]);await c.db.query("INSERT INTO admin_referral_mutations(actor_id,request_id,input_hash,referrer_id,result,created_at)VALUES($1,$2,$3,$4,$5::jsonb,'2026-11-09T01:00:00.123456Z')",[c.actor.userId,input.requestId,hash,c.row.id,JSON.stringify(legacy)]);
  const before=(await c.db.query("SELECT row_to_json(q)::text raw FROM (SELECT actor_id,request_id,input_hash,referrer_id,result,created_at FROM admin_referral_mutations) q")).rows;
  await c.db.query(RECOVERY_SCHEMA_SQL);await c.db.query(RECOVERY_SCHEMA_SQL);
  assert.deepEqual((await c.db.query("SELECT row_to_json(q)::text raw FROM (SELECT actor_id,request_id,input_hash,referrer_id,result,created_at FROM admin_referral_mutations) q")).rows,before);
  assert.deepEqual(await c.M.readAdministrativeReferralMutation(input.requestId,c.actor),{ok:false,error:"legacy_unavailable"});
  assert.deepEqual(await c.M.manageAdministrativeReferral(input,c.actor),legacy);
  const next=c.input("edit","2",{label:"QA Post Upgrade"});const upgraded=await c.M.manageAdministrativeReferral(next,c.actor);assert.ok(upgraded.ok);assert.deepEqual(await c.M.readAdministrativeReferralMutation(next.requestId,c.actor),upgraded);
  assert.deepEqual(await c.M.manageAdministrativeReferral(input,c.actor),legacy);assert.deepEqual(await c.M.manageAdministrativeReferral(next,c.actor),upgraded);
  assert.deepEqual((await c.db.query("SELECT operation,expected_version::text FROM admin_referral_mutations WHERE request_id=$1",[input.requestId])).rows[0],{operation:null,expected_version:null});
  await assert.rejects(c.db.query("UPDATE admin_referral_mutations SET operation='archive' WHERE request_id=$1",[input.requestId]),/admin_referral_mutation_context_check/);
  await assert.rejects(c.db.query("UPDATE admin_referral_mutations SET expected_version=1 WHERE request_id=$1",[input.requestId]),/admin_referral_mutation_context_check/);
  assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}
});
test("corrupt envelope/context/HMAC is never returned as successful recovery",async()=>{
 const c=await setup("t_referral_recovery_corrupt");try{
  const input=c.input("edit");const result=await c.M.manageAdministrativeReferral(input,c.actor);assert.ok(result.ok);
  const original=(await c.db.query("SELECT result FROM admin_referral_mutations WHERE request_id=$1",[input.requestId])).rows[0].result;
  for(const patch of [{...original,operation:"archive"},{...original,context:{id:c.row.id,expectedVersion:"2"}},{...original,row:{...original.row,id:c.row.id+1}},{...original,row:{...original.row,label:"Tampered QA"}},{...original,row:{...original.row,version:"999"}},{...original,secret:"unexpected"}]){
   await c.db.query("UPDATE admin_referral_mutations SET result=$2::jsonb WHERE request_id=$1",[input.requestId,JSON.stringify(patch)]);assert.deepEqual(await c.M.readAdministrativeReferralMutation(input.requestId,c.actor),{ok:false,error:"conflict"});
  }
  await c.db.query("UPDATE admin_referral_mutations SET result=$2::jsonb,input_hash='tampered' WHERE request_id=$1",[input.requestId,JSON.stringify(original)]);assert.deepEqual(await c.M.readAdministrativeReferralMutation(input.requestId,c.actor),{ok:false,error:"conflict"});
 }finally{await c.db._closeDbForTests();}
});
test("GET recovery query whitelist, archival stepup and private headers are enforced",async()=>{
 const c=await setup("t_referral_recovery_http");try{
  const {NextRequest}=await import("next/server"),api=await import("../app/api/admin/indicacoes/gestao/route");
  const get=(query:string,cookie=true)=>new NextRequest("http://localhost/api/admin/indicacoes/gestao"+query,{headers:{host:"localhost",cookie:cookie?`adm=${c.token}`:""}});
  for(const query of ["?unknown=1","?filter=all&filter=all","?limit=2&limit=3","?before=01","?before=2147483648","?requestId="+randomUUID()+"&filter=all","?requestId="+randomUUID()+"&requestId="+randomUUID(),"?requestId=bad"]){const r=await api.GET(get(query));assert.equal(r.status,400,query);assert.equal(r.headers.get("cache-control"),"private, no-store");}
  const denied=await api.GET(get("",false));assert.equal(denied.status,401);assert.equal(denied.headers.get("referrer-policy"),"no-referrer");assert.equal(denied.headers.get("x-content-type-options"),"nosniff");
  const input=c.input("archive");const result=await c.M.manageAdministrativeReferral(input,c.actor);assert.ok(result.ok);
  const read=await api.GET(get("?requestId="+input.requestId));assert.equal(read.status,200);assert.deepEqual(await read.json(),result);for(const key of ["manage_token","input_hash","actor_id"])assert.equal(JSON.stringify(result).includes(key),false);
  await c.db.query("UPDATE admin_sessions SET stepup_ate=NULL WHERE id=$1",[c.actor.sessaoId]);const stale=await api.GET(get("?requestId="+input.requestId));assert.equal(stale.status,403);assert.deepEqual(await stale.json(),{ok:false,erro:"stepup"});
  const inv=await api.GET(get("?filter=all&limit=100"));assert.equal(inv.status,200);assert.equal((await inv.json()).rows.length,1);
 }finally{await c.db._closeDbForTests();}
});
test("new intent envelope retains bigint strings at maximum and normalized no-op labels",async()=>{
 const c=await setup("t_referral_recovery_bigint");try{
  await c.db.query("UPDATE referrers SET admin_version=9223372036854775807 WHERE id=$1",[c.row.id]);
  const input=c.input("edit","9223372036854775807",{label:"  QA   Original  "});const result=await c.M.manageAdministrativeReferral(input,c.actor);assert.ok(result.ok);assert.equal(result.changed,false);assert.equal(result.row.version,"9223372036854775807");assert.deepEqual(await c.M.readAdministrativeReferralMutation(input.requestId,c.actor),result);
  assert.deepEqual(await c.M.manageAdministrativeReferral(c.input("archive","9223372036854775807"),c.actor),{ok:false,error:"conflict"});
 }finally{await c.db._closeDbForTests();}
});
test("pure mutation parser closes keys, operation and bigint boundaries",async()=>{
 const {parseReferralMutationIntent}=await import("./admin-referral-management");const v={id:1,version:"1",requestId:randomUUID(),operation:"edit"as const,label:" QA   Name "};assert.deepEqual(parseReferralMutationIntent(v),{...v,label:"QA Name"});
 for(const patch of [{id:0},{id:2147483648},{version:"01"},{version:"9223372036854775808"},{version:1},{requestId:"00000000-0000-1000-8000-000000000000"},{extra:true},{operation:"restore"},{label:"x"},{label:"a".repeat(81)}])assert.equal(parseReferralMutationIntent({...v,...patch}),null);
 assert.deepEqual(parseReferralMutationIntent({id:1,version:"9223372036854775807",requestId:v.requestId,operation:"archive"}),{id:1,version:"9223372036854775807",requestId:v.requestId,operation:"archive"});
});

test("partially migrated ledger context corruption is conflict, never legacy authorization",async()=>{
 const c=await setup("t_referral_recovery_partial_context");try{
  const input=c.input("edit");assert.ok((await c.M.manageAdministrativeReferral(input,c.actor)).ok);
  // Explicit fictitious partial-migration fixture: remove only this CHECK locally,
  // never alter production or disable application authorization/binding checks.
  await c.db.query("ALTER TABLE admin_referral_mutations DROP CONSTRAINT admin_referral_mutation_context_check");
  for(const [operation,version]of [["invalid","1"],[null,"1"],["edit",null],["edit","0"]]){
   await c.db.query("UPDATE admin_referral_mutations SET operation=$2,expected_version=$3::bigint WHERE request_id=$1",[input.requestId,operation,version]);
   assert.deepEqual(await c.M.readAdministrativeReferralMutation(input.requestId,c.actor),{ok:false,error:"conflict"});
  }
  await c.db.query("UPDATE admin_referral_mutations SET operation=NULL,expected_version=NULL WHERE request_id=$1",[input.requestId]);assert.deepEqual(await c.M.readAdministrativeReferralMutation(input.requestId,c.actor),{ok:false,error:"legacy_unavailable"});
  await c.db.query("UPDATE admin_referral_mutations SET operation='edit',expected_version=1 WHERE request_id=$1",[input.requestId]);await c.db.query(RECOVERY_SCHEMA_SQL);
  const restored=await c.M.readAdministrativeReferralMutation(input.requestId,c.actor);assert.ok(restored.ok);assert.ok((await c.db.verifyAuditChain()).ok);
 }finally{await c.db._closeDbForTests();}
});
