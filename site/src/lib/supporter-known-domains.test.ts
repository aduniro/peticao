import test from "node:test";
import assert from "node:assert/strict";
import { isKnownSupporterEmail } from "./supporter-known-domains";

test("UCPel supporter recognition is exact and cannot match lookalike or malformed domains", () => {
  for (const value of ["qa@ucpel.edu.br", "qa@sou.ucpel.edu.br", "QA@UCPEL.EDU.BR"])
    assert.equal(isKnownSupporterEmail(value), true);
  for (const value of ["qa@fakeucpel.edu.br", "qa@ucpel.edu.br.example.com", "qa@@ucpel.edu.br", "@ucpel.edu.br", "qa@ufpel.edu.br"])
    assert.equal(isKnownSupporterEmail(value), false);
});

test("UCPel is accepted without university substitution only for supporter; syntax and MX still apply", async () => {
  const db = await import("./db"); await db._openForTests("t_ucpel_supporter");
  const { validateEmailField } = await import("./email-validate");
  const { _setMxResolverForTests } = await import("./email-check");
  _setMxResolverForTests(async () => "ok");
  try {
    for (const email of ["qa@ucpel.edu.br", "qa@sou.ucpel.edu.br"]) {
      assert.deepEqual(await validateEmailField(email, "apoiador"), { ok: true });
      assert.equal((await validateEmailField(email, "servidor")).ok, false);
    }
    assert.equal((await validateEmailField("qa@@ucpel.edu.br", "apoiador")).ok, false);
    _setMxResolverForTests(async () => "none");
    assert.equal((await validateEmailField("qa-nomx@ucpel.edu.br", "apoiador")).ok, false);
  } finally { _setMxResolverForTests(null); await db._closeDbForTests(); }
});
