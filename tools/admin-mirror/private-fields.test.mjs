import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { decodeCacheField, sealEmail, openEmail, protectForLocal } from "./private-fields.mjs";
test("source key stays on source; email is reprotected under an independent local key", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const email = "fictitious@example.test", id = "fictitious-id";
  const source = protectForLocal(email, "fictitious-source-secret-not-a-real-key", id);
  const transfer = sealEmail(decodeCacheField(source, "fictitious-source-secret-not-a-real-key", id), publicKey, id);
  assert(!transfer.includes(email));
  const local = openEmail(transfer, privateKey, "fictitious-independent-local-secret", id);
  assert.equal(decodeCacheField(local, "fictitious-independent-local-secret", id), email);
  assert.throws(() => decodeCacheField(local, "fictitious-source-secret-not-a-real-key", id));
  assert.throws(() => openEmail(transfer, privateKey, "fictitious-independent-local-secret", "different-row"));
  assert.throws(() => decodeCacheField(source, "fictitious-source-secret-not-a-real-key", "different-row"));
});
