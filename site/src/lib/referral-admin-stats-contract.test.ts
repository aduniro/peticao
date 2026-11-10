import test from "node:test";
import assert from "node:assert/strict";
import { referralStatsSearch, referralStatsOptions, referralStatsCount } from "./referral-admin-stats-contract";
test("referral stats exact search contract rejects duplicates, extras, malformed cursors and page overflow",()=>{
 assert.deepEqual(referralStatsSearch(new URLSearchParams()),{limit:50});assert.deepEqual(referralStatsSearch(new URLSearchParams("before=2147483647&limit=100")),{before:2147483647,limit:100});
 for(const query of ["limit=0","limit=101","limit=01","limit=1.5","before=0","before=-1","before=2147483648","before=1e2","limit=2&limit=2","before=3&before=4","token=x","filter=all","limit=NaN"])assert.equal(referralStatsSearch(new URLSearchParams(query)),null,query);
 for(const value of [null,[],{limit:1,extra:true},{before:NaN},{limit:Infinity},{before:2147483648}])assert.equal(referralStatsOptions(value),null);
});
test("bigint counts are exact safe numbers or rejected, never rounded/truncated",()=>{assert.equal(referralStatsCount("9007199254740991"),Number.MAX_SAFE_INTEGER);assert.equal(referralStatsCount("0"),0);for(const v of ["9007199254740992","9223372036854775807","-1","1.2","01",NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.equal(referralStatsCount(v),null);});
