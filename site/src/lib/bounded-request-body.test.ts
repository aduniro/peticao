import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedRequestJson,RequestBodyTooLarge } from './bounded-request-body';
test('actual streamed bytes are bounded without Content-Length and excess stream is cancelled',async()=>{
 let cancelled=false;
 const body=new ReadableStream({pull(c){c.enqueue(new Uint8Array(5));},cancel(){cancelled=true;}});
 const req=new Request('https://fixture.invalid',{method:'POST',body,duplex:'half'} as RequestInit);
 await assert.rejects(()=>boundedRequestJson(req,9),RequestBodyTooLarge);
 assert(cancelled);
});
test('bounded JSON accepts a valid chunked payload and rejects malformed input',async()=>{
 assert.deepEqual(await boundedRequestJson(new Request('https://fixture.invalid',{method:'POST',body:'{"ok":true}'}),11),{ok:true});
 await assert.rejects(()=>boundedRequestJson(new Request('https://fixture.invalid',{method:'POST',body:'!'}),11),SyntaxError);
});
