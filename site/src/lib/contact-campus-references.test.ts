import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { campusReferenceEvidence, CAMPUS_REFERENCE_PROVENANCE } from "./contact-triage/campus-references";

(process.env as Record<string, string>).NODE_ENV = "test";
delete process.env.PREVIEW_MODE;
delete process.env.ADMIN_NO_PASSWORD;

test("reference capture is reproducible, all eight source hashes match and current CSV count is not mistaken for a live census", async () => {
  assert.equal(CAMPUS_REFERENCE_PROVENANCE.sourceRows, 837);
  assert.equal(CAMPUS_REFERENCE_PROVENANCE.sourceUrlReferences, 240); assert.equal(CAMPUS_REFERENCE_PROVENANCE.indirectRows, 597);
  assert.equal(CAMPUS_REFERENCE_PROVENANCE.sourceSnapshotDate, "2026-11-03"); assert.equal(CAMPUS_REFERENCE_PROVENANCE.liveVerified, false); assert.equal(CAMPUS_REFERENCE_PROVENANCE.contentArchived, false);
  const root = new URL("../../../", import.meta.url);
  for (const [source, hash] of Object.entries(CAMPUS_REFERENCE_PROVENANCE.sources)) assert.equal(createHash("sha256").update(await readFile(new URL(source, root))).digest("hex"), hash, source);
  assert.match(execFileSync("python3", [fileURLToPath(new URL("tools/data/build-campus-reference-index.py", root)), "--check"], { encoding: "utf8" }), /PASS deterministic/);
});

test("explicit public institution/municipality lookup returns review candidates and municipal centroids without claiming campus coordinates or publication", async () => {
  const result = campusReferenceEvidence({ institution: "IFPR", cityIbge: 4102604 }); assert.ok(result.ok); assert.ok(result.records.length);
  const row = result.records[0]; assert.equal(row.sourceCategory, "official_page_reference"); assert.ok(row.reviewCandidate); assert.equal(row.municipality.name, "Barracão"); assert.equal(row.location?.kind, "municipal_centroid"); assert.equal(row.location?.campusCoordinatesKnown, false);
  assert.equal(row.sourceReviewed, false); assert.equal(row.evidenceSufficient, false); assert.equal(row.published, false); assert.equal(result.automaticApplication, false); assert.equal(result.networkUsed, false);
  const { normalizeCampusProposal } = await import("./contact-triage/campus-review"); assert.ok(normalizeCampusProposal(row.reviewCandidate));
});

test("indirect, generic, annotated and HTTP references remain incomplete and are not silently promoted or upgraded", () => {
  const indirect = campusReferenceEvidence({ institution: "UFAC" }); assert.ok(indirect.ok); assert.ok(indirect.records.length); assert.ok(indirect.records.every(r => r.sourceCategory === "indirect_inep" && r.sourceUrl === null && r.reviewCandidate === null));
  const generic = campusReferenceEvidence({ institution: "UFSM" }); assert.ok(generic.ok); assert.ok(generic.records.every(r => r.sourceCategory === "official_site_reference" && r.reviewCandidate === null));
  const annotated = campusReferenceEvidence({ institution: "UNIPAMPA" }); assert.ok(annotated.ok); assert.ok(annotated.records.some(r => r.sourceAnnotation)); assert.ok(annotated.records.every(r => r.reviewCandidate === null));
  const http = campusReferenceEvidence({ institution: "UFFS" }); assert.ok(http.ok); assert.ok(http.records.every(r => r.sourceUrl?.startsWith("http:") && r.sourceCategory === "official_http_reference" && r.reviewCandidate === null));
});

test("announced campuses remain audit notes, with no inferred operational status or automatic proposal", () => {
  const result = campusReferenceEvidence({ institution: "IFAM", cityIbge: 1302702 }); assert.ok(result.ok); assert.equal(result.records.length, 0); assert.ok(result.auditNotes.length); assert.ok(result.auditNotes.every(n => n.operationalStatusVerified === false)); assert.equal(result.published, false); assert.equal(result.requiresHumanReview, true);
});

test("local catalog pagination and location validation cannot guess an unknown institution, municipality or arbitrary cursor", () => {
  const first = campusReferenceEvidence({ institution: "IFPR", limit: 2 }); assert.ok(first.ok); assert.equal(first.records.length, 2); assert.ok(first.nextAfter);
  const next = campusReferenceEvidence({ institution: "IFPR", limit: 2, after: first.nextAfter! }); assert.ok(next.ok); assert.ok(next.records.every(r => !first.records.some(p => p.id === r.id)));
  assert.deepEqual(campusReferenceEvidence({ institution: "Unknown" }), { ok: false, error: "unknown_institution" });
  for (const invalid of [{ cityIbge: 9999999 }, { cityIbge: 1.5 }, { limit: 101 }, { after: "bad" }]) assert.deepEqual(campusReferenceEvidence({ institution: "IFPR", ...invalid }), { ok: false, error: "invalid" });
});

test("every exposed review candidate stays compatible with human-review normalization and no network operation is needed", async () => {
  const { IFES } = await import("./ifes-data"), { normalizeCampusProposal } = await import("./contact-triage/campus-review");
  let count = 0;
  for (const institution of IFES) {
    const result = campusReferenceEvidence({ institution: institution.s, limit: 100 }); assert.ok(result.ok); assert.equal(result.nextAfter, null);
    for (const row of result.records) {
      count++;
      if (row.reviewCandidate) assert.ok(normalizeCampusProposal(row.reviewCandidate), row.id);
      if (row.location) { assert.ok(Math.abs(row.location.longitude) <= 180); assert.ok(Math.abs(row.location.latitude) <= 90); }
    }
  }
  assert.equal(count, 837);
});

test("admin lookup enforces Edição, preserves all signer/review/mail records and never invokes fetch", async () => {
  const db = await import("./db"); await db._openForTests("t_campus_references_http");
  const originalFetch = globalThis.fetch; let fetchCalls = 0;
  try {
    globalThis.fetch = (async () => { fetchCalls++; throw new Error("Network forbidden in local references QA"); }) as typeof fetch;
    const users = await import("./admin-users"), { NextRequest } = await import("next/server"), { GET } = await import("../app/api/admin/contato/campus/referencias/route");
    const user = await users.criarUsuario({ email: "qa-campus-reference@example.test", nome: "QA References", nivel: "edicao", senha: "QA-Tests-2026-Ficticia" }); assert.ok(user.ok);
    const token = (await users.abrirSessao(user.usuario.id, "127.0.0.1")).token;
    await db.query("INSERT INTO signatures(name,email,email_hash,category,text_version,consent_at,status,cpf_name_check,campus_ibge) VALUES('QA Pessoa','qa-preserved@example.test','QA-HASH','servidor','QA',now(),'confirmed','aprovado',1100205)");
    const contact = (await db.query("INSERT INTO contact_messages(name,email,kind,message) VALUES('QA Pessoa','qa-contact@example.test','duvida','QA campus') RETURNING id")).rows[0].id;
    const job = (await db.query("INSERT INTO contact_triage_jobs(contact_id,revision,engine,status) VALUES($1,1,'QA','complete') RETURNING id", [contact])).rows[0].id;
    await db.query("INSERT INTO contact_campus_reviews(contact_id,triage_job_id,revision,proposal,decision,source_reviewed,created_by,intent_hash) VALUES($1,$2,1,'{\"institution\":\"IFRO\",\"campusName\":\"QA Referência\"}','approved',true,$3,'QA-PRESERVED-INTENT')", [contact, job, user.usuario.id]);
    await db.query("INSERT INTO mail_outbox(kind,to_addr,payload) VALUES('confirmacao','qa-preserved@example.test','{\"subject\":\"QA Never Dispatch\"}')");
    const snapshot = async () => (await db.query("SELECT 'signature' kind,row_to_json(s)::text raw FROM signatures s UNION ALL SELECT 'review',row_to_json(r)::text FROM contact_campus_reviews r UNION ALL SELECT 'queue',row_to_json(q)::text FROM mail_outbox q UNION ALL SELECT 'audit',row_to_json(a)::text FROM audit_log a ORDER BY kind,raw")).rows;
    const before = await snapshot();
    const request = (auth = true, query = "institution=IFPR&cityIbge=4102604") => new NextRequest("http://localhost/api/admin/contato/campus/referencias?" + query, { headers: { host: "localhost", cookie: auth ? `adm=${token}` : "" } });
    assert.equal((await GET(request(false))).status, 401);
    const response = await GET(request()); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal((await response.json()).networkUsed, false);
    assert.equal((await GET(request(true, "institution=IFPR&email=qa@example.test"))).status, 400);
    await db.query("UPDATE admin_users SET nivel='leitura' WHERE id=$1", [user.usuario.id]); assert.equal((await GET(request())).status, 403);
    assert.deepEqual(await snapshot(), before); assert.equal(fetchCalls, 0);
  } finally { globalThis.fetch = originalFetch; await db._closeDbForTests(); }
});

test("historical non-MEC references remain reviewable without granting server admission", async () => {
  const { findIfes } = await import("./ifes-data");
  const { findReferenceInstitution } = await import("./contact-triage/campus-catalog");
  for (const acronym of ["AMAN", "ITA", "IME"]) {
    assert.equal(findIfes(acronym), null);
    const institution = findReferenceInstitution(acronym); assert.ok(institution);
    const result = campusReferenceEvidence({ institution: acronym }); assert.ok(result.ok);
    assert.equal(result.published, false); assert.equal(result.automaticApplication, false);
  }
});
