import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { _closeDbForTests, _openForTests, query, seedInstitutionRegistry } from "./db";
import { listInstitutions, listServerInstitutions, resolveInstitutionForEmail as resolveEligibleInstitution, resolveInstitutionOwnerForEmail as resolveInstitutionForEmail } from "./institution-registry";
import { _setMxResolverForTests } from "./email-check";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";

test("registro institucional: múltiplos domínios, bloqueio filho, sementes e API", async () => {
  await _openForTests("test_institution_registry_20261109_a");
  _setMxResolverForTests(async () => "ok");
  try {
    await query(`INSERT INTO institution_registry(id,acronym,full_name,aliases,source)
      VALUES('test:institution','TEST','Instituição Fictícia','["Teste"]','fixture')`);
    await query(`INSERT INTO institutional_domains(domain,institution_id,status,kind,include_subdomains)
      VALUES('fixture.example.invalid','test:institution','approved','ifes',true),
        ('second.example.invalid','test:institution','approved','ifes',true),
        ('student.fixture.example.invalid','test:institution','rejected','discente',true),
        ('exact.example.invalid','test:institution','approved','federal',false),
        ('gov.br','test:institution','approved','federal',true)`);
    assert.equal(await resolveEligibleInstitution("pessoa@fixture.example.invalid"), null, "instituição sem vínculo MEC não autoriza Servidor");
    assert.equal((await resolveEligibleInstitution("pessoa@unir.br"))?.institutionId, "ifes:0067");
    assert.equal((await resolveInstitutionForEmail("pessoa@eb.mil.br"))?.institutionId, "org:exercito-brasileiro");
    assert.equal(await resolveEligibleInstitution("pessoa@eb.mil.br"), null);
    assert.equal(await resolveEligibleInstitution("pessoa@aman.eb.mil.br"), null);
    assert.equal((await listServerInstitutions()).some((institution) => institution.id === "test:institution" || institution.id === "org:exercito-brasileiro"), false);
    const a = await resolveInstitutionForEmail("pessoa@sector.fixture.example.invalid");
    const b = await resolveInstitutionForEmail("pessoa@second.example.invalid");
    assert.equal(a?.institutionId, "test:institution");
    assert.equal(b?.institutionId, a?.institutionId);
    assert.equal(a?.matchedDomain, "fixture.example.invalid");
    assert.equal(await resolveInstitutionForEmail("pessoa@student.fixture.example.invalid"), null);
    assert.equal(await resolveInstitutionForEmail("pessoa@x.student.fixture.example.invalid"), null);
    assert.equal(await resolveInstitutionForEmail("pessoa@fakefixture.example.invalid"), null);
    assert.equal(await resolveInstitutionForEmail("pessoa@fixture.example.invalid.evil.test"), null);
    assert.equal(await resolveInstitutionForEmail("pessoa@x.exact.example.invalid"), null);
    assert.equal((await resolveInstitutionForEmail("pessoa@exact.example.invalid"))?.institutionId, "test:institution");
    assert.equal(await resolveInstitutionForEmail("pessoa@outro.gov.br"), null);
    assert.equal(await resolveInstitutionForEmail("a@b@fixture.example.invalid"), null);
    assert.equal(await resolveInstitutionForEmail("sem-arroba"), null);
    assert.equal(await resolveInstitutionForEmail("nome com espaco@fixture.example.invalid"), null);
    assert.equal(await resolveInstitutionForEmail("nome@fixture.example.invalid/path"), null);
    assert.equal(await resolveInstitutionForEmail("nome@fixture..example.invalid"), null);
    const records = (await listInstitutions()).filter((i) => i.id === "test:institution");
    assert.equal(records.length, 1);
    assert.ok(records[0].domains.some((d) => d.domain === "fixture.example.invalid"));
    assert.ok(records[0].domains.some((d) => d.domain === "second.example.invalid"));

    // A semente não volta a aprovar uma rejeição manual, nem toca registros fora do catálogo.
    await query("UPDATE institutional_domains SET status='rejected', source='manual', decided_by='fixture' WHERE domain='unir.br'");
    const before = (await query("SELECT * FROM institutional_domains WHERE domain='second.example.invalid'")).rows[0];
    await seedInstitutionRegistry();
    await seedInstitutionRegistry();
    assert.equal((await query("SELECT status FROM institutional_domains WHERE domain='unir.br'")).rows[0].status, "rejected");
    assert.deepEqual((await query("SELECT * FROM institutional_domains WHERE domain='second.example.invalid'")).rows[0], before);

    const { POST } = await import("../app/api/email/validar/route");
    const req = new NextRequest("http://localhost/api/email/validar", {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.19" },
      body: JSON.stringify({ email: "pessoa@fixture.example.invalid", category: "servidor" }),
    });
    const body = await (await POST(req)).json();
    assert.equal(body.institution, undefined, "API não fornece instituição elegível para titular sem vínculo MEC");

    const rejected = await POST(new NextRequest("http://localhost/api/email/validar", {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.20" },
      body: JSON.stringify({ email: "pessoa@fixture.example.invalid", category: "apoiador" }),
    }));
    const invalidBody = await rejected.json();
    assert.equal(invalidBody.ok, true, "titular sem vínculo MEC e com MX válido pode usar Apoiador, mesmo com kind legado ifes");
    assert.equal(invalidBody.institution, undefined);
  } finally {
    _setMxResolverForTests(null);
    await _closeDbForTests();
  }
});
