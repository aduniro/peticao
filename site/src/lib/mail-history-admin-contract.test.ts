import test from "node:test";
import assert from "node:assert/strict";
import {historySearch,validHistoryKey,validHistoryEventId} from "./mail-history-admin-contract";
const id="message:00000000-0000-4000-8000-000000000001";
test("history metadata parser preserves list filters and separates detail from bound collection requests",()=>{
 assert.deepEqual(historySearch(new URLSearchParams("recipient=QA%40example.test&limit=50")),{mode:"list",options:{before:undefined,limit:50,recipient:"QA@example.test",kind:undefined,channel:undefined,status:undefined}});
 assert.deepEqual(historySearch(new URLSearchParams({id})),{mode:"detail",key:id});
 assert.deepEqual(historySearch(new URLSearchParams({id,collection:"events",limit:"100",before:"abc"})),{mode:"collection",key:id,collection:"events",options:{before:"abc",limit:100}});
 for(const query of["limit=51","limit=1.5","limit=1&limit=1","collection=events","id=legacy:1&collection=events","id="+id+"&recipient=a","id="+id+"&before=abc","id="+id+"&collection=attempts&limit=101","recipient=","unknown=1","status=sent","channel=other","recipient=a%0Ab"]){assert.equal(historySearch(new URLSearchParams(query)),null,query);}
});
test("history keys and bigint event IDs retain strict units without rounding",()=>{
 assert.ok(validHistoryKey(id));assert.ok(validHistoryKey("legacy:2147483647"));assert.equal(validHistoryKey("legacy:2147483648"),false);
 assert.ok(validHistoryEventId("9007199254740993"));assert.ok(validHistoryEventId("9223372036854775807"));for(const v of["9223372036854775808","01","0","-1",9007199254740992])assert.equal(validHistoryEventId(v),false);
});
