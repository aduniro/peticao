import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const verifyCode=/^[0-9A-HJKMNP-TV-Z]{10}$/;
const hash=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Assert precisely the existing db.ts backfill; do not normalize any other fixture field. Return field counts only, never identity values. */
export function assertSignatureBootstrap(before,after){
 assert.ok(Array.isArray(before)&&Array.isArray(after));assert.equal(after.length,before.length,"bootstrap must not insert/delete signatures");
 const beforeIds=before.map(r=>r.id),afterIds=after.map(r=>r.id);assert.equal(new Set(beforeIds).size,before.length);assert.deepEqual(afterIds,beforeIds,"bootstrap row identity/order must be preserved");
 const maxBefore=before.reduce((n,r)=>r.seq===null?n:Math.max(n,r.seq),0);
 const missing=before.filter(r=>r.status==="confirmed"&&r.seq===null).sort((a,b)=>a.confirmed_at===b.confirmed_at?a.id-b.id:a.confirmed_at===null?1:b.confirmed_at===null?-1:a.confirmed_at<b.confirmed_at?-1:1);
 const expectedSeq=new Map(missing.map((r,index)=>[r.id,maxBefore+index+1]));
 const counts={seq:0,verify_code:0},fields=new Set(),allCodes=new Set();
 for(let i=0;i<before.length;i++){
  const old=before[i],current=after[i];assert.deepEqual(Object.keys(current).sort(),Object.keys(old).sort(),"bootstrap may not add/remove columns");
  for(const key of Object.keys(old))if(hash(old[key])!==hash(current[key])){fields.add(key);assert.ok(key==="seq"||key==="verify_code","unexpected bootstrap column change: "+key);counts[key]++;}
  const oldStable=Object.fromEntries(Object.entries(old).filter(([key])=>key!=="seq"&&key!=="verify_code").sort(([a],[b])=>a.localeCompare(b)));
  const currentStable=Object.fromEntries(Object.entries(current).filter(([key])=>key!=="seq"&&key!=="verify_code").sort(([a],[b])=>a.localeCompare(b)));
  assert.equal(hash(currentStable),hash(oldStable),"all columns except seq/verify_code must remain exactly unchanged");
  if(expectedSeq.has(old.id))assert.equal(current.seq,expectedSeq.get(old.id),"confirmed missing seq gets the expected next sequence");else assert.equal(current.seq,old.seq,"existing or pending seq is unchanged");
  if(old.status==="confirmed"&&old.verify_code===null)assert.ok(typeof current.verify_code==="string"&&verifyCode.test(current.verify_code),"confirmed missing verify code must be assigned a valid code");else assert.equal(current.verify_code,old.verify_code,"existing or pending code is unchanged");
  if(current.verify_code!==null){assert.equal(allCodes.has(current.verify_code),false,"verification codes remain unique");allCodes.add(current.verify_code);}
 }
 const expectedCodes=before.filter(r=>r.status==="confirmed"&&r.verify_code===null).length;
 assert.equal(counts.seq,missing.length);assert.equal(counts.verify_code,expectedCodes);
 return{rowsCompared:before.length,confirmedRows:before.filter(r=>r.status==="confirmed").length,pendingRows:before.filter(r=>r.status==="pending").length,fieldsChanged:[...fields].sort(),fieldChangeCounts:counts,expectedFieldChangeCounts:{seq:missing.length,verify_code:expectedCodes},allOtherColumnsUnchanged:true,existingIdentifiersPreserved:true,pendingIdentifiersUnchanged:true,scope:"Next database bootstrap only; workflow invariant starts after this verified bootstrap"};
}
