import test from "node:test";
import assert from "node:assert/strict";
import { SAFE_EMAIL_RE as RE } from "./email-syntax";
import { validateContact } from "./contact";

test("e-mail: aceita os comuns e recusa caracteres que injetariam parâmetros em links mailto:", () => {
  for (const ok of ["maria.silva@unir.br", "joao+lista@gmail.com", "a_b-c@sub.dominio.org.br", "x.y.z@ufpa.edu.br"]) assert.ok(RE.test(ok), ok);
  for (const bad of ["a?bcc=x@b.co", "a&b@c.org", "a=b@c.org", "a,b@c.org", "a;b@c.org", "<a>@c.org", "a b@c.org", 'a"b@c.org', "a%40b@c.org", "semarroba", "a@b", "a@b.c", "joão@unir.br", "a..b@unir.br", ".a@unir.br", "a.@unir.br", "o'brien@exemplo.ie", "a!b@unir.br", "a@-x.br", "a@x-.br", "a@unir..br"]) assert.ok(!RE.test(bad), bad);
  const r = validateContact({ name: "Ana Souza", email: "a?bcc=x%40atacante.com@b.co", kind: "bug", message: "mensagem longa o bastante" });
  assert.ok(!r.ok && r.errors.email === "email_invalid");
});
