import test from "node:test";
import assert from "node:assert/strict";
import { showCpfError } from "./cpf-feedback";
import { supporterEmailSuggestion, SUPPORTER_PROVIDER_PRIORITY } from "./supporter-email-suggestion";
import { emailSuggestionForCategory } from "./email-feedback";

test("CPF quiet while incomplete editing, invalid on blur and immediately at eleven digits", () => {
  for (const value of ["", "123", "123.456.789-0"]) {
    assert.equal(showCpfError(value, false), false);
    assert.equal(showCpfError(value, true), true);
  }
  for (const blurred of [true, false]) {
    assert.equal(showCpfError("111.111.111-11", blurred), true);
    assert.equal(showCpfError("123.456.789-09", blurred), false);
  }
});

test("supporter suggestions preserve known providers, match ordered prefixes and prioritize ambiguity", () => {
  for (const [typed, target] of [["g.com", "gmail.com"], ["o.com", "outlook.com"], ["gm.com", "gmail.com"], ["gmx.con", "gmx.com"], ["outl.com", "outlook.com"], ["gmial.com", "gmail.com"], ["gmail", "gmail.com"], ["hotmail.con", "hotmail.com"]]) {
    assert.equal(supporterEmailSuggestion(`qa@${typed}`), `qa@${target}`, typed);
  }
  for (const domain of SUPPORTER_PROVIDER_PRIORITY) assert.equal(supporterEmailSuggestion(`qa@${domain}`), null, domain);
  for (const email of ["a@unir.br", "a@empresa-xyz.com.br", "a@@g.com", "sem-arroba", "@g.com", "a@"]) assert.equal(supporterEmailSuggestion(email), null, email);
  assert.equal(emailSuggestionForCategory("servidor", "qa@gmail.com"), null);
  assert.equal(emailSuggestionForCategory("apoiador", "qa@gmail.com", "apoiador_institutional_email"), null);
});
