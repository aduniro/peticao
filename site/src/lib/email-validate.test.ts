import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";

test("validação do e-mail por categoria (servidor x apoiador), sem efeitos colaterais", async () => {
  const dbmod = await import("./db"); await dbmod._openForTests("t_email_validate");
  const { validateEmailField } = await import("./email-validate");
  const { _setMxResolverForTests } = await import("./email-check");
  const semMx = new Set(["ufpel.edu.gov", "gmial.com", "ufpa.edu.br", "ifro.edu.be"]);
  _setMxResolverForTests(async (d) => (semMx.has(d) ? "none" : "ok"));
  const before = ((await dbmod.query("SELECT count(*)::int n FROM institutional_domains")).rows[0] as any).n;
  try {
    // servidor
    assert.deepEqual(await validateEmailField("maria@unir.br", "servidor"), { ok: true });
    assert.deepEqual(await validateEmailField("maria@gmail.com", "servidor"), { ok: false, code: "server_email_not_institutional" });
    const semDetalhe = (v: unknown) => { const { detail: _d, ...r } = v as Record<string, unknown>; return r; };
    const v1 = await validateEmailField("maria@ufpel.edu.gov", "servidor");
    assert.deepEqual(semDetalhe(v1), { ok: false, code: "email_institutional_invalid", suggest: "maria@ufpel.edu.br" });
    assert.deepEqual((v1 as any).detail, { problema: "parecido", errado: "ufpel.edu.gov", correto: "ufpel.edu.br", sugestao: "maria@ufpel.edu.br", exemplo: "maria@ufpel.edu.br", bloqueia: false });
    assert.deepEqual(semDetalhe(await validateEmailField("catia@ufpa.edu.br", "servidor")), { ok: false, code: "email_institutional_invalid", suggest: "catia@ufpa.br" }); // domínio da lista, mas sem servidor de e-mail
    assert.equal(((await validateEmailField("x@semcara-de-instituicao.org", "servidor")) as any).code, "server_email_not_institutional");
    const esp = (await validateEmailField("com acento@unir.br", "servidor")) as any; // espaço: agora diz o que está errado e sugere sem o espaço
    assert.equal(esp.code, "email_typo"); assert.equal(esp.detail.problema, "espaco"); assert.equal(esp.suggest, "comacento@unir.br");
    assert.equal(((await validateEmailField("açaí@unir.br", "servidor")) as any).code, "email_invalid"); // sem diagnóstico possível: continua o aviso genérico
    // apoiador
    const vg = (await validateEmailField("joao@gmial.com", "apoiador")) as any; // o domínio errado até recebe e-mail, mas é erro quase certo de "gmail.com": bloqueia com explicação
    assert.equal(vg.ok, false); assert.equal(vg.code, "email_typo"); assert.equal(vg.suggest, "joao@gmail.com");
    assert.deepEqual(vg.detail, { problema: "provedor", errado: "gmial.com", correto: "gmail.com", sugestao: "joao@gmail.com", exemplo: "joao@gmail.com", bloqueia: true });
    for (const typo of ["joao@gmail.con", "joao@hotmial.com", "joao@gmail"]) assert.equal(((await validateEmailField(typo, "apoiador")) as any).code, "email_typo", typo);
    const br = (await validateEmailField("joao@gmail.com.br", "apoiador")) as any; // não existe gmail.com.br: parece o provedor certo com final errado
    assert.equal(br.ok, false); assert.equal(br.code, "email_provider_invalid"); assert.equal(br.suggest, "joao@gmail.com"); assert.equal(br.detail.correto, "gmail.com");
    assert.deepEqual(await validateEmailField("joao@unir.br", "apoiador"), { ok: false, code: "apoiador_institutional_email" });
    assert.deepEqual(await validateEmailField("joao@gmail.com", "apoiador"), { ok: true });
    assert.deepEqual(await validateEmailField("joao@empresa-xyz.com.br", "apoiador"), { ok: true });
    // nenhuma gravação (fila de revisão de domínios intacta)
    assert.equal(((await dbmod.query("SELECT count(*)::int n FROM institutional_domains")).rows[0] as any).n, before);
  } finally { _setMxResolverForTests(null); }
});

test("política central: domínios do banco (inclusive inseridos à mão) entram nas sugestões; pendentes e rejeitados não", async () => {
  const dbmod = await import("./db"); await dbmod._openForTests("t_email_politica");
  const { validateEmailField } = await import("./email-validate");
  const { dominiosConhecidos } = await import("./email-sugestao");
  const { decideDomain, notePendingDomain } = await import("./institutional");
  const { _setMxResolverForTests } = await import("./email-check");
  _setMxResolverForTests(async () => "ok");
  try {
    // ifc.edu.br já vem da semente das IFES (IF Catarinense) e aparece nas sugestões
    assert.ok((await dominiosConhecidos()).includes("ifc.edu.br"));
    const ifc = (await validateEmailField("rita@ifc.edu.bt", "servidor")) as any;
    assert.equal(ifc.code, "email_institutional_invalid"); assert.equal(ifc.suggest, "rita@ifc.edu.br"); assert.equal(ifc.detail.correto, "ifc.edu.br");
    assert.deepEqual(await validateEmailField("rita@ifc.edu.br", "servidor"), { ok: true });

    // o cache de sugestões é preenchido ANTES de a curadoria aprovar o domínio novo: a decisão precisa limpá-lo
    assert.ok(!(await dominiosConhecidos()).includes("faculdade-teste.org.br"));
    await decideDomain("faculdade-teste.org.br", "approved", { kind: "outro", institution: "Faculdade Teste", by: "teste" });
    assert.ok((await dominiosConhecidos()).includes("faculdade-teste.org.br"));
    const man = (await validateEmailField("rita@faculdade-teste.org.bt", "servidor")) as any;
    assert.equal(man.suggest, "rita@faculdade-teste.org.br");
    const apo = (await validateEmailField("rita@faculdade-teste.org.bt", "apoiador")) as any; // apoiador: domínio recebe e-mail, então só sugere
    assert.equal(apo.ok, true); assert.equal(apo.soft.correto, "faculdade-teste.org.br");

    // pendente (visitante digitou) e rejeitado nunca são sugeridos
    await notePendingDomain("pendente-teste.org.br");
    await decideDomain("rejeitado-teste.org.br", "rejected", { by: "teste" });
    const lista = await dominiosConhecidos();
    assert.ok(!lista.includes("pendente-teste.org.br")); assert.ok(!lista.includes("rejeitado-teste.org.br"));
  } finally { _setMxResolverForTests(null); await dbmod._closeDbForTests(); }
});

test("semeadura das IFES: promove domínio pendente a aprovado e respeita decisão manual", async () => {
  const dbmod = await import("./db"); await dbmod._openForTests("t_seed_ifes");
  try {
    // visitante já tinha digitado ifc.edu.br e ficou pendente; um cadastro seu ainda sem classificação; furg.br foi REJEITADO à mão
    await dbmod.query("UPDATE institutional_domains SET kind='outro', institution=NULL, acronym=NULL, source='visitante', status='pending', decided_by=NULL WHERE domain='ifc.edu.br'");
    await dbmod.query("UPDATE institutional_domains SET status='rejected', decided_by='admin' WHERE domain='furg.br'");
    await dbmod.query(`INSERT INTO signatures(name,email,email_hash,category,text_version,consent_at) VALUES('Pessoa Ifc','pessoa@ifc.edu.br','h-ifc-seed','apoiador','v','2026-11-01T10:00:00Z')`);
    await dbmod.seedIfesDomains();
    const r = (await dbmod.query<{ domain: string; status: string; kind: string; institution: string }>("SELECT domain,status,kind,institution FROM institutional_domains WHERE domain IN ('ifc.edu.br','furg.br') ORDER BY domain")).rows;
    assert.deepEqual(r.map((x) => `${x.domain}:${x.status}:${x.kind}`), ["furg.br:rejected:outro".replace("outro", r[0].kind), "ifc.edu.br:approved:ifes"]); // furg.br continua rejeitado
    assert.match(r[1].institution, /Catarinense/);
    const sig = (await dbmod.query<{ k: string; d: string }>("SELECT email_domain_kind k, email_domain d FROM signatures WHERE email='pessoa@ifc.edu.br'")).rows[0];
    assert.deepEqual(sig, { k: "ifes", d: "ifc.edu.br" });
    await dbmod.seedIfesDomains(); // idempotente
  } finally { await dbmod._closeDbForTests(); }
});
