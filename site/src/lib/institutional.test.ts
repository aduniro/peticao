import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _setMxResolverForTests } from "./email-check";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
process.env.MAIL_OUTBOX_DIR = join(tmpdir(), `peticao-outbox-inst-${process.pid}`);
_setMxResolverForTests(async (d) => (d === "semmx.example" ? "none" : "ok"));

/** Gera um CPF válido a partir de 9 dígitos (para testes). */
function cpfFrom(n9: string): string {
  const d = n9.split("").map(Number);
  for (const len of [9, 10]) {
    const sum = d.slice(0, len).reduce((a, v, i) => a + v * (len + 1 - i), 0);
    const r = (sum * 10) % 11;
    d.push(r === 10 ? 0 : r);
  }
  return d.join("");
}

const base = { cpf: "529.982.247-25", category: "servidor", institution: "UNIR", role: "docente", campus: "Ji-Paraná", regionDeclared: true, consent: true };

test("selo institucional: assinatura, fila de curadoria, aprovação retroativa, rejeição e CPF", async () => {
  const dbmod = await import("./db");
  await dbmod._openForTests("t_inst");
  const sig = await import("./signatures");
  const inst = await import("./institutional");
  const mk = (name: string, email: string, cpf: string, extra: object = {}) => {
    const v = sig.validate({ ...base, name, email, cpf, ...extra });
    assert.equal(v.ok, true, JSON.stringify(v));
    return (v as { ok: true; value: any }).value;
  };
  const kindOf = async (email: string) => {
    const r = (await dbmod.query<{ k: string | null }>("SELECT email_domain_kind k FROM signatures WHERE email=$1", [email])).rows;
    return r.length ? r[0].k : "AUSENTE"; // null = cadastro existe, sem selo
  };

  // sementes e sufixos
  await sig.submit(mk("Maria da Silva", "maria@unir.br", cpfFrom("100000001")), {});
  await sig.submit(mk("João Pereira", "joao@usp.edu.br", cpfFrom("100000002")), {});
  await sig.submit(mk("Pedro Souza", "pedro@gmail.com", cpfFrom("100000003")), {});
  await sig.submit(mk("Ana Costa", "ana@aluno.unir.br", cpfFrom("100000004")), {});
  assert.equal(await kindOf("maria@unir.br"), "ifes", "kindOf maria@unir.br");
  assert.equal(await kindOf("joao@usp.edu.br"), "ensino-edu-br", "kindOf joao@usp.edu.br");
  assert.equal(await kindOf("pedro@gmail.com"), null, "kindOf pedro@gmail.com");
  assert.equal(await kindOf("ana@aluno.unir.br"), "discente", "kindOf ana@aluno.unir.br");

  // domínio desconhecido de servidor entra na fila (não é aprovado sozinho) e conta as ocorrências
  await sig.submit(mk("Lucas Alves", "lucas@ufxx.br", cpfFrom("100000005")), {});
  await sig.submit(mk("Rita Lima", "rita@ufxx.br", cpfFrom("476614227")), {});
  const pend = (await dbmod.query<{ domain: string; status: string; seen_count: number }>("SELECT domain,status,seen_count FROM institutional_domains WHERE domain='ufxx.br'")).rows[0];
  assert.equal(pend.status, "pending");
  assert.ok(pend.seen_count >= 1);
  assert.equal(await kindOf("lucas@ufxx.br"), null, "kindOf lucas@ufxx.br");

  // aprovação pela curadoria sobe retroativamente quem já assinou
  const updated = await inst.decideDomain("UFXX.br", "approved", { kind: "ifes", institution: "Universidade Federal XX", by: "teste" });
  assert.ok(updated >= 1);
  assert.equal(await kindOf("lucas@ufxx.br"), "ifes", "kindOf lucas@ufxx.br");

  // rejeição vence o sufixo automático
  await inst.decideDomain("privada.edu.br", "rejected", { by: "teste" });
  assert.equal(await inst.institutionalKind("x@privada.edu.br"), null);
  assert.equal(await inst.institutionalKind("x@outra.edu.br"), "ensino-edu-br");
  await assert.rejects(() => inst.decideDomain("gmail.com", "approved", { by: "teste" }));

  // e-mail que não recebe mensagens: recusa sem criar cadastro
  const before = (await dbmod.query<{ n: number }>("SELECT COUNT(*)::int n FROM signatures")).rows[0].n;
  await assert.rejects(() => sig.submit(mk("Caio Dias", "caio@semmx.example", cpfFrom("100000006")), {}), sig.EmailUndeliverableError);
  assert.equal((await dbmod.query<{ n: number }>("SELECT COUNT(*)::int n FROM signatures")).rows[0].n, before);

  // e-mail descartável é recusado na validação
  assert.equal(sig.validate({ ...base, name: "Beto Souza", email: "beto@mailinator.com", cpf: cpfFrom("100000007") }).ok, false);

  // Gmail com pontos/+etiqueta conta como o mesmo e-mail (não duplica nem reenvia como novo)
  await sig.submit(mk("Pedro Souza", "pe.dro+x@gmail.com", cpfFrom("100000008")), {});
  assert.equal((await dbmod.query<{ n: number }>("SELECT COUNT(*)::int n FROM signatures WHERE split_part(email,'@',2)='gmail.com'")).rows[0].n, 1);

  // importador: candidatos entram sempre pendentes; ruído, sufixos e conhecidos são descartados; simulação não grava
  const dimp = await import("./domain-import");
  const cands = [{ domain: "orgxx.org.br", institution: "Orgão XX" }, { domain: "facebook.com" }, { domain: "x.gov.br" }, { domain: "unir.br" }, { domain: "orgxx.org.br" }, { domain: "fiocruz.br" }];
  const dry = await dimp.importCandidates(cands, "siorg", false);
  assert.deepEqual([dry.total, dry.freemail, dry.coveredBySuffix, dry.alreadyKnown, dry.inserted], [5, 1, 1, 1, 2]);
  assert.equal((await dbmod.query("SELECT 1 FROM institutional_domains WHERE domain='orgxx.org.br'")).rowCount, 0);
  const real = await dimp.importCandidates(cands, "siorg", true);
  assert.equal(real.inserted, 2);
  assert.deepEqual(await dimp.pendingBySource("siorg"), ["fiocruz.br", "orgxx.org.br"]);
  assert.equal(await inst.institutionalKind("a@orgxx.org.br"), null); // pendente NÃO dá selo

  assert.equal((await dbmod.verifyAuditChain()).ok, true);
  await dbmod._closeDbForTests();
  rmSync(process.env.MAIL_OUTBOX_DIR!, { recursive: true, force: true });
});
