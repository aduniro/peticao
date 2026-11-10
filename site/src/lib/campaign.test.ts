import { makeTicket } from "./identity";
import test from "node:test";
import assert from "node:assert/strict";
import { rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _setMxResolverForTests } from "./email-check";
import { brasilia, relativeTime } from "./time";
import { firstName } from "./public-feed";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
process.env.MAIL_OUTBOX_DIR = join(tmpdir(), `peticao-outbox-camp-${process.pid}`);
_setMxResolverForTests(async () => "ok");

function cpfFrom(n9: string): string {
  const d = n9.split("").map(Number);
  for (const len of [9, 10]) { const sum = d.slice(0, len).reduce((a, v, i) => a + v * (len + 1 - i), 0); const r = (sum * 10) % 11; d.push(r === 10 ? 0 : r); }
  return d.join("");
}

test("horário de Brasília e tempo relativo", () => {
  assert.equal(brasilia("2026-10-29T17:03:22.000Z"), "29/10/2026 14:03:22"); // UTC-3
  assert.equal(brasilia("2026-10-29T02:30:00.000Z"), "28/10/2026 23:30:00"); // vira o dia
  assert.equal(brasilia("2026-07-01T15:00:00Z", true), "01/07/2026 12:00:00 (horário de Brasília)"); // sem horário de verão
  assert.equal(brasilia(null), ""); assert.equal(brasilia("lixo"), "");
  const now = Date.parse("2026-10-29T12:00:00Z");
  assert.equal(relativeTime("2026-10-29T11:59:30Z", now), "agora");
  assert.equal(relativeTime("2026-10-29T11:55:00Z", now), "há 5 min");
  assert.equal(relativeTime("2026-10-29T09:00:00Z", now), "há 3 h");
  assert.equal(relativeTime("2026-10-27T12:00:00Z", now), "há 2 dias");
  assert.equal(relativeTime("2026-10-28T12:00:00Z", now), "há 1 dia");
});

test("lista pública: só o primeiro nome, nunca sobrenome", () => {
  assert.equal(firstName("Maria José da Silva"), "Maria");
  assert.equal(firstName("maria JOSÉ DA silva"), "Maria");
  assert.equal(firstName("  Carlos   Eduardo "), "Carlos");
  assert.equal(firstName(""), "");
  assert.ok(!firstName("Fernanda Cristina Albuquerque").includes("Albuquerque"));
  assert.ok(firstName("Aleksandrovich-Konstantinopolsky Ivanov").length <= 18);
});

test("campanha: instituição pelo e-mail, origem, gerações, mesmo aparelho e lista pública", async () => {
  const dbmod = await import("./db");
  await dbmod._openForTests("t_camp");
  const sig = await import("./signatures");
  const ref = await import("./referrals");
  const disp = await import("./dispersion");
  const feed = await import("./public-feed");
  const inst = await import("./institutional");
  const { handleSign } = await import("./sign-flow");
  const out = process.env.MAIL_OUTBOX_DIR!;
  const tokenOf = () => { const f = readdirSync(out).sort().at(-1)!; return new URL(/https?:\/\/\S+/.exec(JSON.parse(readFileSync(join(out, f), "utf8")).text)![0]).searchParams.get("token")!; };
  const sign = async (name: string, email: string, n9: string, extra: { refCode?: string; visitorId?: string } = {}) => {
    const r = await handleSign({ name, email, cpf: cpfFrom(n9), category: "servidor", institution: "UNIR", role: "docente", campus: "Ji-Paraná", regionDeclared: true, consent: true }, { ip: "1.2.3.4", ...extra }, null);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return tokenOf();
  };

  // A: direto, confirma no mesmo aparelho
  const tA = await sign("Ana Maria Souza", "ana@unir.br", "400000001", { visitorId: "visitor-aaaa0001" });
  const a = await sig.confirmFull(tA, { visitorId: "visitor-aaaa0001", ip: "9.9.9.1" });
  // B: pela indicação de A; confirma em OUTRO aparelho
  const tB = await sign("Bruno Lima", "bruno@unir.br", "400000002", { refCode: a.code, visitorId: "visitor-bbbb0002" });
  const b = await sig.confirmFull(tB, { visitorId: "visitor-outro0099", ip: "9.9.9.2" });
  // C: pela indicação de B; sem cookie ao confirmar (não dá para saber)
  const tC = await sign("Carla Dias Ramos", "carla@unir.br", "400000003", { refCode: b.code, visitorId: "visitor-cccc0003" });
  const c = await sig.confirmFull(tC, {});
  // D: por código de organização; fica pendente
  const org = await ref.createLabelReferrer("Sindicato Teste");
  await sign("Davi Rocha", "davi@unir.br", "400000004", { refCode: org.code });
  // código inventado é ignorado
  await sign("Eva Nunes", "eva@unir.br", "400000005", { refCode: "ZZZZZZZ" });

  // instituição pelo e-mail institucional (tabela aprovada: semente unir.br)
  const row = (await dbmod.query<any>("SELECT email_domain, email_institution, email_domain_kind FROM signatures WHERE email='ana@unir.br'")).rows[0];
  assert.deepEqual(row, { email_domain: "unir.br", email_institution: "Fundação Universidade Federal de Rondônia", email_domain_kind: "ifes" });
  assert.equal((await inst.institutionInfo("x@gmail.com")).institution, null);
  assert.deepEqual(await inst.institutionInfo("x@sp.gov.br"), { domain: "sp.gov.br", institution: null }); // sufixo sem nome cadastrado

  // mesmo aparelho
  const same = (await dbmod.query<{ e: string; s: boolean | null }>("SELECT email e, confirm_same_visitor s FROM signatures WHERE status='confirmed' ORDER BY id")).rows;
  assert.deepEqual(same.map((x) => [x.e, x.s]), [["ana@unir.br", true], ["bruno@unir.br", false], ["carla@unir.br", null]]);

  // origem e gerações
  const rows = await disp.dispersionRows();
  const by = Object.fromEntries(rows.map((r) => [r.name.split(" ")[0], r]));
  assert.deepEqual([by.Ana.origin, by.Ana.generation, by.Ana.invited], ["direto", 0, 1]);
  assert.deepEqual([by.Bruno.origin, by.Bruno.generation, by.Bruno.invited_confirmed], ["pessoal", 1, 1]);
  assert.deepEqual([by.Carla.origin, by.Carla.generation], ["pessoal", 2]);
  assert.deepEqual([by.Davi.origin, by.Davi.org_label, by.Davi.generation], ["organizacao", "Sindicato Teste", 0]);
  assert.equal(by.Eva.origin, "direto"); // código inexistente → sem origem
  const s = disp.summarize(rows);
  assert.deepEqual([s.total, s.confirmed], [5, 3]);
  assert.deepEqual(s.byOrigin.pessoal, { total: 2, confirmed: 2, pending: 0 });
  assert.deepEqual(s.byGeneration.map((g) => [g.generation, g.total]), [[0, 3], [1, 1], [2, 1]]);
  assert.deepEqual([s.spreaders[0].name, s.spreaders[0].reach, s.spreaders[1].name, s.spreaders[1].reach], ["Ana Maria Souza", 2, "Bruno Lima", 1]); // alcance inclui convidados dos convidados
  assert.deepEqual([s.sameDevice, s.notSameDevice], [1, 1]);
  assert.ok(s.deepShare !== null && s.deepShare > 0.33 && s.deepShare < 0.34); // 1 de 3 confirmadas está na geração 2

  // lista pública: só confirmadas, mais recente primeiro, nome mascarado
  const items = await feed.recentSignatures(8);
  assert.deepEqual(items.map((i) => i.who), ["Carla", "Bruno", "Ana"]);
  assert.ok(items.every((i) => i.kind === "servidor" && /^\d{4}-/.test(i.at)));
  assert.equal(JSON.stringify(items).includes("Lima"), false); // sobrenome completo nunca vaza

  // aprovação retroativa também atualiza a instituição
  // (servidor com domínio desconhecido é recusado; a assinatura de Fábio é de apoiador, que aceita qualquer e-mail)
  const rf = await handleSign({ name: "Fábio Mota", email: "fabio@ufxx.br", cpf: cpfFrom("400000006"), category: "apoiador", city: "Porto Velho", uf: "RO", consent: true, ticket: makeTicket(cpfFrom("400000006"), "fabio@ufxx.br"), identity: { method: "nascimento", value: "01/02/1990" } }, { ip: "1.2.3.4" }, { name: "synthetic", lookup: async () => ({ nome: "FÁBIO MOTA", nasc: "01/02/1990", mae: null }) });
  assert.equal(rf.status, 200, JSON.stringify(rf.json));
  assert.equal((await dbmod.query<any>("SELECT email_institution i FROM signatures WHERE email='fabio@ufxx.br'")).rows[0].i, null);
  await inst.decideDomain("ufxx.br", "approved", { kind: "ifes", institution: "Universidade Federal XX", by: "teste" });
  assert.equal((await dbmod.query<any>("SELECT email_institution i, email_domain d FROM signatures WHERE email='fabio@ufxx.br'")).rows[0].i, "Universidade Federal XX");

  void c;
  await dbmod._closeDbForTests();
  rmSync(out, { recursive: true, force: true });
});
