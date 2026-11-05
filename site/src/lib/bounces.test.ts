import test from "node:test";
import assert from "node:assert/strict";
import { bounceWhy } from "./bounces";

test("motivo da devolução em português", () => {
  assert.equal(bounceWhy("550-5.1.1 The email account that you tried to reach does not exist.").semServidor, false);
  assert.match(bounceWhy("550-5.1.1 The email account that you tried to reach does not exist.").text, /caixa de e-mail não existe/);
  assert.deepEqual(bounceWhy("Unable to find MX of domain ufpa.edu.br"), { text: "O domínio não tem servidor de e-mail", semServidor: true });
  assert.match(bounceWhy("").text, /Devolvido/);
});
