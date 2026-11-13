import test from "node:test";
import assert from "node:assert/strict";
import { LOCALES } from "../i18n";
import { signupOutcomePresentation, signupOutcomeStatus, signupStatusCopy } from "./signup-status-copy";

test("signup presentation preserves the actual backend outcome in every locale", () => {
  const cases = [
    [{ submission: "created", mail: "queued" }, "queued"],
    [{ submission: "created", mail: "sent" }, "accepted"],
    [{ submission: "already_received", mail: "sent" }, "duplicate"],
    [{ submission: "already_received", mail: "none" }, "duplicate"],
    [{ submission: "created", mail: "unknown" }, "received"],
    [{}, "received"],
  ] as const;
  for (const lang of LOCALES) {
    const titles = new Set<string>();
    for (const [data, status] of cases) {
      assert.equal(signupOutcomeStatus(data), status);
      const copy = signupOutcomePresentation(lang, data);
      assert.equal(copy.text, signupStatusCopy(lang, status));
      assert(copy.title.trim()); titles.add(copy.title);
    }
    assert(titles.size >= 3, `${lang}: queued, accepted and duplicate must not share a sent title`);
  }
});

test("missing mail evidence and duplicates never inherit the accepted-mail title", () => {
  for (const lang of LOCALES) {
    const accepted = signupOutcomePresentation(lang, { mail: "sent" }).title;
    assert.notEqual(signupOutcomePresentation(lang, {}).title, accepted);
    assert.notEqual(signupOutcomePresentation(lang, { submission: "already_received", mail: "sent" }).title, accepted);
  }
});
