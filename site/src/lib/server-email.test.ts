import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readdirSync } from "node:fs";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
process.env.MAIL_OUTBOX_DIR = join(tmpdir(), `peticao-outbox-se-${process.pid}`);

const cpfFrom = (n9: string) => { const d = n9.split("").map(Number); for (const len of [9, 10]) { const sum = d.slice(0, len).reduce((a, v, i) => a + v * (len + 1 - i), 0); const r = (sum * 10) % 11; d.push(r === 10 ? 0 : r); } return d.join(""); };

test("servidor: só e-mail institucional de órgão público; o resto é recusado sem gravar nem enviar", async () => {
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

  for (const bad of ["maria@gmail.com", "maria@outlook.com", "aluno@aluno.unir.br", "maria@faculdadeprivada.edu.br"]) {
    const r = await ask(bad);
    assert.equal(r.status, 422, bad);
    assert.deepEqual((r.json as any).errors, { email: "server_email_not_institutional" }, bad);
  }
  // domínio que não recebe e-mail: "e-mail institucional inválido" (digitar corretamente)
  assert.deepEqual(((await ask("maria@prefeiturax.com.br")).json as any).errors, { email: "email_institutional_invalid" });
  assert.equal((await dbmod.query<any>("SELECT COUNT(*)::int n FROM signatures")).rows[0].n, 0); // nada gravado
  assert.equal(mails(), 0); // nenhum e-mail enviado
  // domínio desconhecido e .edu.br genérico vão para a fila de revisão; freemail e discente não
  const pend = (await dbmod.query<any>("SELECT domain FROM institutional_domains WHERE status='pending' ORDER BY domain")).rows.map((r) => r.domain);
  assert.deepEqual(pend, ["faculdadeprivada.edu.br", "prefeiturax.com.br"]);

  // IFES com .edu.br (instituto federal) e .br: domínios semeados como aprovados
  assert.equal(await inst.institutionalKind("x@ifro.edu.br"), "ifes");
  assert.equal(await inst.institutionalKind("x@ufac.br"), "ifes");
  // aceito: IFES semente
  const ok = await ask("maria@unir.br");
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  // aprovado pela ADUNIR depois: passa a valer
  await inst.decideDomain("prefeiturax.com.br", "approved", { kind: "municipal", institution: "Prefeitura X", by: "teste" });
  assert.equal(await inst.institutionalKind("joao@prefeiturax.com.br"), "municipal"); // a regra de aceitação passa a reconhecê-lo (o MX do domínio fictício não existe)
  await dbmod._closeDbForTests();
});
