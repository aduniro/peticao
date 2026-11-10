import test from "node:test";
import assert from "node:assert/strict";
import { assertPrivateHeaders } from "./indicacoes-compiled-guards.mjs";
const base={"cache-control":"private, no-store, max-age=0","referrer-policy":"no-referrer","x-content-type-options":"nosniff"};
test("composed private security headers accept the effective final no-referrer and duplicate nosniff",()=>{assertPrivateHeaders(base);assertPrivateHeaders({...base,"cache-control":"private, no-store, private, max-age=0","referrer-policy":"strict-origin-when-cross-origin, no-referrer","x-content-type-options":"nosniff, nosniff"});});
test("headers reject final weaker policy, unknown tokens or public/positive caching",()=>{for(const patch of [{"referrer-policy":"no-referrer, strict-origin-when-cross-origin"},{"referrer-policy":"unsafe-url, no-referrer"},{"x-content-type-options":"nosniff, invalid"},{"cache-control":"private, no-store, public"},{"cache-control":"private, no-store, max-age=10"}])assert.throws(()=>assertPrivateHeaders({...base,...patch}));});
