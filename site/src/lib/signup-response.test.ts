import test from "node:test";
import assert from "node:assert/strict";
import { legacySignupResponse } from "./signup-response";
import { signupOutcomeCopy,signupStatusCopy } from "./signup-status-copy";
import { LOCALES } from "@/i18n";
test("old tabs receive explicit queued/duplicate information instead of unconditional sent success",()=>{
  const duplicate=legacySignupResponse({ok:true,submission:"already_received",mail:"none"},false);
  assert.equal(duplicate.ok,false);assert.equal(duplicate.errorCode,"already_received");
  const queued=legacySignupResponse({ok:true,submission:"created",mail:"queued"},false);
  assert.equal(queued.ok,false);assert.equal(queued.errorCode,"mail_queued");
  assert.equal(legacySignupResponse({ok:true,submission:"created",mail:"sent"},false).ok,true);
  assert.equal(legacySignupResponse({ok:true,submission:"already_received",mail:"none"},true).ok,true);
});
test("all five locales distinguish known delivery states and avoid inventing a transport result",()=>{
  for(const locale of LOCALES){
    assert.equal(signupOutcomeCopy(locale,{}),signupStatusCopy(locale,"received"));
    assert.equal(signupOutcomeCopy(locale,{mail:"queued"}),signupStatusCopy(locale,"queued"));
    assert.equal(signupOutcomeCopy(locale,{mail:"sent"}),signupStatusCopy(locale,"accepted"));
    assert.equal(signupOutcomeCopy(locale,{submission:"already_received"}),signupStatusCopy(locale,"duplicate"));
    assert.notEqual(signupStatusCopy(locale,"unavailable"),signupStatusCopy(locale,"unknown"));
  }
});
