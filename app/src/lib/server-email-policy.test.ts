import test from "node:test";
import assert from "node:assert/strict";
import { acceptsServerDomain } from "./server-email-policy";

test("servidor eligibility is an explicit IFES allowlist, never a public-sector suffix", () => {
  assert.equal(acceptsServerDomain("ifes"), true);
  for (const kind of [null, undefined, "governo", "federal", "estadual", "municipal", "legislativo", "judiciario", "ministerio-publico", "ensino-edu-br", "discente", "universidade-estrangeira", "outro"] as const)
    assert.equal(acceptsServerDomain(kind), false, String(kind));
});

test("EBSERH exception accepts only the two owner-approved exact domains", () => {
  for (const domain of ["ebserh.gov.br", "hubrasil.gov.br", " HUBRASIL.GOV.BR "]) {
    assert.equal(acceptsServerDomain("governo", domain), true, domain);
    assert.equal(acceptsServerDomain(null, domain), true, domain);
  }
  for (const domain of ["saude.gov.br", "sub.ebserh.gov.br", "ebserh.gov.br.evil.org", "fakehubrasil.gov.br", "hubrasil.gov", "", null]) {
    assert.equal(acceptsServerDomain("governo", domain), false, String(domain));
  }
});
