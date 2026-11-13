import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isValidCpf } from "./cpf";
import { assertSendAllowed, MailBlockedError } from "./mail/guard";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
process.env.MAIL_OUTBOX_DIR = join(tmpdir(), `peticao-outbox-sig-${process.pid}`);

const tokenFrom = (outbox: string) => {
  const files = readdirSync(outbox).sort();
  const mail = JSON.parse(readFileSync(join(outbox, files[files.length - 1]), "utf8"));
  return { mail, token: new URL(/https?:\/\/\S+/.exec(mail.text)![0]).searchParams.get("token")! };
};

import { _setMxResolverForTests } from "./email-check";
_setMxResolverForTests(async () => "ok"); // testes não dependem de DNS real

async function setup(schema: string) {
  const dbmod = await import("./db");
  await dbmod._openForTests(schema);
  const sig = await import("./signatures");
  const OUTBOX_DIR = (await import("./mail")).outboxDir();
  rmSync(OUTBOX_DIR, { recursive: true, force: true });
  return { dbmod, sig, OUTBOX_DIR };
}

test("CPF: válidos e inválidos", () => {
  assert.equal(isValidCpf("529.982.247-25"), true);
  assert.equal(isValidCpf("52998224725"), true);
  assert.equal(isValidCpf("111.111.111-11"), false);
  assert.equal(isValidCpf("529.982.247-24"), false);
  assert.equal(isValidCpf("123"), false);
});

test("guarda: bloqueia ADUNIR e .gov.br fora de produção", () => {
  assert.throws(() => assertSendAllowed("adunir.andes@gmail.com", "development"), MailBlockedError);
  assert.throws(() => assertSendAllowed("ADUNIR.Andes@Gmail.com", "test"), MailBlockedError);
  assert.throws(() => assertSendAllowed("gabinete@presidencia.gov.br", "development"), MailBlockedError);
  assert.doesNotThrow(() => assertSendAllowed("pessoa@exemplo.com", "development"));
  assert.doesNotThrow(() => assertSendAllowed("gabinete@presidencia.gov.br", "production"));
});

test("guarda: pré-visualização (production + PREVIEW_MODE) continua bloqueando", () => {
  process.env.PREVIEW_MODE = "1";
  try {
    assert.throws(() => assertSendAllowed("adunir.andes@gmail.com", "production"), MailBlockedError);
    assert.throws(() => assertSendAllowed("gabinete@presidencia.gov.br", "production"), MailBlockedError);
  } finally {
    delete process.env.PREVIEW_MODE;
  }
});

test("fluxo: assinar, confirmar, duplicidade, token reutilizado, expirado e cadeia de auditoria", async () => {
  const { dbmod, sig, OUTBOX_DIR } = await setup("t_fluxo");
  const { submit, confirm, counts, validate } = sig;
  const base = { name: "Maria da Silva", email: "maria@unir.br", cpf: "529.982.247-25", category: "servidor", institution: "UNIR", role: "docente", campus: "Ji-Paraná", regionDeclared: true, consent: true };
  const mismatch = validate({ ...base, email: "maria@exemplo.com" });
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.deepEqual(mismatch.errors, { institution: "institution_email_mismatch", email: "institution_email_mismatch" });
  await assert.rejects(() => submit({ ...base, email: "maria@exemplo.com" } as any, {}), sig.InstitutionEmailMismatchError);
  assert.equal((await dbmod.query<{ n: number }>("SELECT COUNT(*)::int n FROM signatures")).rows[0].n, 0);
  const v = validate(base);
  assert.equal(v.ok, true);
  if (!v.ok) return;
  assert.equal(validate({ ...base, consent: false }).ok, false);
  assert.equal(validate({ ...base, cpf: "000.000.000-00" }).ok, false);

  await submit(v.value, { ip: "127.0.0.1", userAgent: "teste" });
  const { mail, token } = tokenFrom(OUTBOX_DIR);
  assert.equal(mail.to, "maria@unir.br");
  assert.equal((await counts()).total, 0);

  assert.equal(await confirm("token-errado"), "invalid");
  assert.equal(await confirm(token), "ok");
  assert.equal(await confirm(token), "ok"); // recover lost response, without confirming/counting again
  assert.deepEqual(await counts(), { servidor: 1, apoiador: 0, estrangeiro: 0, total: 1 });

  // duplicidade (mesmo CPF, e-mail diferente): não cria nem envia
  const n = readdirSync(OUTBOX_DIR).length;
  await submit({ ...v.value, email: "outra@unir.br" }, {});
  assert.equal(readdirSync(OUTBOX_DIR).length, n);
  assert.equal((await counts()).total, 1);

  // token expirado
  const v2 = validate({ ...base, name: "João Pereira", email: "joao@unir.br", cpf: "111.444.777-35" });
  assert.equal(v2.ok, true);
  if (!v2.ok) return;
  await submit(v2.value, {});
  const t2 = tokenFrom(OUTBOX_DIR).token;
  await dbmod.query("UPDATE signatures SET token_expires_at='2000-01-01T00:00:00.000Z' WHERE email='joao@unir.br'");
  assert.equal(await confirm(t2), "expired");

  // auditoria íntegra e detecta adulteração
  assert.equal((await dbmod.verifyAuditChain()).ok, true);
  await dbmod.query("UPDATE audit_log SET event='x' WHERE id=(SELECT MIN(id) FROM audit_log)");
  assert.equal((await dbmod.verifyAuditChain()).ok, false);

  await dbmod._closeDbForTests();
  rmSync(OUTBOX_DIR, { recursive: true, force: true });
});

test("regressão: envio bloqueado desfaz o pendente e não contamina o próximo cadastro", async () => {
  const { dbmod, sig, OUTBOX_DIR } = await setup("t_regressao");
  const { submit, validate, confirm, counts } = sig;

  const blocked = validate({ name: "Teste Bloqueado", email: "adunir.andes@gmail.com", cpf: "529.982.247-25", category: "apoiador", city: "Porto Velho", uf: "RO", consent: true });
  assert.equal(blocked.ok, true);
  if (!blocked.ok) return;
  await assert.rejects(() => submit(blocked.value, {}), MailBlockedError);
  assert.equal((await dbmod.query<{ n: number }>("SELECT COUNT(*)::int n FROM signatures")).rows[0].n, 0);

  const real = validate({ name: "Maria da Silva", email: "maria2@unir.br", cpf: "529.982.247-25", category: "servidor", institution: "UNIR", role: "docente", campus: "Ji-Paraná", regionDeclared: true, consent: true });
  assert.equal(real.ok, true);
  if (!real.ok) return;
  await submit(real.value, {});
  assert.equal(await confirm(tokenFrom(OUTBOX_DIR).token), "ok");
  assert.deepEqual(await counts(), { servidor: 1, apoiador: 0, estrangeiro: 0, total: 1 });
  const row = (await dbmod.query<{ name: string; email: string }>("SELECT name,email FROM signatures")).rows[0];
  assert.deepEqual(row, { name: "Maria da Silva", email: "maria2@unir.br" });

  await dbmod._closeDbForTests();
  rmSync(OUTBOX_DIR, { recursive: true, force: true });
});

test("concorrência: duas assinaturas simultâneas iguais não geram erro nem duplicata", async () => {
  const { dbmod, sig, OUTBOX_DIR } = await setup("t_concorrencia");
  const v = sig.validate({ name: "Ana Souza", email: "ana@exemplo.com", cpf: "529.982.247-25", category: "apoiador", city: "Manaus", uf: "AM", consent: true });
  assert.equal(v.ok, true);
  if (!v.ok) return;
  await Promise.all([sig.submit(v.value, {}), sig.submit(v.value, {}), sig.submit(v.value, {})]);
  const n = (await dbmod.query<{ n: number }>("SELECT COUNT(*)::int n FROM signatures")).rows[0].n;
  assert.equal(n, 1);
  assert.equal((await dbmod.verifyAuditChain()).ok, true);
  await dbmod._closeDbForTests();
  rmSync(OUTBOX_DIR, { recursive: true, force: true });
});
