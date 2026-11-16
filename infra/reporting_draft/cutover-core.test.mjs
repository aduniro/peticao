import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, fsyncSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { attemptFixtureReport, assertAuthority, nextSlotBoundary, normalizeSnapshot, observeLegacySlot, slotId } from "./cutover-core.mjs";
import { renderReport } from "./renderer.mjs";

const NOW = Date.parse("2026-11-10T23:05:00Z");
const HOST = "sonda-verifica3";
let forbiddenNetworkCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { forbiddenNetworkCalls++; throw new Error("fixture_network_guard"); };
after(() => { globalThis.fetch = originalFetch; assert.equal(forbiddenNetworkCalls, 0); });
const authority = (extra = {}) => ({ schema_version: 1, scope: "hourly-progress-report", enabled: true, owner_host: HOST, fence: 12, ledger_event: 333, manifest_sha256: "a".repeat(64), coordinator_acks: ["admin", "apoio"], not_before_utc: "2026-11-10T23:00:00Z", ...extra });
function fixture() {
  const root = mkdtempSync("/dev/shm/report-cutover-test-");
  const directory = join(root, "slots");
  const calls = [];
  const data = normalizeSnapshot(null, { now: NOW });
  const bodies = renderReport(data);
  const transport = { kind: "fixture", send: async (message) => { calls.push(message); return { status: 202, id: "fixture-provider-123" }; } };
  return { root, directory, calls, data, bodies, options: { now: NOW, directory, host: HOST, readAuthority: async () => authority(), transport }, close: () => rmSync(root, { recursive: true, force: true }) };
}

test("same legacy UTC slot format and conservative next-hour boundary", () => {
  assert.equal(slotId(NOW), "2026-11-10T23-00-00-000Z");
  assert.equal(nextSlotBoundary(NOW), "2026-11-11T00:00:00.000Z");
  assert.throws(() => assertAuthority(authority({ not_before_utc: nextSlotBoundary(NOW) }), HOST, NOW), /current_hour_blocked/);
});

test("disabled, wrong host or missing dual ACK cannot become another writer", async () => {
  const f = fixture();
  try {
    for (const role of [null, authority({ enabled: false }), authority({ owner_host: "local" }), authority({ coordinator_acks: ["admin"] })]) {
      await assert.rejects(attemptFixtureReport(f.data, f.bodies, { ...f.options, readAuthority: () => role }));
    }
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});

test("draft has no usable live transport even with qualified-looking role", async () => {
  const f = fixture();
  try {
    await assert.rejects(attemptFixtureReport(f.data, f.bodies, { ...f.options, transport: { kind: "live", send: () => { throw Error("forbidden"); } } }), /draft_live_transport_disabled/);
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});

test("state directory symlink is refused without changing its destination", async () => {
  const f = fixture();
  try {
    const target = join(f.root, "preserved");
    mkdirSync(target, { mode: 0o700 });
    symlinkSync(target, f.directory, "dir");
    await assert.rejects(attemptFixtureReport(f.data, f.bodies, f.options), /private_owned_directory_required/);
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});

test("concurrent claims send exactly once and preserve fixed Owner", async () => {
  const f = fixture();
  try {
    const results = await Promise.all(Array.from({ length: 6 }, () => attemptFixtureReport(f.data, f.bodies, f.options)));
    assert.equal(results.filter((r) => r.state === "accepted_by_provider").length, 1);
    assert.equal(results.filter((r) => r.state === "slot_already_attempted").length, 5);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].recipient, "operator-1608598f41@example.invalid");
    assert.equal(observeLegacySlot(join(f.directory, slotId(NOW) + ".json")).state, "accepted_by_provider");
  } finally { f.close(); }
});

test("all existing legacy slots block replay, including malformed and unknown states", async () => {
  for (const raw of ["{bad", JSON.stringify({ state: "started_no_automatic_retry" }), JSON.stringify({ state: "configuration_error_no_send" }), JSON.stringify({ state: "accepted_by_provider" }), JSON.stringify({ state: "future_state" })]) {
    const f = fixture();
    try {
      mkdirSync(f.directory, { mode: 0o700 });
      const path = join(f.directory, slotId(NOW) + ".json");
      writeFileSync(path, raw, { mode: 0o600 });
      const result = await attemptFixtureReport(f.data, f.bodies, f.options);
      assert.equal(result.state, "slot_already_attempted");
      assert.equal(readFileSync(path, "utf8"), raw);
      assert.equal(f.calls.length, 0);
    } finally { f.close(); }
  }
});

test("reservation fsync failure prevents network effect and remains blocked", async () => {
  const f = fixture();
  try {
    const io = { fsync(fd, phase) { if (phase === "reservation") throw Error("fixture_sync_failure"); fsyncSync(fd); } };
    assert.equal((await attemptFixtureReport(f.data, f.bodies, { ...f.options, io })).state, "reservation_not_durable_no_send");
    assert.equal(f.calls.length, 0);
    assert.equal((await attemptFixtureReport(f.data, f.bodies, f.options)).state, "slot_already_attempted");
  } finally { f.close(); }
});

test("legacy 5xx marked rejected is observed as uncertain without altering or resending", async () => {
  const f = fixture();
  try {
    mkdirSync(f.directory, { mode: 0o700 });
    const path = join(f.directory, slotId(NOW) + ".json");
    const raw = JSON.stringify({ state: "rejected_by_provider", status: 503 });
    writeFileSync(path, raw, { mode: 0o600 });
    assert.equal(observeLegacySlot(path).state, "uncertain_no_automatic_retry");
    assert.equal((await attemptFixtureReport(f.data, f.bodies, f.options)).state, "slot_already_attempted");
    assert.equal(readFileSync(path, "utf8"), raw);
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});

test("provider acceptance followed by result fsync failure never resends", async () => {
  const f = fixture();
  try {
    const io = { fsync(fd, phase) { if (phase === "result") throw Error("fixture_disk_failure"); fsyncSync(fd); } };
    const result = await attemptFixtureReport(f.data, f.bodies, { ...f.options, io });
    assert.equal(result.state, "uncertain_no_automatic_retry");
    assert.equal(result.provider_accepted_observed, true);
    assert.equal(observeLegacySlot(join(f.directory, slotId(NOW) + ".json")).state, "uncertain_no_automatic_retry");
    await attemptFixtureReport(f.data, f.bodies, f.options);
    assert.equal(f.calls.length, 1);
  } finally { f.close(); }
});

test("authority changed between reservation and send produces no network effect", async () => {
  const f = fixture();
  let reads = 0;
  try {
    const result = await attemptFixtureReport(f.data, f.bodies, { ...f.options, readAuthority: () => authority({ fence: ++reads === 1 ? 12 : 13 }) });
    assert.equal(result.state, "authority_changed_no_send");
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});

test("timeout or missing provider receipt remains uncertain without automatic retry", async () => {
  for (const outcome of [() => { throw Error("fixture_timeout"); }, () => ({ status: 202 })]) {
    const f = fixture();
    try {
      let sends = 0;
      const transport = { kind: "fixture", send: async () => { sends++; return outcome(); } };
      assert.equal((await attemptFixtureReport(f.data, f.bodies, { ...f.options, transport })).state, "uncertain_no_automatic_retry");
      await attemptFixtureReport(f.data, f.bodies, { ...f.options, transport });
      assert.equal(sends, 1);
    } finally { f.close(); }
  }
});

function capsule(captured_at = "2026-11-10T23:04:00Z") {
  return { schema_version: 1, producer: "local-project-metadata", captured_at, report_data: { active: true, generated_at: captured_at, tree: { available: false }, primary_tasks: [{ id: "fixture", title: "<script>fixture</script>", state: "running", progress: null }], coordination: { available: true, sessions: [{ actor: "admin", observation_state: "recent_activity", turn_state: "inProgress" }] }, git: { unavailable: true }, qa: [], normalization: [] } };
}

test("offline rendering keeps original capture time and never claims a fresh active turn", () => {
  const data = normalizeSnapshot(capsule(), { now: NOW, sourceAvailable: false });
  assert.equal(data.source_captured_at, "2026-11-10T23:04:00.000Z");
  assert.equal(data.source_stale, true);
  assert.equal(data.primary_tasks[0].stale, true);
  assert.equal(data.coordination.sessions[0].turn_state, "not_observed");
  assert.match(data.capture_policy, /históricos/);
  const rendered = renderReport(data);
  assert.match(rendered.html, /&lt;script&gt;/);
  assert.doesNotMatch(rendered.html, /<script>/);
});

test("fresh snapshots preserve observation but generation does not renew stale snapshots", () => {
  const fresh = normalizeSnapshot(capsule(), { now: NOW, sourceAvailable: true });
  assert.equal(fresh.source_available, true);
  const old = normalizeSnapshot(capsule("2026-11-10T20:00:00Z"), { now: NOW, sourceAvailable: true });
  assert.equal(old.source_stale, true);
  assert.equal(old.source_captured_at, "2026-11-10T20:00:00.000Z");
  assert.equal(old.generated_at, new Date(NOW).toISOString());
});

test("offline tree retains historical percentage and labels it as such", () => {
  const value = capsule("2026-11-10T20:00:00Z");
  const item = (id) => ({ id, title: "Fixture", state: "em execução registrada", percent: 50 });
  value.report_data.tree = { available: true, source: "vigia_sqlite_read_only", percent: 50, snapshot_at: value.captured_at, sections: [{ ...item("1"), modules: [{ ...item("1.1"), functions: [item("1.1.1")] }] }] };
  const data = normalizeSnapshot(value, { now: NOW, sourceAvailable: false });
  assert.equal(data.tree.percent, 50);
  assert.equal(data.tree.sections[0].modules[0].functions[0].state, "registro antigo — execução não observada");
  const rendered = renderReport(data);
  assert.match(rendered.html, /Marcos da captura histórica/);
  assert.doesNotMatch(rendered.html, /Marcos atuais|Pesos e marcos vêm do Vigia atual/);
  assert.match(rendered.csv, /50\.0000/);
});

test("missing or future source timestamps do not provide progress evidence", () => {
  for (const value of [null, capsule("bad-time"), capsule("2026-11-11T20:00:00Z")]) {
    const result = normalizeSnapshot(value, { now: NOW, sourceAvailable: true });
    assert.equal(result.source_available, false);
    assert.equal(result.tree.available, false);
  }
});

test("unapproved capsule fields and raw prompts, credentials or logs are rejected", () => {
  for (const key of ["prompt", "objective", "password", "token", "stdout", "body", "cpf", "history"]) {
    const value = capsule();
    value.report_data.coordination[key] = "fixture";
    assert.throws(() => normalizeSnapshot(value, { now: NOW, sourceAvailable: true }), /sensitive_field_rejected/);
  }
  const unknown = capsule(); unknown.report_data.signer_export = [];
  assert.throws(() => normalizeSnapshot(unknown, { now: NOW }), /unexpected_report_field/);
});

test("render draft is pure and live API/network helpers are absent", () => {
  for (const file of ["renderer.mjs", "tree-render.mjs", "cutover-core.mjs"]) {
    const code = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(code, /\bfetch\s*\(|execFileSync|from ["']node:(?:https|http|child_process)["']|api\.mailersend\.com/);
  }
});
