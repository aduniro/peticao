import test from "node:test";
import assert from "node:assert/strict";
import { dispersionOptions, dispersionSearch, validDispersionActor } from "./dispersion-admin-contract";
test("dispersion options enforce view-specific parent, bounded pages and exact positive cursors", () => {
  assert.deepEqual(dispersionOptions(), { view: "all", limit: 50 });
  assert.deepEqual(dispersionSearch(new URLSearchParams("view=children&parentId=23&before=100&limit=100")), { view: "children", parentId: 23, before: 100, limit: 100 });
  for (const raw of ["view=children", "view=roots&parentId=1", "view=all&parentId=1", "before=01", "before=2147483648", "limit=101", "limit=0", "limit=1&limit=2", "view=all&view=roots", "secret=1", "before=1e3", "view=ALL", "parentId=1", "before=-1"]) assert.equal(dispersionSearch(new URLSearchParams(raw)), null, raw);
  for (const value of [null, [], { before: NaN }, { limit: 1.5 }, { extra: 1 }, { view: "children", parentId: null }]) assert.equal(dispersionOptions(value), null);
});
test("dispersion actor must identify the persisted user and session", () => {
  const actor = { userId: 1, email: "qa@example.invalid", sessaoId: 2 };
  assert.equal(validDispersionActor(actor), true);
  for (const change of [{ userId: 0 }, { userId: 1.2 }, { sessaoId: null }, { sessaoId: 2147483648 }, { email: "" }]) assert.equal(validDispersionActor({ ...actor, ...change }), false);
});
