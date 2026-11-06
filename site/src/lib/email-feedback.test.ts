import test from "node:test";
import assert from "node:assert/strict";
import { emailSuggestionForCategory } from "./email-feedback";

test("institutional forms do not recommend Gmail or another personal provider", () => {
  for (const category of ["servidor", "estrangeiro"] as const) {
    for (const domain of ["gmail.com", "outlook.com", "hotmail.com", "mail.gmail.com"]) {
      assert.equal(emailSuggestionForCategory(category, `pessoa@${domain}`), null);
    }
  }
});

test("supporter provider corrections and institutional domain corrections remain available", () => {
  assert.equal(emailSuggestionForCategory("apoiador", "pessoa@gmail.com"), "pessoa@gmail.com");
  assert.equal(emailSuggestionForCategory("servidor", "pessoa@ifc.edu.br"), "pessoa@ifc.edu.br");
  assert.equal(emailSuggestionForCategory("servidor", "pessoa@unir.br"), "pessoa@unir.br");
});

test("a category conflict does not offer a replacement address and invalid suggestions are hidden", () => {
  assert.equal(emailSuggestionForCategory("apoiador", "pessoa@unir.br", "apoiador_institutional_email"), null);
  for (const suggestion of [null, undefined, "", "pessoa@gmail"]) {
    assert.equal(emailSuggestionForCategory("apoiador", suggestion), null);
  }
});
