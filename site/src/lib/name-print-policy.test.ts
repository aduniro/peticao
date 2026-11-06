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
