import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readdirSync } from "node:fs";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
process.env.MAIL_OUTBOX_DIR = join(tmpdir(), `peticao-outbox-se-${process.pid}`);

const cpfFrom = (n9: string) => { const d = n9.split("").map(Number); for (const len of [9, 10]) { const sum = d.slice(0, len).reduce((a, v, i) => a + v * (len + 1 - i), 0); const r = (sum * 10) % 11; d.push(r === 10 ? 0 : r); } return d.join(""); };

test("servidor: exige domínio de instituição MEC correspondente à selecionada, sem gravar nem enviar quando incompatível", async () => {
  const dbmod = await import("./db");
  await dbmod._openForTests("t_server_email");
  const { handleSign } = await import("./sign-flow");
  const inst = await import("./institutional");
  const { _setMxResolverForTests } = await import("./email-check");
  _setMxResolverForTests(async (d) => (d === "prefeiturax.com.br" ? "none" : "ok")); // DNS simulado
  const out = process.env.MAIL_OUTBOX_DIR!;
  const mails = () => { try { return readdirSync(out).length; } catch { return 0; } };
  let n = 500000000;
  const body = (email: string) => ({ name: "Maria da Silva Souza", email, cpf: cpfFrom(String(++n)), category: "servidor", institution: "UNIR", role: "docente", campus: "Ji-Paraná", regionDeclared: true, consent: true });
  const ask = (email: string) => handleSign(body(email), { ip: "1.2.3.4" }, null);
  const mismatch = { institution: "institution_email_mismatch", email: "institution_email_mismatch" };

  for (const bad of ["maria@gmail.com", "maria@outlook.com", "maria@faculdadeprivada.edu.br", "maria@prefeiturax.com.br", "maria@orgao.gov.br", "maria@tribunal.jus.br", "maria@eb.mil.br", "maria@usp.edu.br", "maria@ufam.edu.br"]) {
    const r = await ask(bad);
    assert.equal(r.status, 422, bad);
    assert.deepEqual((r.json as any).errors, mismatch, bad);
  }
  // A titularidade discente é UNIR, mas a categoria de domínio não permite Servidor.
  const student = await ask("aluno@aluno.unir.br");
  assert.equal(student.status, 422);
  assert.deepEqual((student.json as any).errors, { email: "server_email_not_institutional" });
  assert.equal((await dbmod.query<any>("SELECT COUNT(*)::int n FROM signatures")).rows[0].n, 0); // nada gravado
  assert.equal(mails(), 0); // nenhum e-mail enviado
  // A divergência é recusada antes da curadoria/DNS: texto livre, .gov.br,
  // .edu.br e o selo legado de órgão público não autorizam cadastro Servidor.
  const pend = (await dbmod.query<any>("SELECT domain FROM institutional_domains WHERE status='pending' ORDER BY domain")).rows.map((r) => r.domain);
  assert.deepEqual(pend, []);

  // IFES com .edu.br (instituto federal) e .br: domínios semeados como aprovados
  assert.equal(await inst.institutionalKind("x@ifro.edu.br"), "ifes");
  assert.equal(await inst.institutionalKind("x@ufac.br"), "ifes");
  // aceito: IFES semente
  const ok = await ask("maria@unir.br");
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  // Aprovação histórica como órgão municipal preserva o selo, mas não cria
  // vínculo MEC nem autoriza usar UNIR no formulário Servidor.
  await inst.decideDomain("prefeiturax.com.br", "approved", { kind: "municipal", institution: "Prefeitura X", by: "teste" });
  assert.equal(await inst.institutionalKind("joao@prefeiturax.com.br"), "municipal");
  const beforeRejectedApproval = (await dbmod.query<{ n: number }>("SELECT COUNT(*)::int n FROM signatures")).rows[0].n;
  const mailsBeforeRejectedApproval = mails();
  const municipal = await ask("joao@prefeiturax.com.br");
  assert.equal(municipal.status, 422);
  assert.deepEqual((municipal.json as any).errors, mismatch);
  assert.equal((await dbmod.query<{ n: number }>("SELECT COUNT(*)::int n FROM signatures")).rows[0].n, beforeRejectedApproval);
  assert.equal(mails(), mailsBeforeRejectedApproval);
  await dbmod._closeDbForTests();
});
