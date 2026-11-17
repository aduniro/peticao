import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { hmac } from "./security";
import { petitionBaseValidationReady, verifyPetitionBasePdf, isVerifiedPetitionBase, type PetitionBaseValidationBinding } from "./petition-base-validation";
const cpf = "52998224725", bytes = Buffer.from("%PDF-1.7 synthetic base verification fixture");
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const names = ["GOVBR_BASE_VALIDATION_ENABLED", "GOVBR_BASE_VALIDATION_ACCEPTED_PROFILES", "GOVBR_BASE_VALIDATOR_URL", "GOVBR_BASE_VALIDATOR_TOKEN"];
function fixture(t: TestContext) {
  const previous = Object.fromEntries(names.map(n => [n, process.env[n]]));
  t.after(() => { for (const n of names) if (previous[n] === undefined) delete process.env[n]; else process.env[n] = previous[n]; });
  process.env.GOVBR_BASE_VALIDATION_ENABLED = "1"; process.env.GOVBR_BASE_VALIDATION_ACCEPTED_PROFILES = JSON.stringify(["QA-GOVBR-VERIFIER"]); process.env.GOVBR_BASE_VALIDATOR_URL = "http://127.0.0.1:1/validate"; process.env.GOVBR_BASE_VALIDATOR_TOKEN = "QA-BASE-NOT-REAL";
  const binding: PetitionBaseValidationBinding = { artifactId: "10000000-0000-4000-8000-000000000001", petitionTextVersion: "a".repeat(64), responsibleId: 1, profileRevision: 2, expectedSignerCpfHash: hmac("president-cpf:v1:" + cpf) };
  const report = () => ({ protocol: "peticao-base-validation", version: 1, valid: true, sha256: sha(bytes), method: "gov-br-advanced", signerCpf: cpf, certificateFingerprintSha256: "b".repeat(64), integrity: true, govBrChainTrusted: true, coverage: "entire-file", modificationsAllowed: true, revocation: "good", profile: "QA-GOVBR-VERIFIER", validatedAt: new Date().toISOString(), validatorVersion: "qa-1" });
  const fetcher = (value: unknown, call?: () => void) => (async (_url, init) => { call?.(); assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "error"); assert.equal(new Headers(init?.headers).get("authorization"), "Bearer QA-BASE-NOT-REAL"); assert.deepEqual(Buffer.from(init?.body as Uint8Array), bytes); return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }); }) as typeof fetch;
  return { binding, report, fetcher };
}

test("disabled or incomplete verifier cannot access network or mint a base proof", async t => {
  const f = fixture(t); let calls = 0;
  for (const [key, value] of [["GOVBR_BASE_VALIDATION_ENABLED", "0"], ["GOVBR_BASE_VALIDATION_ACCEPTED_PROFILES", "[]"], ["GOVBR_BASE_VALIDATOR_URL", "http://outside.example.test"], ["GOVBR_BASE_VALIDATOR_URL", "https://user:pass@example.test"], ["GOVBR_BASE_VALIDATION_ACCEPTED_PROFILES", '["pades-basic-unhomologated-v1"]']]) {
    const original = process.env[key]; process.env[key] = value; assert.equal(petitionBaseValidationReady(), false);
    assert.equal((await verifyPetitionBasePdf(bytes, f.binding, f.fetcher(f.report(), () => calls++))).ok, false); process.env[key] = original;
  }
  assert.equal(calls, 0);
});
test("positive capability binds exact PDF, artifact, text version, responsible and profile; raw CPF is not retained", async t => {
  const f = fixture(t), result = await verifyPetitionBasePdf(bytes, f.binding, f.fetcher(f.report())); assert.ok(result.ok);
  assert.ok(isVerifiedPetitionBase(result.proof, bytes, f.binding)); assert.ok(Object.isFrozen(result.proof.metadata));
  assert.ok(!JSON.stringify(result.proof).includes(cpf)); assert.equal(result.proof.metadata.method, "gov-br-advanced");
  for (const proof of [JSON.parse(JSON.stringify(result.proof)), { ...result.proof }, Object.create(result.proof)]) assert.equal(isVerifiedPetitionBase(proof, bytes, f.binding), false);
  for (const patch of [{ artifactId: "20000000-0000-4000-8000-000000000001" }, { petitionTextVersion: "c".repeat(64) }, { responsibleId: 2 }, { profileRevision: 3 }, { expectedSignerCpfHash: "d".repeat(64) }]) assert.equal(isVerifiedPetitionBase(result.proof, bytes, { ...f.binding, ...patch }), false);
  assert.equal(isVerifiedPetitionBase(result.proof, Buffer.concat([bytes, Buffer.from("x")]), f.binding), false);
});
test("all evidence fields are mandatory and foreign signer, changed bytes, unknown/revoked/partial signatures are rejected", async t => {
  const f = fixture(t), original = f.report();
  for (const key of Object.keys(original)) { const value = { ...original }; delete (value as any)[key]; assert.equal((await verifyPetitionBasePdf(bytes, f.binding, f.fetcher(value))).ok, false, key); }
  for (const patch of [{ valid: false }, { sha256: "c".repeat(64) }, { method: "icp-brasil" }, { signerCpf: "11144477735" }, { signerCpf: "11111111111" }, { integrity: false }, { govBrChainTrusted: false }, { coverage: "partial" }, { modificationsAllowed: false }, { revocation: "unknown" }, { revocation: "revoked" }, { profile: "other" }, { certificateFingerprintSha256: "bad" }, { validatedAt: new Date(Date.now() - 301_000).toISOString() }, { validatedAt: new Date(Date.now() + 31_000).toISOString() }, { validatedAt: "2026-02-30T00:00:00.000Z" }, { validatorVersion: "bad version" }, { extra: true }]) assert.equal((await verifyPetitionBasePdf(bytes, f.binding, f.fetcher({ ...original, ...patch }))).ok, false, JSON.stringify(patch));
});
test("bad input is rejected before transport and policy changes invalidate an existing capability", async t => {
  const f = fixture(t); let calls = 0;
  for (const [input, binding] of [[Buffer.from("invalid"), f.binding], [bytes, { ...f.binding, responsibleId: 0 }], [bytes, { ...f.binding, extra: true }], [bytes, { ...f.binding, artifactId: "bad" }]] as const) assert.equal((await verifyPetitionBasePdf(input, binding as PetitionBaseValidationBinding, f.fetcher(f.report(), () => calls++))).ok, false);
  assert.equal(calls, 0); const result = await verifyPetitionBasePdf(bytes, f.binding, f.fetcher(f.report())); assert.ok(result.ok);
  process.env.GOVBR_BASE_VALIDATOR_TOKEN = "QA-ROTATED"; assert.equal(isVerifiedPetitionBase(result.proof, bytes, f.binding), false);
});
test("mutation while the verifier is pending cannot bind substituted bytes or policy", async t => {
  const f = fixture(t);
  for (const what of ["bytes", "binding", "config"]) {
    const snapshot = Buffer.from(bytes), binding = { ...f.binding }, report = f.report();
    const fetcher = (async () => { if (what === "bytes") snapshot[snapshot.length - 1] ^= 1; if (what === "binding") binding.profileRevision++; if (what === "config") process.env.GOVBR_BASE_VALIDATOR_TOKEN = "QA-ROTATED"; return new Response(JSON.stringify(report), { headers: { "content-type": "application/json" } }); }) as typeof fetch;
    assert.equal((await verifyPetitionBasePdf(snapshot, binding, fetcher)).ok, false); process.env.GOVBR_BASE_VALIDATOR_TOKEN = "QA-BASE-NOT-REAL";
  }
});
