import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _setMxResolverForTests } from "./email-check";
import { mockProvider } from "./cpf-check";
import { EBSERH_UNITS } from "./ebserh-units";
import { assertSendAllowed, MailBlockedError } from "./mail/guard";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
process.env.TURNSTILE_SITE_KEY = "";
process.env.TURNSTILE_SECRET_KEY = "";
process.env.REACHER_URL = "";
process.env.VERIFY_ROTATION = "";

function cpfFrom(n9: string): string {
  const digits = n9.split("").map(Number);
  for (const length of [9, 10]) {
    const sum = digits.slice(0, length).reduce((total, digit, index) => total + digit * (length + 1 - index), 0);
    const remainder = (sum * 10) % 11;
    digits.push(remainder === 10 ? 0 : remainder);
  }
  return digits.join("");
}

test("EBSERH: handleSign integra unidade, cidade canônica, região e persistência sem serviços externos", async () => {
  const db = await import("./db");
  const { handleSign } = await import("./sign-flow");
  const outbox = mkdtempSync(join(tmpdir(), "peticao-ebserh-flow-"));
  process.env.MAIL_OUTBOX_DIR = outbox;
  _setMxResolverForTests(async () => "ok");
  await db._openForTests(`t_ebserh_flow_${process.pid}`);
  await db.query(`INSERT INTO institutional_domains(domain,institution_id,status,kind,include_subdomains,source)
    VALUES('qa-ebserh.example.invalid','org:ebserh','approved','federal',true,'isolated-fixture')`);
  let sequence = 80;
  const cpfRecords: Record<string, { nome: string }> = {};
  const provider = mockProvider(cpfRecords);
  const form = (extra: Record<string, unknown> = {}) => {
    const number = ++sequence;
    const cpf = cpfFrom(`200000${String(number).padStart(3, "0")}`);
    cpfRecords[cpf] = { nome: "MARIA TESTE DOS SANTOS" };
    return { name: "Maria Teste dos Santos", email: `qa-ebserh-${number}@qa-ebserh.example.invalid`, cpf, category: "servidor", institution: "EBSERH", role: "tae", consent: true, regionDeclared: false, ...extra };
  };
  const sign = (body: Record<string, unknown>) => handleSign(body, { ip: `198.51.100.${sequence}`, userAgent: "EBSERH isolated integration QA" }, provider);
  const rows = async () => Number((await db.query<{ n: number }>("SELECT COUNT(*)::int n FROM signatures")).rows[0].n);
  try {
    assert.throws(() => assertSendAllowed("qa-ebserh@ebserh.gov.br"), MailBlockedError, "trava governamental de testes continua ativa");
    assert.throws(() => assertSendAllowed("qa-ebserh@hubrasil.gov.br"), MailBlockedError);
    assert.equal(EBSERH_UNITS.length, 48);
    assert.equal((await db.query<{ n: number }>("SELECT COUNT(*)::int n FROM ebserh_units")).rows[0].n, 48);

    const missing = await sign(form());
    assert.equal(missing.status, 422, JSON.stringify(missing.json));
    assert.equal((missing.json.errors as Record<string, string>).campus, "campus_required");
    for (const unitId of ["unidade-inexistente", "ifes:0005", "HUGV-UFAM", " sede "]) {
      const invalid = await sign(form({ ebserhUnitId: unitId }));
      assert.equal(invalid.status, 422, `${unitId}: ${JSON.stringify(invalid.json)}`);
      assert.equal((invalid.json.errors as Record<string, string>).campus, "campus_invalid");
    }
    const foreignInstitution = await sign(form({ email: "qa-unit-injection@unir.br", institution: "UNIR", ebserhUnitId: "hugv-ufam", campus: "Porto Velho", campusIbge: 1100205, regionDeclared: true }));
    assert.equal(foreignInstitution.status, 422);
    assert.equal((foreignInstitution.json.errors as Record<string, string>).campus, "campus_not_in_ifes");
    const otherCategory = await sign(form({ email: "qa-unit-injection@gmail.com", category: "apoiador", ebserhUnitId: "sede", city: "Brasília", uf: "DF" }));
    assert.equal(otherCategory.status, 422);
    assert.equal((otherCategory.json.errors as Record<string, string>).campus, "campus_not_in_ifes");
    assert.equal(await rows(), 0, "nenhum pedido malformado pode persistir");
    assert.equal(readdirSync(outbox).length, 0);

    const capitalBody = form({ ebserhUnitId: "sede", city: "Manaus", uf: "AM", cityIbge: 1302603, campus: "Manaus", campusIbge: 1302603 });
    const capital = await sign(capitalBody);
    assert.equal(capital.status, 200, JSON.stringify(capital.json));
    assert.equal(capital.json.ok, true);
    const capitalRow = (await db.query<Record<string, unknown>>("SELECT institution,ebserh_unit_id,city,uf,city_ibge,campus,campus_ibge,region_declared,region_validated,region_criteria FROM signatures WHERE email=$1", [capitalBody.email])).rows[0];
    assert.equal(capitalRow.institution, "EBSERH");
    assert.equal(capitalRow.ebserh_unit_id, "sede");
    assert.equal(capitalRow.city, "Brasília", "cidade forjada nunca pode ser persistida");
    assert.equal(capitalRow.uf, "DF");
    assert.equal(Number(capitalRow.city_ibge), 5300108);
    assert.equal(capitalRow.campus, "Brasília");
    assert.equal(Number(capitalRow.campus_ibge), 5300108);
    assert.equal(capitalRow.region_declared, false);
    assert.equal(capitalRow.region_validated, false);
    assert.equal(capitalRow.region_criteria, null);

    const wrongRegion = await sign(form({ ebserhUnitId: "sede", regionDeclared: true }));
    assert.equal(wrongRegion.status, 422, JSON.stringify(wrongRegion.json));
    assert.equal((wrongRegion.json.errors as Record<string, string>).region, "region_not_eligible");
    assert.equal(await rows(), 1);

    const amazonBody = form({ email: "qa-ebserh-manaus@qa-ebserh.example.invalid", ebserhUnitId: "hugv-ufam", city: "São Paulo", uf: "SP", cityIbge: 3550308, campus: "São Paulo", campusIbge: 3550308, regionDeclared: false });
    const amazon = await sign(amazonBody);
    assert.equal(amazon.status, 200, JSON.stringify(amazon.json));
    assert.equal(amazon.json.ok, true);
    const amazonRow = (await db.query<Record<string, unknown>>("SELECT id,ebserh_unit_id,city,uf,city_ibge,campus,campus_ibge,region_declared,region_validated,region_criteria FROM signatures WHERE email=$1", [amazonBody.email])).rows[0];
    assert.equal(amazonRow.ebserh_unit_id, "hugv-ufam");
    assert.equal(amazonRow.city, "Manaus");
    assert.equal(amazonRow.uf, "AM");
    assert.equal(Number(amazonRow.city_ibge), 1302603);
    assert.equal(amazonRow.campus, "Manaus");
    assert.equal(Number(amazonRow.campus_ibge), 1302603);
    assert.equal(amazonRow.region_declared, true, "Amazônia Legal marca automaticamente no backend");
    assert.equal(amazonRow.region_validated, true);
    assert.match(String(amazonRow.region_criteria), /amazonia_legal/);
    assert.equal(await rows(), 2);
    assert.equal(readdirSync(outbox).length, 2, "somente outbox dev local recebe confirmações fictícias");

    await assert.rejects(db.query("UPDATE signatures SET city_ibge=3550308 WHERE id=$1", [amazonRow.id]), /foreign key|signatures_ebserh_unit_city_fk/i);
    await assert.rejects(db.query("UPDATE signatures SET category='apoiador' WHERE id=$1", [amazonRow.id]), /check constraint|signatures_ebserh_category_check/i);
    const persisted = (await db.query<{ city: string; city_ibge: number }>("SELECT city,city_ibge FROM signatures WHERE id=$1", [amazonRow.id])).rows[0];
    assert.equal(persisted.city, "Manaus");
    assert.equal(Number(persisted.city_ibge), 1302603);
  } finally {
    _setMxResolverForTests(null);
    await db._closeDbForTests();
    rmSync(outbox, { recursive: true, force: true });
  }
});
