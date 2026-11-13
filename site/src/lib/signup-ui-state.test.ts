import test from "node:test";
import assert from "node:assert/strict";
import { safeConfirmationPanel, preservesCommonSignupFields } from "./signup-ui-state";

test("confirmation redirects only to a valid local personal token path", () => {
  assert.equal(safeConfirmationPanel("/meu/fixture_token-123"), "/meu/fixture_token-123");
  for (const value of [null, undefined, {}, "", "https://example.invalid", "//example.invalid", "javascript:alert(1)", "/meu/", "/meu/../admin", "/meu/%2e%2e/admin", "/meu/token?redirect=https://example.invalid", "/meu/\\example.invalid"]) {
    assert.equal(safeConfirmationPanel(value), null, String(value));
  }
});

test("only the explicit supporter-to-staff transition can preserve compatible identity fields", () => {
  assert(preservesCommonSignupFields("apoiador", "servidor", true));
  for (const [from, to, requested] of [["apoiador", "servidor", false], ["servidor", "apoiador", true], ["estrangeiro", "servidor", true], ["apoiador", "estrangeiro", true]] as const) {
    assert.equal(preservesCommonSignupFields(from, to, requested), false);
  }
});
