import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";

test("código de verificação: formato, aceita traço/minúsculas/O→0, recusa lixo", async () => {
  const { newVerifyCode, parseCode, formatCode, CODE_RE } = await import("./verify-code");
  const codes = new Set(Array.from({ length: 500 }, () => newVerifyCode()));
  assert.equal(codes.size, 500);
  for (const c of codes) assert.match(c, CODE_RE);
  const c = "0A1B2C3D4E";
  assert.equal(formatCode(c), "0A1B2-C3D4E");
  assert.equal(parseCode("0a1b2-c3d4e"), c); assert.equal(parseCode(" 0A1B2 C3D4E "), c);
  assert.equal(parseCode("OA1B2C3D4E"), c); // O vira 0
  assert.equal(parseCode("curto"), null); assert.equal(parseCode("UUUUUUUUUU"), null); assert.equal(parseCode("0A1B2C3D4E5"), null); assert.equal(parseCode(""), null); // U e tamanho errado
  assert.equal(parseCode("'; DROP--"), null); // curto demais; e a consulta é sempre parametrizada
});

test("confirmar: ganha número permanente e código; /verificar mostra só dados públicos; a frase de assinatura muda com a conferência de CPF", async () => {
  const dbmod = await import("./db");
  await dbmod._openForTests("t_verify");
  const { query } = await import("./db");
  const { confirmFull } = await import("./signatures");
  const { lookupSignature } = await import("./verify");
  const { statementLine } = await import("./signature-text");
  const { sha256 } = await import("./security");
  const mk = async (i: number, extra = "") => {
    await query(`INSERT INTO signatures(name,email,email_hash,cpf_hash,category,institution,role,campus,campus_ibge,region_declared,region_validated,text_version,consent_at,status,token_hash,token_expires_at,cpf_name_check,ip)
      VALUES($1,$2,$3,$4,'servidor','UNIR','docente','Ji-Paraná',1100122,true,true,'v1',$5,'pending',$6,$7,$8,'1.2.3.4')`,
      [`Pessoa ${i}`, `p${i}@unir.br`, `eh${i}`, `ch${i}`, new Date().toISOString(), sha256(`tok${i}`), new Date(Date.now() + 3600e3).toISOString(), extra || null]);
  };
  await mk(1, "match"); await mk(2);
  const a = await confirmFull("tok1"); const b = await confirmFull("tok2");
  assert.equal(a.result, "ok"); assert.equal(b.result, "ok");
  const rows = (await query<any>("SELECT seq,verify_code FROM signatures ORDER BY seq")).rows;
  assert.deepEqual(rows.map((r) => r.seq), [1, 2]); assert.ok(rows[0].verify_code && rows[0].verify_code !== rows[1].verify_code);
  const v = await lookupSignature(rows[0].verify_code.toLowerCase());
  assert.equal(v?.name, "Pessoa 1"); assert.equal(v?.seq, 1); assert.equal(v?.lotado, "Ji-Paraná"); assert.equal(v?.role, "docente");
  assert.deepEqual(Object.keys(v!).sort(), ["category", "code", "confirmed_at", "country", "cpf_name_check", "institution", "city", "lotado", "name", "region_validated", "role", "seq", "uf", "university"].sort());
  assert.ok(!JSON.stringify(v).includes("p1@unir.br") && !JSON.stringify(v).includes("ch1")); // sem e-mail nem hash de CPF
  assert.equal(await lookupSignature("ZZZZZZZZZZ"), null);
  assert.equal(await lookupSignature("curto"), null);
  // pendente não é verificável
  await mk(3); await query("UPDATE signatures SET verify_code='PENDENTE00' WHERE name='Pessoa 3'");
  assert.equal(await lookupSignature("PENDENTE00"), null);
  // frases de assinatura: só alega CPF quando o nome conferiu
  const when = "2026-11-03T17:32:10.000Z"; // 14:32:10 em Brasília
  assert.equal(statementLine({ category: "servidor", cpf_name_check: "match", confirmed_at: when }), "Assinado eletronicamente no dia 03/11/2026 às 14:32:10 do horário de Brasília, com verificação de autenticidade do número de CPF.");
  assert.match(statementLine({ category: "apoiador", cpf_name_check: null, confirmed_at: when }), /com confirmação do e-mail\.$/);
  assert.match(statementLine({ category: "estrangeiro", cpf_name_check: null, confirmed_at: when }), /confirmação do e-mail institucional\.$/);
  await dbmod._closeDbForTests();
});
