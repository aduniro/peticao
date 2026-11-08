import test from "node:test";
import assert from "node:assert/strict";
import { acceptsServerDomain } from "./server-email-policy";

test("servidor eligibility is an explicit IFES allowlist, never a public-sector suffix", () => {
  assert.equal(acceptsServerDomain("ifes"), true);
  for (const kind of [null, undefined, "governo", "federal", "estadual", "municipal", "legislativo", "judiciario", "ministerio-publico", "ensino-edu-br", "discente", "universidade-estrangeira", "outro"] as const)
    assert.equal(acceptsServerDomain(kind), false, String(kind));
});
