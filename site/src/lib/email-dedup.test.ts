import test from "node:test";
import assert from "node:assert/strict";
import { dedupEmail } from "./email-check";

test("personal Gmail aliases share a key without rewriting the delivery address", () => {
  const entered = "Joao.Silva+peticao@Googlemail.com";
  assert.equal(dedupEmail(entered), dedupEmail("joaosilva@gmail.com"));
  assert.equal(entered, "Joao.Silva+peticao@Googlemail.com");
});

test("other domains retain dots and plus suffixes as distinct addresses", () => {
  for (const domain of ["example.org", "university.example", "outlook.com"]) {
    assert.notEqual(dedupEmail(`joao.silva@${domain}`), dedupEmail(`joaosilva@${domain}`));
    assert.notEqual(dedupEmail(`joao+silva@${domain}`), dedupEmail(`joao@${domain}`));
    assert.equal(dedupEmail(` JOAO+Silva@${domain.toUpperCase()} `), `joao+silva@${domain}`);
  }
});
