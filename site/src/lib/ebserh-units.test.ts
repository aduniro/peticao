import test from "node:test";
import assert from "node:assert/strict";
import { EBSERH_UNITS, findEbserhUnit } from "./ebserh-units";
import { regionOf } from "./geo-data";
import { validate, submit, EbserhUnitValidationError, type SignInput } from "./signatures";
import { _openForTests, _closeDbForTests, query, seedEbserhUnits } from "./db";
import { _setMxResolverForTests } from "./email-check";
import { _clearDomainCache } from "./institutional";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
const base = { name: "Pessoa Fictícia Teste", email: "qa-unit-no-delivery@ebserh.gov.br", cpf: "52998224725", category: "servidor", institution: "EBSERH", role: "tae", consent: true, regionDeclared: false };

test("catálogo EBSERH:47 hospitais+sede, IDs e municípios precisos, sem duplicar complexos", () => {
  assert.equal(EBSERH_UNITS.length, 48);
  assert.equal(EBSERH_UNITS.filter((u) => u.type !== "sede").length, 47);
  assert.equal(new Set(EBSERH_UNITS.map((u) => u.id)).size, 48);
  assert.equal(new Set(EBSERH_UNITS.map((u) => u.municipalityIbge)).size, 39);
  assert.ok(EBSERH_UNITS.every((u) => u.acronym === u.acronym.toUpperCase()));
  assert.equal(findEbserhUnit("sede")?.municipalityIbge, 5300108);
  assert.equal(findEbserhUnit("sede")?.city, "Brasília");
  assert.equal(findEbserhUnit("chu-ufpa"), null, "complexo agregador não duplica hospitais componentes");
  assert.equal(findEbserhUnit("sede "), null);
  assert.equal(findEbserhUnit("inventado"), null);
});

test("validação EBSERH exige unidade; deriva todos os campos e impede forjar instituição/geografia", () => {
  const missing = validate(base);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.errors.campus, "campus_required");
  assert.equal(validate({ ...base, ebserhUnitId: "invalid", campus: "Brasília", campusIbge: 5300108 }).ok, false);
  for (const u of EBSERH_UNITS) {
    const result = validate({ ...base, ebserhUnitId: u.id, campus: "Cidade inventada", campusIbge: 1100205, city: "Forjada", uf: "XX", cityIbge: -1, regionValidated: true });
    assert.equal(result.ok, true, u.id + ":" + JSON.stringify(result));
    if (!result.ok) continue;
    assert.equal(result.value.ebserhUnitId, u.id);
    assert.equal(result.value.campus, u.city);
    assert.equal(result.value.campusIbge, u.municipalityIbge);
    assert.equal(result.value.city, u.city);
    assert.equal(result.value.cityIbge, u.municipalityIbge);
    assert.equal(result.value.uf, u.uf);
    const region = regionOf(u.municipalityIbge);
    assert.equal(result.value.regionDeclared, region.amazoniaLegal || region.faixaFronteira);
    assert.equal(result.value.regionValidated, region.amazoniaLegal || region.faixaFronteira);
  }
  const outside = validate({ ...base, ebserhUnitId: "sede", regionDeclared: true });
  assert.equal(outside.ok, false);
  if (!outside.ok) assert.equal(outside.errors.region, "region_not_eligible");
  for (const payload of [
    { ...base, email: "qa@unir.br", institution: "UNIR", campus: "Porto Velho", campusIbge: 1100205 },
    { ...base, email: "qa@gmail.com", category: "apoiador", city: "Porto Velho", uf: "RO" },
    { ...base, email: "qa@foreign.invalid", category: "estrangeiro", country: "PT", university: "Universidade Fictícia" },
  ]) {
    const result = validate({ ...payload, ebserhUnitId: "sede" });
    assert.equal(result.ok, false, JSON.stringify(payload));
    if (!result.ok) assert.equal(result.errors.campus, "campus_not_in_ifes");
  }
});

test("PostgreSQL EBSERH: FK composta, históricos nullable, submit direto recusa bypass e persiste campos canônicos antes da guarda QA", async () => {
  await _openForTests("test_ebserh_units_20261109_a");
  _setMxResolverForTests(async () => "ok");
  const outbox = mkdtempSync(join(tmpdir(), "ebserh-units-dev-"));
  process.env.MAIL_OUTBOX_DIR = outbox;
  try {
    assert.equal((await query<{ n: number }>("SELECT count(*)::int n FROM ebserh_units")).rows[0].n, 48);
    await seedEbserhUnits();
    assert.equal((await query<{ n: number }>("SELECT count(*)::int n FROM ebserh_units")).rows[0].n, 48);
    const insert = (email: string, category: string, institution: string | null, id: string | null, city: number | null) => query(
      "INSERT INTO signatures(name,email,email_hash,category,institution,ebserh_unit_id,city_ibge,text_version,consent_at) VALUES('Pessoa Fictícia',$1,$1,$2,$3,$4,$5,'fixture','2026-11-09T00:00:00Z')",
      [email, category, institution, id, city]);
    await assert.rejects(insert("wrongcity@example.invalid", "servidor", "EBSERH", "sede", 1100205), { code: "23503" });
    await assert.rejects(insert("missingcity@example.invalid", "servidor", "EBSERH", "sede", null), { code: "23514" });
    await assert.rejects(insert("wrongcategory@example.invalid", "apoiador", "EBSERH", "sede", 5300108), { code: "23514" });
    await assert.rejects(insert("nullinstitution@example.invalid", "servidor", null, "sede", 5300108), { code: "23514" });
    await assert.rejects(insert("wronginstitution@example.invalid", "servidor", "UNIR", "sede", 5300108), { code: "23514" });
    await insert("legacy@example.invalid", "servidor", "EBSERH", null, null);
    assert.equal((await query("SELECT ebserh_unit_id FROM signatures WHERE email='legacy@example.invalid'")).rows[0].ebserh_unit_id, null);
    await query("DELETE FROM signatures");
    await assert.rejects(submit({ ...base, category: "servidor", role: "tae" } as SignInput, {}), EbserhUnitValidationError);
    await assert.rejects(submit({ ...base, institution: "UNIR", email: "qa@unir.br", category: "servidor", role: "tae", ebserhUnitId: "sede" } as SignInput, {}), EbserhUnitValidationError);
    await query("CREATE TABLE ebserh_insert_capture(payload JSONB NOT NULL)");
    await query(`CREATE FUNCTION capture_ebserh_fixture() RETURNS trigger LANGUAGE plpgsql AS $capture$
      BEGIN INSERT INTO ebserh_insert_capture VALUES(to_jsonb(NEW)); RETURN NEW; END; $capture$`);
    await query("CREATE TRIGGER capture_ebserh_fixture BEFORE INSERT ON signatures FOR EACH ROW EXECUTE FUNCTION capture_ebserh_fixture()");
    await assert.rejects(submit({ ...base, category: "servidor", role: "tae", ebserhUnitId: "sede", campus: "Inventada", campusIbge: 1100205, city: "Forjada", cityIbge: -1, uf: "XX", regionValidated: true } as SignInput, {}), /bloque|guard|gov\.br|fora de produção|não produ/i);
    const captured = (await query<{ payload: Record<string, unknown> }>("SELECT payload FROM ebserh_insert_capture")).rows;
    assert.equal(captured.length, 1, "submit realmente inseriu os campos antes da guarda impedir entrega QA");
    assert.equal(captured[0].payload.ebserh_unit_id, "sede");
    assert.equal(captured[0].payload.city, "Brasília");
    assert.equal(captured[0].payload.uf, "DF");
    assert.equal(captured[0].payload.city_ibge, 5300108);
    assert.equal(captured[0].payload.campus, "Brasília");
    assert.equal(captured[0].payload.campus_ibge, 5300108);
    assert.equal(captured[0].payload.region_validated, false);
    assert.equal((await query("SELECT id FROM signatures")).rowCount, 0, "a guarda QA limpa o cadastro incompleto, sem enviar e-mail real");
    // Positivo persistido: proprietário EBSERH vinculado só no banco fictício, domínio .invalid,
    // entrega dev no disco; nenhuma exceção à guarda governamental é introduzida.
    await query(`INSERT INTO institutional_domains(domain,kind,institution,acronym,institution_id,status,source)
      VALUES('qa-ebserh.example.invalid','federal','Empresa Brasileira de Serviços Hospitalares','EBSERH','org:ebserh','approved','fixture')`);
    _clearDomainCache();
    await submit({ ...base, email: "qa-persisted@qa-ebserh.example.invalid", category: "servidor", role: "tae", ebserhUnitId: "hugv-ufam", city: "Forjada", campus: "Forjada", cityIbge: -1, uf: "XX" } as SignInput, {});
    const persisted = (await query("SELECT ebserh_unit_id,city,uf,city_ibge,campus,campus_ibge,region_declared,region_validated,status FROM signatures")).rows;
    assert.equal(persisted.length, 1);
    assert.deepEqual(persisted[0], { ebserh_unit_id: "hugv-ufam", city: "Manaus", uf: "AM", city_ibge: 1302603, campus: "Manaus", campus_ibge: 1302603, region_declared: true, region_validated: true, status: "pending" });
    assert.ok(readdirSync(outbox).length > 0, "confirmação fictícia gravada no disco pelo provider dev");
  } finally {
    _setMxResolverForTests(null);
    _clearDomainCache();
    await _closeDbForTests();
    rmSync(outbox, { recursive: true, force: true });
  }
});
