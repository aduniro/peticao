import test from "node:test";import assert from "node:assert/strict";import { assertUnregisteredSubstringAmbiguity } from "./mail-delivery-compiled-ui.mjs";
const query="orphan@example.test",row=email=>({email,recordKey:"unregistered:"+email,rowKind:"unregistered_address",cadastroId:null}),fixture=()=>({total:2,linhas:[row(query),row("prepared-"+query)],summary:{registrations:0,unregisteredAddresses:2}});
test("substring oracle deliberately accepts the target plus a distinct prefixed unregistered address",()=>assert.doesNotThrow(()=>assertUnregisteredSubstringAmbiguity(fixture(),query)));
test("ambiguity proof rejects false totals, duplicate addresses, registered rows and nonmatching results",()=>{
 for(const data of [{...fixture(),total:1},{...fixture(),linhas:[row(query),row(query)]},{...fixture(),linhas:[row(query),{...row("prepared-"+query),rowKind:"registration",cadastroId:1}]},{...fixture(),linhas:[row(query),row("unrelated@example.test")]},{...fixture(),summary:{registrations:1,unregisteredAddresses:1}}])assert.throws(()=>assertUnregisteredSubstringAmbiguity(data,query));
});
