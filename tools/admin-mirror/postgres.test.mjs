import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomBytes, createHash } from "node:crypto";
import { digest, deltaDigest, publishSnapshot, publishBatches } from "./snapshot.mjs";
const require = createRequire(new URL("../../site/package.json", import.meta.url));
const { Client } = require("pg");
const url = process.env.MIRROR_QA_DATABASE_URL;
const contract = [{ name: "signatures", columns: [{ name: "id", type: "integer" }, { name: "name", type: "text" }, { name: "cpf_hash", type: "text" }, { name: "created_at", type: "text" }], primaryKey: ["id"] }];
const row = (id, name) => ({ id, name, cpf_hash: "fictitious-hash-" + id, created_at: "2026-11-01T12:00:00Z" });
function packet(rows, time) {
  const tables = [{ name: "signatures", count: rows.length, sha256: digest(rows), rows }];
  return { format: "peticao-admin-mirror/v1", complete: true, contractHash: digest(contract), capturedAt: time, tables, revision: digest(tables.map(({ name, count, sha256 }) => ({ name, count, sha256 }))) };
}

test("PostgreSQL: atomic replacement, genuine rollback and independent read permissions", { skip: !url }, async () => {
  const parsed = new URL(url);
  assert(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname));
  assert.equal(parsed.pathname, "/mirror_qa");
  const owner = new Client({ connectionString: url });
  let reader;
  await owner.connect();
  try {
    // Dedicated disposable database checked above: make the fixture repeatable.
    const schemas = await owner.query("SELECT nspname FROM pg_namespace WHERE nspname='admin_mirror_live' OR nspname LIKE 'admin_mirror_stage_%' OR nspname LIKE 'admin_mirror_old_%'");
    for (const { nspname } of schemas.rows) {
      assert.match(nspname, /^admin_mirror_(?:live|(?:stage|old)_[a-f0-9]+)$/);
      await owner.query(`DROP SCHEMA "${nspname}" CASCADE`);
    }
    await owner.query(readFileSync(new URL("./bootstrap.sql", import.meta.url), "utf8"));
    await owner.query("TRUNCATE public.admin_mirror_state,public.admin_mirror_access_log,public.admin_mirror_documents RESTART IDENTITY");
    const password = randomBytes(32).toString("hex");
    const alter = await owner.query("SELECT format('ALTER ROLE admin_mirror_reader LOGIN PASSWORD %L',$1::text) AS sql", [password]);
    await owner.query(alter.rows[0].sql);
    parsed.username = "admin_mirror_reader"; parsed.password = password;
    reader = new Client({ connectionString: parsed.href }); await reader.connect();
    await reader.query("SET search_path=admin_mirror_live,public");

    const first = packet([row(1, "Pessoa Fictícia Um"), row(2, "Pessoa Fictícia Dois")], "2026-11-08T06:00:00Z");
    await publishSnapshot(owner, first, contract);
    const original = (await reader.query("SELECT * FROM signatures ORDER BY id")).rows;
    assert.deepEqual(original, first.tables[0].rows);
    for (const sql of ["DELETE FROM signatures", "UPDATE signatures SET name='forbidden'", "INSERT INTO signatures(id) VALUES(99)", "CREATE TABLE public.forbidden(id integer)", "UPDATE public.admin_mirror_state SET revision='forbidden'"]) {
      await assert.rejects(reader.query(sql), error => error.code === "42501");
    }
    await reader.query("INSERT INTO public.admin_mirror_access_log(ts,event,signature_id,data) VALUES(now(),'fixture_read',NULL,'{}')");
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM public.admin_mirror_access_log")).rows[0].n, 1);
    const next = packet([row(2, "Pessoa Fictícia Dois Corrigida"), row(3, "Pessoa Fictícia Três")], "2026-11-08T06:01:00Z");
    await publishSnapshot(owner, next, contract);
    const updated = (await reader.query("SELECT * FROM signatures ORDER BY id")).rows;
    assert.deepEqual(updated, next.tables[0].rows);
    assert.equal(updated[0].cpf_hash, original[1].cpf_hash);
    assert.equal(updated[0].created_at, original[1].created_at);

    const invalid = packet([row("not-an-integer", "Invalid fixture")], "2026-11-08T06:02:00Z");
    await assert.rejects(publishSnapshot(owner, invalid, contract), error => error.code === "22P02");
    assert.deepEqual((await reader.query("SELECT * FROM signatures ORDER BY id")).rows, updated);
    await assert.rejects(publishSnapshot(owner, first, contract), /STALE/);
    assert.deepEqual((await reader.query("SELECT * FROM signatures ORDER BY id")).rows, updated);
    assert.equal((await reader.query("SELECT revision FROM public.admin_mirror_state")).rows[0].revision, next.revision);
    const added = [row(4, "Pessoa Fictícia Quatro")];
    const delta = packet([], "2026-11-08T06:03:00Z");
    delta.tables = [{ name: "signatures", mode: "delta", baseSha256: next.tables[0].sha256, baseCount: 2, addedCount: 1, addedSha256: digest(added), count: 3 }];
    delta.tables[0].sha256 = deltaDigest(delta.tables[0]);
    delta.revision = digest(delta.tables.map(({ name, count, sha256 }) => ({ name, count, sha256 })));
    await publishBatches(owner, delta, contract, async function* () { yield added; });
    assert.deepEqual((await reader.query("SELECT * FROM signatures ORDER BY id")).rows, [...updated, ...added]);
    const reuse = packet([], "2026-11-08T06:04:00Z");
    reuse.tables = [{ name: "signatures", mode: "reuse", baseSha256: delta.tables[0].sha256, baseCount: 3, count: 3, sha256: delta.tables[0].sha256 }];
    reuse.revision = digest(reuse.tables.map(({ name, count, sha256 }) => ({ name, count, sha256 })));
    await publishBatches(owner, reuse, contract, async function* () { throw new Error("Reuse must not reopen old export files"); });
    assert.equal((await reader.query("SELECT count(*)::int AS n FROM signatures")).rows[0].n, 3);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM public.admin_mirror_access_log")).rows[0].n, 1);
    const bytes = Buffer.from("%PDF-fictitious-document"), hash = createHash("sha256").update(bytes).digest("hex");
    const documentContract = [{ name: "batches", columns: [{ name: "id", type: "integer" }, { name: "status", type: "text" }, { name: "pdf", type: "bytea" }, { name: "checked_at", type: "timestamp with time zone" }], primaryKey: ["id"] }];
    const documentRows = [{ id: 1, status: "prepared", pdf: "\\x" + bytes.toString("hex"), checked_at: "2026-11-08T06:00:00.123456Z" }];
    const docs = { format: "peticao-admin-mirror/v1", complete: true, contractHash: digest(documentContract), capturedAt: "2026-11-08T06:05:00Z", tables: [{ name: "batches", count: 1, sha256: digest(documentRows), rows: documentRows }] };
    docs.revision = digest(docs.tables.map(({ name, count, sha256 }) => ({ name, count, sha256 })));
    await publishSnapshot(owner, docs, documentContract);
    assert.deepEqual((await reader.query("SELECT pdf FROM batches WHERE id=1")).rows[0].pdf, bytes);
    assert.equal((await reader.query("SELECT to_char(checked_at,'US') AS microseconds FROM batches WHERE id=1")).rows[0].microseconds, "123456");
    assert.equal(documentRows[0].pdf, "\\x" + bytes.toString("hex"));
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM public.admin_mirror_documents WHERE sha256=$1", [hash])).rows[0].n, 1);
    await assert.rejects(reader.query("SELECT * FROM public.admin_mirror_documents"), error => error.code === "42501");
    const reuseDocs = { ...docs, capturedAt: "2026-11-08T06:06:00Z", tables: [{ name: "batches", mode: "reuse", count: 1, sha256: docs.tables[0].sha256, baseSha256: docs.tables[0].sha256, baseCount: 1 }] };
    await publishBatches(owner, reuseDocs, documentContract, async function* () { throw new Error("Cached PDF must not be reimported"); });
    assert.deepEqual((await reader.query("SELECT pdf FROM batches WHERE id=1")).rows[0].pdf, bytes);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM public.admin_mirror_documents")).rows[0].n, 1);

  } finally {
    await reader?.end(); await owner.end();
  }
});
