import test from "node:test";
import assert from "node:assert/strict";
import cases from "@/content/name-print-policy-cases.json";
import { NAME_PRINT_POLICY, resolvePrintName } from "./name-print-policy";
for (const example of cases) test("central print-name policy: " + example.entered + " / " + example.api, () => {
  const result = resolvePrintName(example.entered, example.api);
  assert.equal(result.proposed, example.proposed);
  assert.equal(result.source, example.source);
  assert.equal(result.majorDivergence, example.major);
  assert.equal(result.notificationRequired, example.major);
  assert.equal(result.policyVersion, NAME_PRINT_POLICY.version);
});
test("unknown particles are not invented and originals are unchanged", () => {
  const entered="Ana Silva",api="ANA MARIA SILVA",result=resolvePrintName(entered,api);
  assert.equal(result.proposed,"Ana Maria Silva");assert.equal(entered,"Ana Silva");assert.equal(api,"ANA MARIA SILVA");
});
test("API particles are mandatory and replace conflicting user particles even when entered name is longer", () => {
  const result=resolvePrintName("Maria da Silva Costa","MARIA DE SILVA");
  assert.equal(result.source,"entered");
  assert.equal(result.proposed,"Maria de Silva Costa");
});
test("API particles are added when the user omitted them from a longer name", () => {
  const result=resolvePrintName("Maria Silva Costa","MARIA DE SILVA");
  assert.equal(result.proposed,"Maria de Silva Costa");
});
