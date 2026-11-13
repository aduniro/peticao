import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedJsonRequest,signupRequestKey } from './bounded-json-request';
test('request budget includes a stalled response body even when transport ignores abort',async()=>{
  const fake:typeof fetch=async()=>({json:()=>new Promise(()=>{})} as any);
  await assert.rejects(()=>boundedJsonRequest('/fixture',{},fake,10),/timeout/);
});
test('request budget handles rejection and invalid JSON; keys use secure browser-compatible UUID format',async()=>{
  await assert.rejects(()=>boundedJsonRequest('/fixture',{},async()=>new Response('not-json')));
  const a=signupRequestKey(),b=signupRequestKey();
  assert.match(a,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);assert.notEqual(a,b);
});
