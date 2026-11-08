import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev"; delete process.env.MAIL_PROVIDERS;

test("painel: corrigir e-mail, aceitar sugestão e reenviar confirmação (datas intactas, auditoria, limites)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reenvio-")); process.env.MAIL_OUTBOX_DIR = dir;
  const dbmod = await import("./db"); await dbmod._openForTests("t_assinaturas_email");
  const { query } = dbmod;
  const { _setMxResolverForTests } = await import("./email-check");
  const { corrigirEmail, aceitarSugestao, reenviarConfirmacao } = await import("./assinaturas-email");
  const { suppress } = await import("./mail/suppression");
  const { hmac, sha256 } = await import("./security");
  const { dedupEmail } = await import("./email-check");
  _setMxResolverForTests(async (d) => (d === "unir.bf" || d === "gmial.com" ? "none" : "ok"));
  const criada = "2026-11-02T10:00:00.000Z";
  const mk = async (n: number, email: string, category: string, status = "pending") => (await query<{ id: number }>(
    "INSERT INTO signatures(name,email,email_hash,category,text_version,consent_at,status,created_at,token_hash,token_expires_at) VALUES($1,$2,$3,$4,'v',$5,$6,$7,$8,'2099-01-01T00:00:00Z') RETURNING id", [`Pessoa ${n}`, email, hmac(dedupEmail(email)), category, criada, status, criada, `tokenvelho${n}`])).rows[0].id;
  try {
    const serv = await mk(1, "maria@unir.bf", "servidor");
    const apo = await mk(2, "joao@gmial.com", "apoiador");
    const ocupado = await mk(3, "ocupado@gmail.com", "apoiador");
    const conf = await mk(4, "confirmado@unir.br", "servidor", "confirmed");
    // regras de recusa
    assert.equal(((await corrigirEmail(serv, "sem arroba")) as any).ok, false);
    assert.equal((await corrigirEmail(serv, "maria@gmail.com") as any).ok, false); // servidor precisa de e-mail institucional
    assert.equal((await corrigirEmail(apo, "joao@gmail.com") as any).ok, true);
    assert.equal((await corrigirEmail(ocupado, "joao@gmail.com") as any).erro, "Já existe outro cadastro com este e-mail.");
    await suppress("devolvido@gmail.com", "bounce", "x");
    assert.match((await corrigirEmail(ocupado, "devolvido@gmail.com") as any).erro, /supress/);
    assert.equal((await corrigirEmail(conf, "outro@unir.br") as any).ok, false); // só pendente
    // sucesso: troca e-mail, hash e selo; não mexe nas datas
    const a = (await query<any>("SELECT email,email_hash,email_domain_kind,created_at,seq,verify_code FROM signatures WHERE id=$1", [apo])).rows[0];
    assert.equal(a.email, "joao@gmail.com"); assert.equal(a.email_hash, hmac(dedupEmail("joao@gmail.com"))); assert.equal(a.created_at, criada);
    // aceitar sugestão (domínio sem servidor → mais parecido conhecido)
    const s = await aceitarSugestao(serv) as any;
    assert.deepEqual([s.ok, s.email], [true, "maria@unir.br"]);
    const b = (await query<any>("SELECT email,email_domain_kind,created_at FROM signatures WHERE id=$1", [serv])).rows[0];
    assert.equal(b.email, "maria@unir.br"); assert.ok(b.email_domain_kind); assert.equal(b.created_at, criada);
    assert.equal(((await aceitarSugestao(serv)) as any).ok, false); // já corrigido: sem nova sugestão
    // reenviar: token novo, e-mail na caixa de saída, data original no texto, só pendente, limite de 10 min
    const r = await reenviarConfirmacao(serv) as any;
    assert.equal(r.ok, true); assert.equal(r.envio, "sent");
    const t = (await query<any>("SELECT token_hash,token_expires_at,created_at,status FROM signatures WHERE id=$1", [serv])).rows[0];
    assert.notEqual(t.token_hash, "tokenvelho1"); assert.notEqual(t.token_hash, sha256("tokenvelho1")); assert.equal(t.created_at, criada); assert.equal(t.status, "pending");
    await new Promise((x) => setTimeout(x, 400));
    const mails = readdirSync(dir); assert.equal(mails.length, 1);
    const m = JSON.parse(require("node:fs").readFileSync(join(dir, mails[0]), "utf8")); assert.equal(m.to, "maria@unir.br"); assert.match(m.text, /02\/11\/2026/); // data/hora ORIGINAL do cadastro
    assert.match(((await reenviarConfirmacao(serv)) as any).erro, /10 minutos/);
    assert.equal(((await reenviarConfirmacao(conf)) as any).ok, false);
    // auditoria
    const aud = (await query<any>("SELECT event FROM audit_log ORDER BY id")).rows.map((x: any) => x.event);
    assert.ok(aud.includes("email_corrigido") && aud.includes("confirmacao_reenviada"), aud.join(","));
  } finally { _setMxResolverForTests(null); }
});

test("rotas de correção e reenvio registram o usuário autenticado e preservam evidências da assinatura", async () => {
  const db = await import("./db"); await db._openForTests("t_assinaturas_email_actor");
  const { NextRequest } = await import("next/server");
  const U = await import("./admin-users");
  const { ADMIN_COOKIE } = await import("./admin");
  const { _setMxResolverForTests } = await import("./email-check");
  const { hmac } = await import("./security");
  const { dedupEmail } = await import("./email-check");
  const { PATCH } = await import("../app/api/admin/assinaturas/[id]/email/route");
  const { POST: resend } = await import("../app/api/admin/assinaturas/[id]/reenviar/route");
  const { POST: bulk } = await import("../app/api/admin/assinaturas/lote/route");
  delete process.env.PREVIEW_MODE; delete process.env.ADMIN_NO_PASSWORD;
  process.env.MAIL_OUTBOX_DIR = mkdtempSync(join(tmpdir(), "actor-email-"));
  _setMxResolverForTests(async domain => domain === "unir.bf" ? "none" : "ok");
  try {
    const user = await U.criarUsuario({ email:"operator@example.org", nome:"Operadora Teste", nivel:"edicao", senha:"Uma-Senha-Forte-2026" });
    assert.ok(user.ok);
    const { token } = await U.abrirSessao(user.usuario.id,"127.0.0.1");
    const request = (path:string,method:string,body:unknown,authenticated=true) => new NextRequest(`http://localhost${path}`,{method,headers:{host:"localhost",origin:"http://localhost",cookie:authenticated?`${ADMIN_COOKIE}=${token}`:"","content-type":"application/json","x-forwarded-for":"127.0.0.1"},body:JSON.stringify(body)});
    const make = async (email:string,n:number) => (await db.query<{id:number}>("INSERT INTO signatures(name,email,email_hash,cpf_hash,category,text_version,consent_at,created_at,seq,verify_code) VALUES('Pessoa Fictícia',$1,$2,$3,'servidor','fixture','2026-10-01T10:00:00Z','2026-10-01T10:00:00Z',$4,$5) RETURNING id",[email,hmac(dedupEmail(email)),`hash-cpf-${n}`,100+n,`code-${n}`])).rows[0].id;
    const id=await make("teste-actor@unir.bf",1);
    const proof=async()=> (await db.query("SELECT id,name,cpf_hash,consent_at,created_at,confirmed_at,seq,verify_code FROM signatures WHERE id=$1",[id])).rows[0];
    const before=await proof();
    const version=(await db.query("SELECT xmin::text version FROM signatures WHERE id=$1",[id])).rows[0].version;
    assert.equal((await PATCH(request(`/api/admin/assinaturas/${id}/email`,"PATCH",{email:"teste-actor@unir.br",version}),{params:{id:String(id)}})).status,200);
    assert.equal((await resend(request(`/api/admin/assinaturas/${id}/reenviar`,"POST",{}),{params:{id:String(id)}})).status,200);
    const suggested=await make("teste-suggestion@unir.bf",2);
    const suggestedVersion=(await db.query("SELECT xmin::text version FROM signatures WHERE id=$1",[suggested])).rows[0].version;
    assert.equal((await bulk(request("/api/admin/assinaturas/lote","POST",{acao:"sugestoes",ids:[suggested],versions:{[suggested]:suggestedVersion}}))).status,200);
    const batch=await make("teste-bulk@unir.br",3);
    assert.equal((await bulk(request("/api/admin/assinaturas/lote","POST",{acao:"reenviar",ids:[batch]}))).status,200);
    const audit=(await db.query<{data:string}>("SELECT data FROM audit_log WHERE event IN ('email_corrigido','confirmacao_reenviada') ORDER BY id")).rows;
    assert.equal(audit.length,4);assert.ok(audit.every(row=>JSON.parse(row.data).por===user.usuario.email));
    assert.deepEqual(await proof(),before);
    assert.equal((await PATCH(request(`/api/admin/assinaturas/${id}/email`,"PATCH",{email:"outra@unir.br"},false),{params:{id:String(id)}})).status,401);
    assert.equal((await db.query("SELECT email FROM signatures WHERE id=$1",[id])).rows[0].email,"teste-actor@unir.br");
  } finally { _setMxResolverForTests(null); await db._closeDbForTests(); }
});
