import test from "node:test";
import assert from "node:assert/strict";
import { rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _setMxResolverForTests } from "./email-check";
import { mockProvider } from "./cpf-check";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
process.env.MAIL_OUTBOX_DIR = join(tmpdir(), `peticao-outbox-flow-${process.pid}`);
process.env.TURNSTILE_SITE_KEY = "";
_setMxResolverForTests(async () => "ok");

function cpfFrom(n9: string): string {
  const d = n9.split("").map(Number);
  for (const len of [9, 10]) { const sum = d.slice(0, len).reduce((a, v, i) => a + v * (len + 1 - i), 0); const r = (sum * 10) % 11; d.push(r === 10 ? 0 : r); }
  return d.join("");
}
const CPF = cpfFrom("200000001");
const provider = mockProvider({ [CPF]: { nome: "MARIA JOSÉ DA SILVA", mae: "ANA MARIA DA CONCEIÇÃO", nasc: "15/08/1985" } });
const form = (extra: object = {}) => ({ name: "Maria José da Silva", email: "maria@gmail.com", cpf: CPF, category: "apoiador", city: "Porto Velho", uf: "RO", consent: true, ...extra });
const ctx = { ip: "9.9.9.9" };
const outboxCount = (dir: string) => { try { return readdirSync(dir).length; } catch { return 0; } };

test("identidade: e-mail comum pede confirmação; só envia o e-mail de confirmação se os dados conferirem", async () => {
  const dbmod = await import("./db");
  await dbmod._openForTests("t_flow");
  const { handleSign } = await import("./sign-flow");
  const out = process.env.MAIL_OUTBOX_DIR!;
  const rows = async () => (await dbmod.query<{ n: number }>("SELECT COUNT(*)::int n FROM signatures")).rows[0].n;

  // 1ª etapa: pede identidade, não grava nada, não envia e-mail
  const r1 = await handleSign(form(), ctx, provider);
  assert.equal(r1.status, 200);
  assert.equal(r1.json.identityRequired, true);
  const ticket = r1.json.ticket as string;
  assert.equal(await rows(), 0);
  assert.equal(outboxCount(out), 0);

  // sem ticket válido: recusa (não dá para pular a 1ª etapa nem trocar o CPF)
  assert.equal((await handleSign(form({ identity: { method: "nascimento", value: "15/08/1985" } }), ctx, provider)).status, 400);
  assert.equal((await handleSign(form({ ticket: "1.x", identity: { method: "nascimento", value: "15/08/1985" } }), ctx, provider)).status, 400);
  const other = cpfFrom("200000002");
  assert.equal((await handleSign(form({ cpf: other, ticket, identity: { method: "nascimento", value: "15/08/1985" } }), ctx, mockProvider({ [other]: { nome: "X Y", nasc: "15/08/1985" } }))).status, 400);

  // dados errados: "Os dados não conferem", nada gravado, nenhum e-mail
  const bad = await handleSign(form({ ticket, identity: { method: "nascimento", value: "16/08/1985" } }), ctx, provider);
  assert.equal(bad.status, 422);
  assert.equal(bad.json.identityError, "Os dados não conferem.");
  assert.equal(bad.json.attemptsLeft, 4);
  assert.equal(await rows(), 0);
  assert.equal(outboxCount(out), 0);
  const badMae = await handleSign(form({ ticket, identity: { method: "mae", value: "Ana Maria Conceicao" } }), ctx, provider); // faltou "da"
  assert.equal(badMae.json.identityError, "Os dados não conferem.");

  // entrada malformada não conta como tentativa errada
  const mal = await handleSign(form({ ticket, identity: { method: "nascimento", value: "31/02/1990" } }), ctx, provider);
  assert.match(String(mal.json.identityError), /Confira o dado/);

  // nome da mãe correto, sem acento, caixa diferente: grava e envia o e-mail
  const ok = await handleSign(form({ ticket, identity: { method: "mae", value: "ana maria da conceicao" } }), ctx, provider);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.ok, true);
  assert.equal(await rows(), 1);
  assert.equal(outboxCount(out), 1);
  const row = (await dbmod.query<{ identity_method: string; cpf_name_check: string; email_domain_kind: string | null }>("SELECT identity_method,cpf_name_check,email_domain_kind FROM signatures")).rows[0];
  assert.deepEqual(row, { identity_method: "mae", cpf_name_check: "match", email_domain_kind: null });

  // nenhum dado pessoal do cadastro (nem o digitado) foi gravado em lugar algum do banco
  const dump = JSON.stringify([
    (await dbmod.query("SELECT * FROM signatures")).rows, (await dbmod.query("SELECT * FROM identity_attempts")).rows, (await dbmod.query("SELECT * FROM audit_log")).rows, (await dbmod.query("SELECT * FROM events")).rows,
  ]).toLowerCase();
  for (const secret of ["conceição", "conceicao", "ana maria", "15/08/1985", "1985-08-15"]) assert.equal(dump.includes(secret), false, `vazou: ${secret}`);

  await dbmod._closeDbForTests();
  rmSync(out, { recursive: true, force: true });
});

test("identidade: por nascimento, bloqueio após 5 erros por CPF, e-mail institucional dispensa", async () => {
  const dbmod = await import("./db");
  await dbmod._openForTests("t_flow2");
  const { handleSign } = await import("./sign-flow");
  const out = process.env.MAIL_OUTBOX_DIR!;
  const c2 = cpfFrom("200000003");
  const c3 = cpfFrom("200000004");
  const prov = mockProvider({ [c2]: { nome: "JOAO PEREIRA", mae: "RITA PEREIRA", nasc: "01/02/1990" }, [c3]: { nome: "ANA SOUZA" } });
  const f = (extra: object = {}) => form({ name: "João Pereira", email: "joao@hotmail.com", cpf: c2, ...extra });
  const { ticket } = (await handleSign(f(), ctx, prov)).json as { ticket: string };

  for (let i = 0; i < 5; i++) assert.equal((await handleSign(f({ ticket, identity: { method: "nascimento", value: "02/02/1990" } }), ctx, prov)).status, 422);
  const locked = await handleSign(f({ ticket, identity: { method: "nascimento", value: "01/02/1990" } }), ctx, prov); // mesmo acertando, está bloqueado
  assert.equal(locked.status, 429);
  assert.equal(locked.json.locked, true);

  // institucional (unir.br): não pede mãe/nascimento; só confere o nome com o CPF e já envia
  const inst = await handleSign(form({ name: "Ana Souza", email: "ana@unir.br", cpf: c3, category: "servidor", institution: "UNIR", role: "docente", campus: "Ji-Paraná", regionDeclared: true }), ctx, prov);
  assert.equal(inst.status, 200);
  assert.equal(inst.json.ok, true);
  assert.equal((await dbmod.query<{ m: string }>("SELECT identity_method m FROM signatures WHERE email='ana@unir.br'")).rows[0].m, "email_institucional");

  // domínio de discentes e domínio próprio comum também pedem identidade
  const c4 = cpfFrom("200000005");
  const prov4 = mockProvider({ [c4]: { nome: "BETO LIMA", mae: "ANA LIMA", nasc: "01/02/1990" } });
  assert.equal((await handleSign(form({ name: "Beto Lima", email: "beto@aluno.unir.br", cpf: c4 }), ctx, prov4)).json.identityRequired, true);
  assert.equal((await handleSign(form({ name: "Beto Lima", email: "beto@empresa-do-beto.com.br", cpf: c4 }), ctx, prov4)).json.identityRequired, true);

  // Sem provedor, apoiador não recebe bypass; o modo desligado ainda preserva o fluxo institucional.
  const c5 = cpfFrom("200000006");
  const noProviderSupporter = await handleSign(form({ name: "Cris Dias", email: "cris@gmail.com", cpf: c5 }), ctx, null);
  assert.equal(noProviderSupporter.status, 503);
  assert.equal(noProviderSupporter.json.errorCode, "cpf_check_unavailable");
  const offInstitutional = await handleSign(form({ name: "Cris Dias", email: "cris@unir.br", cpf: c5, category: "servidor", institution: "UNIR", role: "docente", campus: "Ji-Paraná", regionDeclared: true }), ctx, null);
  assert.equal(offInstitutional.json.ok, true);

  await dbmod._closeDbForTests();
  rmSync(out, { recursive: true, force: true });
});

test("identidade: serviço fora do ar e método sem dado cadastral", async () => {
  const dbmod = await import("./db");
  await dbmod._openForTests("t_flow3");
  const { handleSign } = await import("./sign-flow");
  const { ProviderUnavailable } = await import("./cpf-check");
  const out = process.env.MAIL_OUTBOX_DIR!;
  const c6 = cpfFrom("200000007");
  const down = { name: "x", lookup: async () => { throw new ProviderUnavailable("QUOTA_EXCEEDED"); } };
  const f = (extra: object = {}) => form({ name: "Davi Rocha", email: "davi@gmail.com", cpf: c6, ...extra });
  const r = await handleSign(f(), ctx, down);
  assert.equal(r.status, 503); // consulta completa antes de abrir o desafio; nunca libera na dúvida
  assert.equal((await dbmod.query("SELECT 1 FROM signatures")).rowCount, 0);

  const semMae = mockProvider({ [c6]: { nome: "DAVI ROCHA", nasc: "01/02/1990" } });
  const start = await handleSign(f(), ctx, semMae);
  assert.equal(start.json.identityRequired, true);
  const ticket = start.json.ticket as string;
  const m = await handleSign(f({ ticket, identity: { method: "mae", value: "Rita Rocha" } }), ctx, semMae);
  assert.equal(m.json.methodUnavailable, "mae");
  assert.equal((await handleSign(f({ ticket, identity: { method: "nascimento", value: "01/02/1990" } }), ctx, semMae)).status, 200);

  await dbmod._closeDbForTests();
  rmSync(out, { recursive: true, force: true });
});

test("identidade: CPF fora dos dados de teste não gasta tentativa e orienta; liberar CPF bloqueado", async () => {
  const dbmod = await import("./db");
  await dbmod._openForTests("t_flow4");
  const { handleSign } = await import("./sign-flow");
  const { resetIdentityAttempts, MAX_FAILED } = await import("./identity");
  const out = process.env.MAIL_OUTBOX_DIR!;
  const ctx4 = { ip: "7.7.7.7" };
  const real = cpfFrom("200000008");
  const f = (extra: object = {}) => form({ name: "Eva Lima", email: "eva@gmail.com", cpf: real, ...extra });
  const unknown = await handleSign(f(), ctx4, provider); // provider = mock que não conhece o CPF
  assert.equal(unknown.status, 503);
  assert.equal(unknown.json.errorCode, "cpf_mock_unknown");
  assert.equal((await dbmod.query<{ n: number }>("SELECT COUNT(*)::int n FROM identity_attempts")).rows[0].n, 0);
  const live = { name: "cpf-brasil.org", lookup: async () => ({ nome: "EVA LIMA", mae: "RITA LIMA", nasc: "01/02/1990" }) };
  const { ticket } = (await handleSign(f(), ctx4, live)).json as { ticket: string };
  for (let i = 0; i < MAX_FAILED; i++) {
    const r = await handleSign(f({ ticket, identity: { method: "nascimento", value: "02/02/1990" } }), ctx4, live);
    assert.equal(r.status, 422);
    assert.equal(r.json.identityCode, "mismatch");
  }
  assert.equal((await dbmod.query<{ n: number }>("SELECT COUNT(*)::int n FROM identity_attempts WHERE ok=false")).rows[0].n, MAX_FAILED);

  // bloqueio real (provedor de verdade conhece o CPF) e liberação pelo suporte
  assert.equal((await handleSign(f({ ticket, identity: { method: "nascimento", value: "01/02/1990" } }), ctx4, live)).status, 429);
  assert.equal(await resetIdentityAttempts(real), MAX_FAILED + 1); // inclui a verificação inicial bem-sucedida do nome
  assert.equal((await handleSign(f({ ticket, identity: { method: "nascimento", value: "01/02/1990" } }), ctx4, live)).status, 200);

  await dbmod._closeDbForTests();
  rmSync(out, { recursive: true, force: true });
});

test("e-mail com provedor digitado errado: recusa com o que está errado e como digitar; nada é gravado; domínio errado não vai à curadoria", async () => {
  const dbmod = await import("./db");
  await dbmod._openForTests("t_flow_politica");
  const { handleSign } = await import("./sign-flow");
  _setMxResolverForTests(async (d) => (d === "gmail.con" ? "none" : "ok"));
  try {
    for (const [errado, certo] of [["gmail.con", "gmail.com"], ["gmial.com", "gmail.com"], ["hotmial.com", "hotmail.com"]]) {
      const r = await handleSign(form({ email: `maria@${errado}` }), { ip: "8.8.8.8" }, provider); // gmial/hotmial têm servidor de e-mail, mas são erro quase certo
      assert.equal(r.status, 422, errado);
      const j = r.json as any;
      assert.equal(j.errors.email, "email_typo", errado);
      assert.equal(j.suggest, `maria@${certo}`);
      assert.equal(j.fix.problema, "provedor"); assert.equal(j.fix.errado, errado); assert.equal(j.fix.correto, certo); assert.equal(j.fix.exemplo, `maria@${certo}`);
    }
    // servidor com domínio institucional digitado errado: explica, sugere o certo e NÃO suja a fila de curadoria de domínios
    const c = cpfFrom("200000020");
    const s = await handleSign(form({ name: "Ana Souza", email: "ana@unir.bt", cpf: c, category: "servidor", institution: "UNIR", role: "docente", regionDeclared: true, campus: "Porto Velho", campusIbge: 1100205 }), { ip: "8.8.4.4" }, provider);
    const js = s.json as any;
    assert.equal(s.status, 422);
    assert.equal(js.errors?.email, "email_institutional_invalid", JSON.stringify(js)); assert.equal(js.suggest, "ana@unir.br"); assert.equal(js.fix.correto, "unir.br");
    assert.equal((await dbmod.query("SELECT count(*)::int n FROM institutional_domains WHERE domain='unir.bt'")).rows[0].n, 0);
    assert.equal((await dbmod.query("SELECT count(*)::int n FROM signatures")).rows[0].n, 0);
  } finally { _setMxResolverForTests(async () => "ok"); await dbmod._closeDbForTests(); }
});

test("campus fora da região (IFRS Porto Alegre): grava o campus sem lotação na região; declarando a região continua recusado; Ibirubá (exceção) vale como região", async () => {
  const dbmod = await import("./db");
  await dbmod._openForTests("t_flow_campus");
  const { handleSign } = await import("./sign-flow");
  const c = cpfFrom("200000030");
  const prov = mockProvider({ [c]: { nome: "BIA TESTE DOS SANTOS" } });
  const base = { name: "Bia Teste dos Santos", email: "bia@ifrs.edu.br", cpf: c, category: "servidor", institution: "IFRS", role: "tae", campus: "Porto Alegre", campusIbge: 4314902 };
  try {
    const dec = await handleSign(form({ ...base, regionDeclared: true }), { ip: "7.7.7.7" }, prov);
    assert.equal(dec.status, 422); assert.equal((dec.json as any).errors.region, "region_not_eligible");
    assert.equal((await dbmod.query("SELECT count(*)::int n FROM signatures")).rows[0].n, 0);
    const ok = await handleSign(form({ ...base, regionDeclared: false }), { ip: "7.7.7.7" }, prov);
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    const row = (await dbmod.query<any>("SELECT campus, campus_ibge, region_declared, region_validated, region_criteria FROM signatures WHERE email='bia@ifrs.edu.br'")).rows[0];
    assert.equal(row.campus, "Porto Alegre"); assert.equal(Number(row.campus_ibge), 4314902);
    assert.equal(row.region_declared, false); assert.equal(row.region_validated, false); assert.equal(row.region_criteria, null);
    // campus ilegível sem declarar a região não barra a assinatura
    const c2 = cpfFrom("200000031");
    const prov2 = mockProvider({ [c2]: { nome: "CARLA TESTE LIMA" } });
    const nada = await handleSign(form({ ...base, name: "Carla Teste Lima", email: "carla@ifrs.edu.br", cpf: c2, campus: "x", campusIbge: 99999999, regionDeclared: false }), { ip: "7.7.7.8" }, prov2);
    assert.equal(nada.status, 200, JSON.stringify(nada.json));
    // Ibirubá: exceção decidida pela ADUNIR; declarando a região, vale como faixa de fronteira
    const c3 = cpfFrom("200000032");
    const prov3 = mockProvider({ [c3]: { nome: "DANI TESTE ROCHA" } });
    const ib = await handleSign(form({ ...base, name: "Dani Teste Rocha", email: "dani@ifrs.edu.br", cpf: c3, campus: "Ibirubá", campusIbge: 4310009, regionDeclared: true }), { ip: "7.7.7.9" }, prov3);
    assert.equal(ib.status, 200, JSON.stringify(ib.json));
    const r3 = (await dbmod.query<any>("SELECT campus, region_validated, region_criteria FROM signatures WHERE email='dani@ifrs.edu.br'")).rows[0];
    assert.equal(r3.campus, "Ibirubá"); assert.equal(r3.region_validated, true); assert.equal(r3.region_criteria, "faixa_fronteira");
  } finally { await dbmod._closeDbForTests(); }
});
