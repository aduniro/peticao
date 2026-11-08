import test from "node:test";
import assert from "node:assert/strict";
import "./preload.mjs";
test("external HTTP is denied before attempting network access",async()=>{
  await assert.rejects(fetch("https://api.cpf-brasil.org/cpf/52998224725"),/LAB_EXTERNAL_NETWORK_BLOCKED/);
});
test("Turnstile simulation rejects invalid and replayed tokens",async()=>{
  const verify=async token=>(await(await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",body:new URLSearchParams({response:token})})).json()).success;
  assert.equal(await verify("invalid-test"),false);
  assert.equal(await verify("valid-one-use"),true);
  assert.equal(await verify("valid-one-use"),false);
});
