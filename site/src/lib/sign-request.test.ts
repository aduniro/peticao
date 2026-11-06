import test from "node:test";
import assert from "node:assert/strict";
import { signRequest } from "./sign-request";

test("a failed connection returns a handled failure without mutating or retrying the submission", async () => {
  const body = { name: "Pessoa Fictícia", consent: true };
  let calls = 0;
  const result = await signRequest(body, (async () => { calls++; throw new TypeError("Failed to fetch"); }) as typeof fetch);
  assert.equal(result.data.transportError, true);
  assert.equal(result.status, 503);
  assert.equal(calls, 1);
  assert.deepEqual(body, { name: "Pessoa Fictícia", consent: true });
});

test("an interrupted or non-JSON response is handled", async () => {
  const result = await signRequest({}, (async () => new Response("Bad gateway", { status: 502 })) as typeof fetch);
  assert.equal(result.data.transportError, true);
});

test("validation, identity and success responses reach the caller unchanged", async () => {
  for (const data of [{ errors: { name: "name_cpf_mismatch" } }, { identityRequired: true, ticket: "test" }, { ok: true }]) {
    const result = await signRequest({}, (async () => Response.json(data)) as typeof fetch);
    assert.deepEqual(result.data, data);
  }
});
