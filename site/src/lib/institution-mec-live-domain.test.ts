import test from "node:test";
import assert from "node:assert/strict";
import { _openForTests, _closeDbForTests, query } from "./db";
import { _setMxResolverForTests } from "./email-check";
import { _clearDomainCache } from "./institutional";
import { resolveInstitutionForEmail, resolveInstitutionOwnerForEmail } from "./institution-registry";
import { resolveServerInstitutionForEmail } from "./institution-domain-policy";
import { validateEmailField } from "./email-validate";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";

test("MEC: domínio alternativo cadastrado no DB após build é aceito; rejeição atual e militar prevalecem", async () => {
  await _openForTests("t_mec_live_domain_20261109");
  _setMxResolverForTests(async () => "ok");
  try {
    const unir = await resolveInstitutionForEmail("pessoa@unir.br");
    assert.ok(unir);
    const domain = "novo-mec.example.invalid";
    const email = `pessoa@setor.${domain}`;
    assert.equal(resolveServerInstitutionForEmail(email), null, "não faz parte do catálogo incluído no build");
    await query(`INSERT INTO institutional_domains(domain,institution_id,status,kind,include_subdomains,source)
      VALUES($1,$2,'approved','ifes',true,'fixture')`, [domain, unir.institutionId]);
    _clearDomainCache();
    assert.equal((await resolveInstitutionForEmail(email))?.institutionId, unir.institutionId);
    assert.equal((await validateEmailField(email, "servidor")).ok, true, "usa binding atual do DB");
    await query("UPDATE institutional_domains SET status='rejected' WHERE domain=$1", [domain]);
    _clearDomainCache();
    assert.equal(await resolveInstitutionForEmail(email), null);
    assert.equal((await validateEmailField(email, "servidor")).ok, false);

    await query("UPDATE institutional_domains SET kind='ifes' WHERE domain='eb.mil.br'");
    _clearDomainCache();
    assert.equal((await resolveInstitutionOwnerForEmail("pessoa@eb.mil.br"))?.institutionId, "org:exercito-brasileiro");
    assert.equal(await resolveInstitutionForEmail("pessoa@eb.mil.br"), null);
    assert.equal((await validateEmailField("pessoa@eb.mil.br", "servidor")).ok, false, "kind legado não libera instituição não-MEC");
  } finally {
    _setMxResolverForTests(null);
    _clearDomainCache();
    await _closeDbForTests();
  }
});
