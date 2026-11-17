import test from "node:test";
import assert from "node:assert/strict";
import { appendBaseInventoryPage, baseInventoryCursor, baseInventoryTimestamp, compareBaseInventoryRows, parseBaseInventoryCursor, type BaseInventoryArtifact } from "./petition-base-pagination";
import { readBaseInventory } from "./petition-base-request";
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const stamp="2026-11-10T10:00:00.123456Z";
const item=(n:number,uploadedAt=stamp):BaseInventoryArtifact=>({artifactId:uuid(n),sha256:"a".repeat(64),byteLength:32,lastValidationId:null,uploadedAt});
const raw=(entries:BaseInventoryArtifact[],hasMore=false)=>({ok:true,hasMore,nextCursor:hasMore?baseInventoryCursor(entries.at(-1)!):null,artifacts:entries.map(entry=>({...entry,usableInPackage:false}))});
const response=(value:unknown)=>(async()=>Response.json(value)) as typeof fetch;
test("cursor preserves six PostgreSQL fractional digits and rejects noncanonical/oversized coordinates",()=>{
 const cursor=baseInventoryCursor(item(3));assert.deepEqual(parseBaseInventoryCursor(cursor),{uploadedAt:stamp,artifactId:uuid(3)});assert.ok(cursor.includes(".123456Z"));
 assert.equal(compareBaseInventoryRows(item(3),item(3,"2026-11-10T10:00:00.123457Z")),-1);assert.equal(compareBaseInventoryRows(item(3),item(4)),-1);
 for(const bad of ["",cursor+"x","pbase1:"+"x".repeat(100),cursor.replace(".123456Z",".123Z"),cursor.replace(".123456Z",".1234567Z"),cursor.replace(".123456Z",".123456+00:00"),cursor.replace("2026-11-10","2026-02-30"),cursor.replace("2026-11-10","0000-11-10"),cursor.replace("T10:","T24:"),cursor.replace("pbase1:","pbase2:"),cursor.replace(uuid(3),uuid(3).replace("4000","A000"))])assert.equal(parseBaseInventoryCursor(bad),null,bad);
 assert.equal(baseInventoryTimestamp("2024-02-29T23:59:59.999999Z"),true);assert.equal(baseInventoryTimestamp("2025-02-29T23:59:59.999999Z"),false);
});
test("explicit next-page GET binds the exact microsecond cursor and performs one request",async()=>{
 const before=baseInventoryCursor(item(4));let calls=0;
 const fetcher=(async(path,init)=>{calls++;assert.equal(new URL(String(path),"http://localhost").searchParams.get("cursor"),before);assert.equal(init?.method,"GET");assert.equal(init?.credentials,"same-origin");return Response.json(raw([item(3),item(2)]));}) as typeof fetch;
 const result=await readBaseInventory(fetcher,1000,before);assert.equal(result.kind,"success");assert.equal(calls,1);
 assert.deepEqual(await readBaseInventory(fetcher,1000,"bad"),{kind:"rejected",status:400,error:"parameters"});assert.equal(calls,1);
});
test("inventory parser refuses loops, wrong boundaries, malformed timestamps, unsorted and incomplete pages",async()=>{
 const entries=Array.from({length:20},(_,n)=>item(40-n)),good=raw(entries,true);
 assert.equal((await readBaseInventory(response(good))).kind,"success");
 const badPages=[{...good,nextCursor:baseInventoryCursor(item(40))},{...good,artifacts:entries.slice(0,19).map(x=>({...x,usableInPackage:false}))},{...good,nextCursor:null},{...raw([item(2)]),nextCursor:baseInventoryCursor(item(2))},raw([item(2),item(3)]),raw([item(3),item(3)]),raw([item(3,"2026-11-10T10:00:00.123Z")])];
 for(const value of badPages)assert.equal((await readBaseInventory(response(value))).kind,"uncertain");
 assert.equal((await readBaseInventory(response(raw([item(5)])),1000,baseInventoryCursor(item(4)))).kind,"uncertain");
 let calls=0;const failed=(async()=>{calls++;throw Error("lost read");}) as typeof fetch;
 assert.equal((await readBaseInventory(failed,1000,baseInventoryCursor(item(4)))).kind,"uncertain");assert.equal(calls,1);
});
test("append deduplicates immutable rows, keeps order and preserves original state after contradictions or stale reads",()=>{
 const first={artifacts:[item(5),item(4)],hasMore:true,nextCursor:baseInventoryCursor(item(4))};
 const next={artifacts:[item(4),item(3),item(2)],hasMore:false,nextCursor:null};const before=structuredClone(first);
 const merged=appendBaseInventoryPage(first,next,first.nextCursor);assert.ok(merged);assert.deepEqual(merged.artifacts.map(x=>x.artifactId),[uuid(5),uuid(4),uuid(3),uuid(2)]);assert.deepEqual(first,before);
 assert.equal(appendBaseInventoryPage(first,{...next,artifacts:[{...item(4),sha256:"b".repeat(64)}]},first.nextCursor),null);
 assert.equal(appendBaseInventoryPage(first,next,baseInventoryCursor(item(3))),null);
 assert.equal(appendBaseInventoryPage(first,{artifacts:[],hasMore:true,nextCursor:first.nextCursor},first.nextCursor),null);
 assert.deepEqual(first,before);
});
