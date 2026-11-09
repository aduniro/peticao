import test from "node:test";
import assert from "node:assert/strict";
import { makeTicket, checkTicket } from "./identity";
import { makeSignupSecurityProof, checkSignupSecurityProof, signupSecurityProofFromTicket } from "./signup-security-proof";

test("challenge continuation proof binds identity input, ticket and expiry without containing personal data", () => {
  const input = { category: "apoiador", name: "Pessoa Fictícia", email: "qa@example.test", cpf: "52998224725" };
  const start = Date.now(), ticket = makeTicket(input.cpf, input.email, start);
  const proof = makeSignupSecurityProof(input, ticket);
  assert.ok(checkSignupSecurityProof(proof, input, ticket, start));
  const compatible = `${ticket}.${proof}`;
  assert.ok(checkTicket(compatible, input.cpf, input.email, start));
  assert.equal(signupSecurityProofFromTicket(compatible), proof);
  assert.ok(checkSignupSecurityProof(proof, input, compatible, start));
  assert.equal(checkSignupSecurityProof(proof, input, compatible + ".extra", start), false);
  for (const value of Object.values(input)) assert.ok(!proof.includes(value));
  for (const change of [{ name: "Outra Pessoa" }, { email: "outro@example.test" }, { cpf: "11111111111" }, { category: "servidor" }])
    assert.equal(checkSignupSecurityProof(proof, { ...input, ...change }, ticket, start), false);
  assert.equal(checkSignupSecurityProof(proof, input, makeTicket(input.cpf, input.email, start + 1), start), false);
  assert.equal(checkSignupSecurityProof(proof, input, ticket, start + 15 * 60_000), false);
  assert.equal(checkSignupSecurityProof(proof + ".extra", input, ticket, start), false);
  assert.equal(checkSignupSecurityProof("invalid", input, ticket, start), false);
  assert.equal(checkSignupSecurityProof(proof, input, null, start), false);
});
