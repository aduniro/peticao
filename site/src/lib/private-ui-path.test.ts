import test from "node:test";
import assert from "node:assert/strict";
import { privateUiPath } from "./private-ui-path";

test("portal de confirmação e painéis não participam do rastreio público", () => {
  for (const path of ["/presidente", "/presidente/revisar", "/admin", "/admin/presidente", "/dev/formularios"]) assert.equal(privateUiPath(path), true, path);
  for (const path of ["/", "/assinar", "/obrigado", "/presidentemente", "/pt"]) assert.equal(privateUiPath(path), false, path);
});
