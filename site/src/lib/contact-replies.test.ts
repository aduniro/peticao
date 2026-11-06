import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev"; delete process.env.MAIL_PROVIDERS;
process.env.APP_URL = "https://sancionaintegral.org";

const dom = "@respostas-teste.example";
const POR = { userId: 1, email: "dona@exemplo.org" };
const ENT = { assunto: "Re: sua dúvida sobre a petição", corpo: "Obrigado pelo contato.\n\nA sua assinatura foi confirmada." };
const um = async () => { const dbmod = await import("./db"); await dbmod._openForTests("t_contact_replies"); return { dbmod, C: await import("./contact-replies"), H: await import("./security") }; };

async function cenario(c: Awaited<ReturnType<typeof um>>, comCodigo: boolean) {
  const msg = (await c.dbmod.query<{ id: number }>("INSERT INTO contact_messages(name,email,kind,message) VALUES('Maria Souza',$1,'duvida','Não recebi o e-mail de confirmação da petição') RETURNING id", ["maria" + dom])).rows[0].id;
  if (comCodigo) {
    const sig = (await c.dbmod.query<{ id: number }>("INSERT INTO signatures(name,email,email_hash,category,text_version,consent_at,status,created_at,confirmed_at,token_hash,token_expires_at) VALUES('Maria Souza',$1,$2,'apoiador','v','2026-11-04T10:00:00Z','confirmed','2026-11-04T10:00:00Z','2026-11-04T10:05:00Z','x','2026-11-05T00:00:00Z') RETURNING id", ["maria" + dom, c.H.hmac("maria")])).rows[0].id;
    await c.dbmod.query("INSERT INTO referrers(code, signature_id) VALUES('MARIA1',$1)", [sig]);
  }
  const enviados: any[] = [], agendados: any[] = [];
  const enviar = async (m: any) => { enviados.push(m); return "sent" as const; };
  const agendar = async (m: any, kind: string) => { agendados.push({ m, kind }); return 1; };
  return { msg, enviados, agendados, enviar, agendar };
}

test("respostas: prévia com dois e-mails (texto puro + card com QR pessoal) e selo; sem código, só o texto", async () => {
  const c = await um();
  try {
    const a = await cenario(c, true);
    const p = (await c.C.montarPrevia(a.msg, ENT, 1))!;
    assert.equal(p.para, "maria" + dom); assert.equal(p.codigoPessoal, "MARIA1");
    assert.match(p.texto.texto, /^Olá, Maria,\n\nObrigado pelo contato\.\n\nA sua assinatura foi confirmada\.\n\nUm abraço,\nADUNIR · ANDES-SN\nPetição pela sanção integral do PLV nº 12\/2026$/);
    assert.ok(p.card && p.card.html.includes("/api/cartaz/MARIA1.png") && p.card.html.includes("sancionaintegral.org") && p.card.assunto === c.C.ASSUNTO_CARD);
    assert.ok(!p.texto.texto.includes("<")); // primeiro e-mail é só texto
    assert.equal((await c.C.montarPrevia(a.msg, ENT, 1))!.selo, p.selo); // mesmo texto, mesmo selo
    assert.notEqual((await c.C.montarPrevia(a.msg, { ...ENT, corpo: ENT.corpo + " x" }, 1))!.selo, p.selo);
    assert.equal(await c.C.montarPrevia(99999, ENT, 1), null);
    await c.dbmod.query("DELETE FROM referrers");
    const sem = (await c.C.montarPrevia(a.msg, ENT, 1))!;
    assert.equal(sem.card, null); assert.equal(sem.codigoPessoal, null);
    assert.equal(c.C.validarEntrada({ assunto: "ab", corpo: "x".repeat(20) }).ok, false);
    assert.equal(c.C.validarEntrada({ assunto: "Assunto ok", corpo: "curto" }).ok, false);
  } finally { await c.dbmod._closeDbForTests(); }
});

test("respostas: envia o texto agora e agenda o card; Cco e Reply-To; não duplica; nova rodada só de propósito", async () => {
  const c = await um();
  try {
    const a = await cenario(c, true);
    const selo = (await c.C.montarPrevia(a.msg, ENT, 1))!.selo;
    assert.deepEqual(await c.C.enviarResposta({ contactId: a.msg, entrada: ENT, selo: "errado", por: POR, enviar: a.enviar as never, agendar: a.agendar as never }), { ok: false, erro: "selo" });
    assert.equal(a.enviados.length, 0);
    const r = await c.C.enviarResposta({ contactId: a.msg, entrada: ENT, selo, por: POR, enviar: a.enviar as never, agendar: a.agendar as never });
    assert.deepEqual(r, { ok: true, texto: "enviado", card: "agendado", rodada: 1 });
    assert.equal(a.enviados.length, 1); assert.equal(a.enviados[0].to, "maria" + dom); assert.equal(a.enviados[0].html, undefined);
    assert.ok(a.enviados[0].bcc.length >= 1 && a.enviados[0].replyTo);
    assert.equal(a.agendados.length, 1); assert.equal(a.agendados[0].m.subject, c.C.ASSUNTO_CARD); assert.ok(a.agendados[0].m.html.includes("MARIA1"));
    assert.deepEqual((await c.dbmod.query("SELECT versao, ok, agendada FROM contact_replies ORDER BY id")).rows, [{ versao: "texto", ok: true, agendada: false }, { versao: "card", ok: true, agendada: true }]);
    // repetir: recusado, nada novo sai
    assert.deepEqual(await c.C.enviarResposta({ contactId: a.msg, entrada: ENT, selo, por: POR, enviar: a.enviar as never, agendar: a.agendar as never }), { ok: false, erro: "ja_respondida" });
    assert.equal(a.enviados.length, 1);
    // nova rodada explícita (selo da rodada 2)
    const selo2 = (await c.C.montarPrevia(a.msg, ENT, 2))!.selo;
    const r2 = await c.C.enviarResposta({ contactId: a.msg, entrada: ENT, selo: selo2, nova: true, por: POR, enviar: a.enviar as never, agendar: a.agendar as never });
    assert.ok(r2.ok && (r2 as any).rodada === 2); assert.equal(a.enviados.length, 2);
    const h = (await c.C.historicoDeRespostas([a.msg]))[a.msg];
    assert.equal(h.length, 4); assert.ok(h.every((x) => x.por === POR.email));
  } finally { await c.dbmod._closeDbForTests(); }
});

test("respostas: sem código pessoal não agenda card; falha de envio registra o erro e permite tentar de novo", async () => {
  const c = await um();
  try {
    const a = await cenario(c, false);
    const selo = (await c.C.montarPrevia(a.msg, ENT, 1))!.selo;
    const falha = async () => { throw new Error("provedor fora do ar"); };
    const r = await c.C.enviarResposta({ contactId: a.msg, entrada: ENT, selo, por: POR, enviar: falha as never, agendar: a.agendar as never });
    assert.equal(r.ok, false); assert.equal((r as any).erro, "falhou"); assert.equal(a.agendados.length, 0);
    assert.deepEqual((await c.dbmod.query("SELECT versao, ok, erro FROM contact_replies")).rows, [{ versao: "texto", ok: false, erro: "provedor fora do ar" }]);
    // logo depois ainda vale como "em andamento"; passados 2 minutos, libera nova tentativa
    assert.equal(((await c.C.enviarResposta({ contactId: a.msg, entrada: ENT, selo, por: POR, enviar: a.enviar as never, agendar: a.agendar as never })) as any).erro, "ja_respondida");
    await c.dbmod.query("UPDATE contact_replies SET criada_em = now() - interval '3 minutes'");
    const ok = await c.C.enviarResposta({ contactId: a.msg, entrada: ENT, selo, por: POR, enviar: a.enviar as never, agendar: a.agendar as never });
    assert.deepEqual(ok, { ok: true, texto: "enviado", card: "sem-codigo", rodada: 1 });
    assert.equal(a.agendados.length, 0); assert.equal(a.enviados.length, 1);
  } finally { await c.dbmod._closeDbForTests(); }
});

test("respostas: duas execuções ao mesmo tempo enviam uma só vez; guarda de teste barra endereço proibido", async () => {
  const c = await um();
  try {
    const a = await cenario(c, false);
    const selo = (await c.C.montarPrevia(a.msg, ENT, 1))!.selo;
    const [x, y] = await Promise.all([1, 2].map(() => c.C.enviarResposta({ contactId: a.msg, entrada: ENT, selo, por: POR, enviar: a.enviar as never, agendar: a.agendar as never })));
    assert.equal([x, y].filter((r) => r.ok).length, 1); assert.equal(a.enviados.length, 1);
    // endereço de teste proibido: o envio real (sem injeção) é recusado pela guarda central
    const proibido = (await c.dbmod.query<{ id: number }>("INSERT INTO contact_messages(name,email,kind,message) VALUES('Teste','adunir.andes@gmail.com','outro','mensagem de teste longa o bastante') RETURNING id")).rows[0].id;
    const s2 = (await c.C.montarPrevia(proibido, ENT, 1))!.selo;
    const r = await c.C.enviarResposta({ contactId: proibido, entrada: ENT, selo: s2, por: POR });
    assert.equal(r.ok, false); assert.equal((r as any).erro, "falhou");
  } finally { await c.dbmod._closeDbForTests(); }
});

test("rota de resposta: nível total + confirmação extra", async () => {
  const { readFileSync } = await import("node:fs"); const { join } = await import("node:path");
  const api = readFileSync(join(__dirname, "../app/api/admin/contato/responder/route.ts"), "utf8");
  assert.match(api, /exigirNivel\(req, "total", \d+, \{ stepup: true \}\)/);
});
