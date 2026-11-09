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
  const { hmac } = await import("./security");
  const { dedupEmail } = await import("./email-check");
  const mk = (name: string, email: string, cpf: string, extra: object = {}) => {
    const v = sig.validate({ ...base, name, email, cpf, ...extra });
    assert.equal(v.ok, true, JSON.stringify(v));
    return (v as { ok: true; value: any }).value;
  };
  const kindOf = async (email: string) => {
    const r = (await dbmod.query<{ k: string | null }>("SELECT email_domain_kind k FROM signatures WHERE email=$1", [email])).rows;
    return r.length ? r[0].k : "AUSENTE"; // null = cadastro existe, sem selo
  };
  // Registros anteriores à política atual são fixtures do banco fictício, não
  // cadastros novos autorizados por validate/submit.
  const legacyServer = async (name: string, email: string, cpf: string) => {
    const kind = await inst.institutionalKind(email);
    await dbmod.query(
      `INSERT INTO signatures(name,email,email_hash,cpf_hash,category,institution,role,campus,text_version,consent_at,created_at,status,email_domain_kind)
       VALUES($1,$2,$3,$4,'servidor','UNIR','docente','Ji-Paraná','pre-policy-fixture','2026-10-01T10:00:00Z','2026-10-01T10:00:00Z','pending',$5)`,
      [name, email, hmac(dedupEmail(email)), hmac(cpf), kind],
    );
  };
  const supporter = { category: "apoiador", uf: "RO", city: "Ji-Paraná", institution: undefined, role: undefined, campus: undefined, regionDeclared: false };

  // sementes e sufixos
  await sig.submit(mk("Maria da Silva", "maria@unir.br", cpfFrom("100000001")), {});
  const beforeRejected = (await dbmod.query<{ n: number }>("SELECT COUNT(*)::int n FROM signatures")).rows[0].n;
  for (const email of ["joao@usp.edu.br", "pedro@gmail.com", "lucas@ufxx.br", "rita@ufxx.br"]) {
    const form = { ...base, name: "Pessoa Fictícia", email, cpf: cpfFrom("100000009") };
    const rejected = sig.validate(form);
    assert.equal(rejected.ok, false, `Servidor UNIR não pode usar ${email}`);
    if (!rejected.ok) assert.equal(rejected.errors.email, "institution_email_mismatch");
    await assert.rejects(() => sig.submit(form as any, {}), sig.InstitutionEmailMismatchError, "submit também protege chamadas que pulam validate");
  }
  assert.equal((await dbmod.query<{ n: number }>("SELECT COUNT(*)::int n FROM signatures")).rows[0].n, beforeRejected);
  await legacyServer("João Pereira", "joao@usp.edu.br", cpfFrom("100000002"));
  await sig.submit(mk("Pedro Souza", "pedro@gmail.com", cpfFrom("100000003"), supporter), {});
  await sig.submit(mk("Ana Costa", "ana@aluno.unir.br", cpfFrom("100000004"), supporter), {});
  assert.equal(await kindOf("maria@unir.br"), "ifes", "kindOf maria@unir.br");
  assert.equal(await kindOf("joao@usp.edu.br"), "ensino-edu-br", "kindOf joao@usp.edu.br");
  assert.equal(await kindOf("pedro@gmail.com"), null, "kindOf pedro@gmail.com");
  assert.equal(await kindOf("ana@aluno.unir.br"), "discente", "kindOf ana@aluno.unir.br");

  // A curadoria histórica mantém sua fila e conta ocorrências, sem aceitar
  // novos cadastros de servidor cujo domínio não tenha vínculo MEC aprovado.
  await legacyServer("Lucas Alves", "lucas@ufxx.br", cpfFrom("100000005"));
  await legacyServer("Rita Lima", "rita@ufxx.br", cpfFrom("476614227"));
  await inst.notePendingDomain("ufxx.br");
  await inst.notePendingDomain("ufxx.br");
  const pend = (await dbmod.query<{ domain: string; status: string; seen_count: number }>("SELECT domain,status,seen_count FROM institutional_domains WHERE domain='ufxx.br'")).rows[0];
  assert.equal(pend.status, "pending");
  assert.equal(pend.seen_count, 2);
  assert.equal(await kindOf("lucas@ufxx.br"), null, "kindOf lucas@ufxx.br");

  // aprovação pela curadoria sobe retroativamente quem já assinou
  const updated = await inst.decideDomain("UFXX.br", "approved", { kind: "ifes", institution: "Universidade Federal XX", by: "teste" });
  assert.ok(updated >= 1);
  assert.equal(await kindOf("lucas@ufxx.br"), "ifes", "kindOf lucas@ufxx.br");
  assert.equal(sig.validate({ ...base, name: "Nova Pessoa", email: "nova@ufxx.br", cpf: cpfFrom("100000010") }).ok, false, "selo legado aprovado sem vínculo MEC não autoriza novo Servidor UNIR");

  // rejeição vence o sufixo automático
  await inst.decideDomain("privada.edu.br", "rejected", { by: "teste" });
  assert.equal(await inst.institutionalKind("x@privada.edu.br"), null);
  assert.equal(await inst.institutionalKind("x@outra.edu.br"), "ensino-edu-br");
  await assert.rejects(() => inst.decideDomain("gmail.com", "approved", { by: "teste" }));

  // e-mail que não recebe mensagens: recusa sem criar cadastro
  const before = (await dbmod.query<{ n: number }>("SELECT COUNT(*)::int n FROM signatures")).rows[0].n;
  await assert.rejects(() => sig.submit(mk("Caio Dias", "caio@semmx.example", cpfFrom("100000006"), supporter), {}), sig.EmailUndeliverableError);
  assert.equal((await dbmod.query<{ n: number }>("SELECT COUNT(*)::int n FROM signatures")).rows[0].n, before);

  // e-mail descartável é recusado na validação
  assert.equal(sig.validate({ ...base, name: "Beto Souza", email: "beto@mailinator.com", cpf: cpfFrom("100000007") }).ok, false);

  // Gmail com pontos/+etiqueta conta como o mesmo e-mail (não duplica nem reenvia como novo)
  await sig.submit(mk("Pedro Souza", "pe.dro+x@gmail.com", cpfFrom("100000008"), supporter), {});
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
