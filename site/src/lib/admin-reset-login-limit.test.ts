import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

(process.env as Record<string,string>).NODE_ENV="test";
process.env.MAIL_PROVIDER="dev";
process.env.TURNSTILE_SITE_KEY="";
process.env.TURNSTILE_SECRET_KEY="";
delete process.env.PREVIEW_MODE;
delete process.env.ADMIN_NO_PASSWORD;

test("somente reset persistido libera login do próprio IP; falha, token vencido e replay não liberam", async () => {
  const db=await import("./db");
  await db._openForTests("t_admin_reset_login_limit");
  try {
    const U=await import("./admin-users");
    const {rateLimit,clearRateLimit}=await import("./ratelimit");
    const {POST:reset}=await import("@/app/api/admin/redefinir/route");
    const {NextRequest}=await import("next/server");
    const created=await U.criarUsuario({email:"reset-limit@example.test",nome:"Pessoa QA",nivel:"total",senha:"Senha-Inicial-QA-2026"});
    assert.ok(created.ok);
    const oldSession=await U.abrirSessao(created.usuario.id,"192.0.2.31");
    const ip="192.0.2.31",other="192.0.2.32";
    const exhaust=(key:string)=>{clearRateLimit(key);for(let i=0;i<5;i++)assert(rateLimit(key,5,900_000));};
    exhaust(`admin:${ip}`);exhaust(`admin:${other}`);
    async function post(token:string,senha="Senha-Nova-QA-2026",senha2=senha){
      const form=new FormData();form.set("token",token);form.set("senha",senha);form.set("senha2",senha2);
      return reset(new NextRequest("http://localhost:3321/api/admin/redefinir",{method:"POST",body:form,headers:{host:"localhost:3321",origin:"http://localhost:3321","x-forwarded-for":ip}}));
    }
    const token=randomBytes(32).toString("base64url"),hash=createHash("sha256").update(token).digest("hex");
    await db.query("INSERT INTO admin_reset(user_id,token_hash,expira_em) VALUES($1,$2,now()+interval '30 minutes')",[created.usuario.id,hash]);
    let r=await post(randomBytes(32).toString("base64url"));assert.match(r.headers.get("location")!,/erro=token/);assert.equal(rateLimit(`admin:${ip}`,5,900_000),false);
    r=await post(token,"Senha-Nova-QA-2026","outra");assert.match(r.headers.get("location")!,/erro=diferentes/);assert.equal(rateLimit(`admin:${ip}`,5,900_000),false);
    r=await post(token,"curta");assert.match(r.headers.get("location")!,/erro=fraca/);assert.equal(rateLimit(`admin:${ip}`,5,900_000),false);
    await db.query("UPDATE admin_reset SET expira_em=now()-interval '1 second' WHERE token_hash=$1",[hash]);
    r=await post(token);assert.match(r.headers.get("location")!,/erro=token/);assert.equal(rateLimit(`admin:${ip}`,5,900_000),false);
    await db.query("UPDATE admin_reset SET expira_em=now()+interval '30 minutes' WHERE token_hash=$1",[hash]);
    await db.query("CREATE FUNCTION fail_reset_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='admin_senha_redefinida' THEN RAISE EXCEPTION 'reset audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_reset_commit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_reset_commit()");
    await assert.rejects(post(token),/reset audit failure/);assert.equal(rateLimit(`admin:${ip}`,5,900_000),false);assert.ok(await U.sessaoPorToken(oldSession.token));
    await db.query("DROP TRIGGER fail_reset_commit ON audit_log");
    r=await post(token);assert.match(r.headers.get("location")!,/msg=senha-redefinida/);assert.equal(rateLimit(`admin:${ip}`,5,900_000),true);assert.equal(rateLimit(`admin:${other}`,5,900_000),false);
    assert.equal(await U.sessaoPorToken(oldSession.token),null);assert.equal((await U.autenticar(created.usuario.email,"Senha-Nova-QA-2026")).ok,true);
    assert.equal((await db.query("SELECT usado FROM admin_reset WHERE token_hash=$1",[hash])).rows[0].usado,true);
    exhaust(`admin:${ip}`);r=await post(token);assert.match(r.headers.get("location")!,/erro=token/);assert.equal(rateLimit(`admin:${ip}`,5,900_000),false);
  } finally {await db._closeDbForTests();}
});
