import { makeTicket } from "./identity";
import test from "node:test";
import assert from "node:assert/strict";
import { rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _setMxResolverForTests } from "./email-check";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
process.env.MAIL_OUTBOX_DIR = join(tmpdir(), `peticao-outbox-foreign-${process.pid}`);
_setMxResolverForTests(async () => "ok");

const form = (o: object = {}) => ({ name: "Anna Müller", email: "anna@uni-heidelberg.de", category: "estrangeiro", country: "DE", university: "Universität Heidelberg", consent: true, locale: "de", ...o });
const ctx = { ip: "5.5.5.5" };
const outboxCount = (d: string) => { try { return readdirSync(d).length; } catch { return 0; } };

test("estrangeiro: base de universidades, país, domínio listado, fora da lista e bloqueios", async () => {
  const dbmod = await import("./db");
  await dbmod._openForTests("t_foreign");
  const { handleSign } = await import("./sign-flow");
  const wu = await import("./world-universities");
  const out = process.env.MAIL_OUTBOX_DIR!;
  const rows = async () => (await dbmod.query<{ n: number }>("SELECT COUNT(*)::int n FROM signatures")).rows[0].n;

  const n = await wu.ensureWorldUniversities();
  assert.ok(n > 10000); // base carregada (Hipo)
  assert.equal((await wu.searchUniversities("DE", "heidelberg")).some((u) => u.domain === "uni-heidelberg.de"), true);
  assert.equal((await wu.searchUniversities("DE", "HEIDELBERG")).length > 0, true); // caixa
  assert.equal((await wu.searchUniversities("DE", "munchen")).length > 0, true); // sem acento (München)
  assert.equal((await wu.searchUniversities("BR", "")).length, 40); // limite
  assert.deepEqual(await wu.searchUniversities("XX!", "a"), []); // país inválido

  // 1) listada e do mesmo país → grava e envia
  const ok = await handleSign(form(), ctx, null);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(outboxCount(out), 1);
  const row = (await dbmod.query<any>("SELECT category, cpf_hash, country, university, university_domain, domain_check, identity_method, locale, email_domain_kind FROM signatures")).rows[0];
  assert.deepEqual(row, { category: "estrangeiro", cpf_hash: null, country: "DE", university: "Universität Heidelberg", university_domain: "uni-heidelberg.de", domain_check: "list", identity_method: "universidade_estrangeira", locale: "de", email_domain_kind: null });
  // subdomínio de departamento também vale
  assert.equal((await handleSign(form({ name: "Karl Beispiel", email: "karl@math.uni-heidelberg.de" }), ctx, null)).status, 200);
  // quem ainda não confirmou e assina de novo: o cadastro é substituído (continua 1 linha) e a confirmação é reenviada
  const before = outboxCount(out);
  assert.equal((await handleSign(form({ name: "Anna Müller" }), ctx, null)).status, 200);
  assert.equal(outboxCount(out), before + 1);
  assert.equal((await dbmod.query("SELECT 1 FROM signatures WHERE email='anna@uni-heidelberg.de'")).rowCount, 1);
  // quem JÁ confirmou: resposta idêntica, nada novo (não revela quem consta na lista)
  await dbmod.query("UPDATE signatures SET status='confirmed', confirmed_at=$1 WHERE email='anna@uni-heidelberg.de'", [new Date().toISOString()]);
  const afterConfirm = outboxCount(out);
  assert.equal((await handleSign(form({ name: "Anna Müller" }), ctx, null)).status, 200);
  assert.equal(outboxCount(out), afterConfirm);

  // 2) domínio de outro país → recusa, nada gravado nem enviado
  const sent = outboxCount(out), total = await rows();
  const mis = await handleSign(form({ name: "Pierre Dupont", email: "pierre@uni-heidelberg.de", country: "FR", university: "Sorbonne" }), ctx, null);
  assert.deepEqual([mis.status, (mis.json as any).errors.email, (mis.json as any).detail], [422, "university_country_mismatch", "DE"]);
  // 3) e-mail pessoal
  const gm = await handleSign(form({ name: "Eva Teste", email: "eva@gmail.com" }), ctx, null);
  assert.equal((gm.json as any).errors.email, "not_university_email");
  assert.equal(await rows(), total); assert.equal(outboxCount(out), sent);

  // 4) fora da lista: checagem pela internet (simulada)
  const probeOk = async () => ({ ok: true, reason: "ok" as const });
  const w = await handleSign(form({ name: "Lars Nord", email: "lars@hogskolan-exemplo.se", country: "SE", university: "Högskolan Exemplo" }), ctx, null, probeOk);
  assert.equal(w.status, 200);
  assert.equal((await dbmod.query<any>("SELECT domain_check FROM signatures WHERE email='lars@hogskolan-exemplo.se'")).rows[0].domain_check, "web");
  const pend = (await dbmod.query<any>("SELECT kind,status,country,source FROM institutional_domains WHERE domain='hogskolan-exemplo.se'")).rows[0];
  assert.deepEqual(pend, { kind: "universidade-estrangeira", status: "pending", country: "SE", source: "web" }); // vai para a curadoria
  // …não vira selo de órgão brasileiro
  const inst = await import("./institutional");
  assert.equal(await inst.institutionalKind("x@hogskolan-exemplo.se"), null);
  // domínio que não existe / não é acadêmico / rede fora do ar
  const t1 = outboxCount(out), t2 = await rows();
  const bad = await handleSign(form({ name: "Falso Dom", email: "x@dominio-falso-xyz.com", country: "US", university: "Fake U" }), ctx, null, async () => ({ ok: false, reason: "no_dns" as const }));
  assert.deepEqual([bad.status, (bad.json as any).errors.email], [422, "not_university_email"]);
  const biz = await handleSign(form({ name: "Loja Sapatos", email: "x@sapatos-exemplo.com", country: "US", university: "Fake U" }), ctx, null, async () => ({ ok: false, reason: "not_academic" as const }));
  assert.equal((biz.json as any).errors.email, "not_university_email");
  const net = await handleSign(form({ name: "Sem Rede", email: "x@semrede-exemplo.edu", country: "US", university: "Fake U" }), ctx, null, async () => ({ ok: false, reason: "network" as const }));
  assert.deepEqual([net.status, (net.json as any).errorCode], [503, "domain_unavailable"]);
  assert.equal(await rows(), t2); assert.equal(outboxCount(out), t1); // nada gravado, nenhum e-mail enviado
  assert.equal((await dbmod.query("SELECT 1 FROM institutional_domains WHERE domain IN ('dominio-falso-xyz.com','sapatos-exemplo.com')")).rowCount, 0);
  // aprovado na curadoria: passa sem nova checagem; rejeitado: nunca
  await dbmod.query("UPDATE institutional_domains SET status='approved' WHERE domain='hogskolan-exemplo.se'");
  const cur = await handleSign(form({ name: "Greta Nord", email: "greta@hogskolan-exemplo.se", country: "SE", university: "Högskolan Exemplo" }), ctx, null, async () => { throw new Error("não deveria checar de novo"); });
  assert.equal(cur.status, 200);
  await dbmod.query("INSERT INTO institutional_domains(domain,kind,status,country,source) VALUES('rejeitada.example','universidade-estrangeira','rejected','US','manual')");
  assert.equal(((await handleSign(form({ name: "Rej Eitada", email: "r@rejeitada.example", country: "US", university: "R U" }), ctx, null, probeOk)).json as any).errors.email, "not_university_email");

  // domínio brasileiro no formulário de estrangeiro: recusado (usar Servidor ou Apoiador) e registrado
  const t3 = await rows(), o3 = outboxCount(out);
  for (const e of ["aluno@estudante.ifto.edu.br", "x@unir.br", "x@qualquer.com.br", "x@ministerio.gov.br"]) {
    const r = await handleSign(form({ name: "Falso Brasil", email: e, country: "NG", university: "Abia State Polytechnic" }), ctx, null, probeOk);
    assert.deepEqual([r.status, (r.json as any).errors.email], [422, "foreign_brazilian_email"], e);
  }
  assert.equal(await rows(), t3); assert.equal(outboxCount(out), o3);
  const logged = (await dbmod.query<any>("SELECT detail FROM request_log WHERE kind='foreign_rejected' ORDER BY id")).rows.map((x) => x.detail);
  assert.ok(logged.some((d: string) => /estudante\.ifto\.edu\.br \| país NG \| foreign_brazilian_email/.test(d)), `registro da recusa: ${logged.join(" / ")}`);
  assert.ok(logged.some((d: string) => /not_university_email/.test(d)), "recusas por universidade inválida também ficam registradas");

  // 5) validações de formulário
  assert.equal(((await handleSign(form({ country: "BR" }), ctx, null)).json as any).errors.country, "country_invalid");
  assert.equal(((await handleSign(form({ university: "" }), ctx, null)).json as any).errors.university, "university_required");
  assert.equal(await dbmod.query("SELECT 1 FROM identity_attempts").then((r) => r.rowCount), 0); // sem janela de identidade nem CPF

  // brasileiros seguem funcionando
  const br = await handleSign({ name: "Maria da Silva", email: "maria@unir.br", cpf: "529.982.247-25", category: "servidor", institution: "UNIR", role: "docente", campus: "Ji-Paraná", regionDeclared: true, consent: true }, ctx, null);
  assert.equal(br.status, 200);
  const b = (await dbmod.query<any>("SELECT ifes_acronym, campus, campus_ibge, campus_listed, region_declared, region_validated, region_criteria, country, institution_listed FROM signatures WHERE email='maria@unir.br'")).rows[0];
  assert.deepEqual(b, { ifes_acronym: "UNIR", campus: "Ji-Paraná", campus_ibge: 1100122, campus_listed: true, region_declared: true, region_validated: true, region_criteria: "amazonia_legal", country: "BR", institution_listed: true });
  const ap = await handleSign({ name: "João Pereira", email: "joao.pereira@gmail.com", cpf: "111.444.777-35", category: "apoiador", uf: "ro", city: "ji parana", consent: true, ticket: makeTicket("11144477735", "joao.pereira@gmail.com"), identity: { method: "nascimento", value: "01/02/1990" } }, ctx, { name: "synthetic", lookup: async () => ({ nome: "JOÃO PEREIRA", nasc: "01/02/1990", mae: null }) });
  assert.equal(ap.status, 200);
  assert.deepEqual((await dbmod.query<any>("SELECT city, uf, city_ibge FROM signatures WHERE email='joao.pereira@gmail.com'")).rows[0], { city: "Ji-Paraná", uf: "RO", city_ibge: 1100122 });

  await dbmod._closeDbForTests();
  rmSync(out, { recursive: true, force: true });
});
