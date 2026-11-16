// Isolated qualification draft. No HTTP client, credentials, timer or live CLI.
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { safeText } from "./renderer.mjs";

export const OWNER = "operator-1608598f41@example.invalid";
const HOUR = 3600000;
const MAX_CAPSULE = 3 * 1024 * 1024;
const FORBIDDEN = new Set(["body", "prompt", "instruction", "objective", "history", "turns", "messages", "attachments", "api_key", "authorization", "password", "secret", "token", "signers", "cpf", "email", "emails", "raw", "stdout", "stderr", "output", "content"]);
const DATA_FIELDS = new Set(["generated_at", "tree", "active", "primary_tasks", "other_running", "paused_waiting", "git", "qa", "normalization", "source_policy", "coordination"]);
const SLOT_STATES = new Set(["accepted_by_provider", "rejected_by_provider", "uncertain_no_automatic_retry", "configuration_error_no_send", "authority_changed_no_send"]);
const sha = (value) => createHash("sha256").update(value).digest("hex");

export function slotId(now) {
  if (!Number.isFinite(now) || now < 0) throw new Error("valid_clock_required");
  return new Date(Math.floor(now / HOUR) * HOUR).toISOString().replace(/[:.]/g, "-");
}

export function nextSlotBoundary(now) {
  slotId(now);
  return new Date((Math.floor(now / HOUR) + 1) * HOUR).toISOString();
}

export function assertAuthority(record, host, now) {
  // Shape/host check only. The injected administrative reader must authenticate
  // the canonical ledger attestation; client JSON is never a valid reader.
  if (!record || record.schema_version !== 1 || record.scope !== "hourly-progress-report" || record.enabled !== true || record.owner_host !== host) throw new Error("report_owner_not_authorized");
  if (!Number.isSafeInteger(record.fence) || record.fence < 1 || !Number.isSafeInteger(record.ledger_event) || record.ledger_event < 1 || !/^[a-f0-9]{64}$/.test(record.manifest_sha256 ?? "")) throw new Error("canonical_ledger_attestation_required");
  if (!Array.isArray(record.coordinator_acks) || new Set(record.coordinator_acks).size !== 2 || !["admin", "apoio"].every((actor) => record.coordinator_acks.includes(actor))) throw new Error("two_coordinator_acks_required");
  const first = Date.parse(record.not_before_utc);
  if (!Number.isFinite(first) || first % HOUR !== 0 || !record.not_before_utc.endsWith("Z")) throw new Error("aligned_cutover_boundary_required");
  if (now < first) throw new Error("cutover_current_hour_blocked");
  return sha(JSON.stringify({ ...record, coordinator_acks: [...record.coordinator_acks].sort() }));
}

function cloneMetadata(value, depth = 0, counter = { count: 0 }) {
  if (++counter.count > 50000 || depth > 20) throw new Error("metadata_structure_limit");
  if (typeof value === "string") return safeText(value);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => cloneMetadata(item, depth + 1, counter));
  if (typeof value !== "object") throw new Error("invalid_metadata_value");
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN.has(key.toLowerCase())) throw new Error("sensitive_field_rejected");
    if (key === "__proto__" || key === "constructor" || key === "prototype") throw new Error("unsafe_metadata_key");
    result[key] = cloneMetadata(item, depth + 1, counter);
  }
  return result;
}

export function normalizeSnapshot(capsule, { now, sourceAvailable = false, maxAgeSeconds = 180 } = {}) {
  slotId(now);
  let data = {}, captured = null;
  if (capsule !== null && capsule !== undefined) {
    if (Buffer.byteLength(JSON.stringify(capsule)) > MAX_CAPSULE || capsule.schema_version !== 1 || capsule.producer !== "local-project-metadata") throw new Error("invalid_metadata_capsule");
    if (!capsule.report_data || typeof capsule.report_data !== "object" || Array.isArray(capsule.report_data)) throw new Error("report_metadata_required");
    for (const key of Object.keys(capsule.report_data)) if (!DATA_FIELDS.has(key)) throw new Error("unexpected_report_field");
    data = cloneMetadata(capsule.report_data);
    captured = Date.parse(capsule.captured_at);
  }
  const known = Number.isFinite(captured) && captured <= now + 60000;
  if (!known) data = { tree: { available: false, reason: "Sem captura de origem válida; nenhum percentual foi presumido." }, git: { unavailable: true }, coordination: { available: false } };
  const ageSeconds = known ? Math.max(0, Math.floor((now - captured) / 1000)) : null;
  const live = sourceAvailable === true && known && ageSeconds <= maxAgeSeconds;
  const stale = !live;
  data.generated_at = new Date(now).toISOString();
  data.source_captured_at = known ? new Date(captured).toISOString() : null;
  data.source_available = live;
  data.source_stale = stale;
  data.capture_policy = live
    ? `Origem consultada em ${data.source_captured_at}. Estados são registros observados, não prova de processo executando nem autorização de publicação.`
    : `Origem indisponível ou sem captura recente. Último snapshot: ${data.source_captured_at ?? "sem registro"}. Estados e percentuais são históricos; nenhuma execução atual foi presumida.`;
  data.source_policy = "Somente metadados e contagens. Sem cadastros, credenciais, conteúdo de e-mail ou logs brutos. Coletor não executa agentes ou deploy.";
  if (stale) {
    for (const key of ["primary_tasks", "other_running", "paused_waiting"]) for (const task of data[key] ?? []) task.stale = true;
    if (data.tree) {
      data.tree.recorded_stale = true;
      data.tree.state_policy = "Registros da captura anterior; não comprovam execução atual, publicação ou homologação. Percentuais continuam históricos.";
      const ageTree = (item) => {
        if (item?.state === "em execução registrada") item.state = "registro antigo — execução não observada";
        for (const name of ["sections", "modules", "functions"]) for (const child of item?.[name] ?? []) ageTree(child);
      };
      ageTree(data.tree);
    }
    if (data.coordination) for (const session of data.coordination.sessions ?? []) Object.assign(session, { stale: true, observation_state: "stale_unavailable", turn_state: "not_observed" });
  }
  return data;
}

function privateDirectory(directory, io) {
  if (!isAbsolute(directory)) throw new Error("absolute_private_state_required");
  if (!existsSync(directory)) {
    mkdirSync(directory, { mode: 0o700 });
    const parent = openSync(dirname(directory), constants.O_RDONLY | constants.O_DIRECTORY);
    try { io.fsync(parent, "state_directory"); } finally { closeSync(parent); }
  }
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077 || info.uid !== process.getuid()) throw new Error("private_owned_directory_required");
}

function syncDirectory(directory, io, phase) {
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try { io.fsync(fd, phase); } finally { closeSync(fd); }
}

function writeNew(path, metadata, io, phase) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, JSON.stringify(metadata, null, 2)); io.fsync(fd, phase); } finally { closeSync(fd); }
  syncDirectory(dirname(path), io, phase + "_directory");
}

function replaceDurable(path, metadata, io) {
  const temp = path + "." + randomUUID() + ".tmp";
  try {
    writeNew(temp, metadata, io, "result");
    renameSync(temp, path);
    syncDirectory(dirname(path), io, "result_replace");
  } finally { if (existsSync(temp)) unlinkSync(temp); }
}

export function observeLegacySlot(path) {
  // Any existing slot blocks sending, including malformed/unknown legacy states.
  if (!existsSync(path)) return null;
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 32768) return { state: "opaque_existing_slot_no_retry" };
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (value.state === "rejected_by_provider" && !(Number.isInteger(value.status) && value.status >= 400 && value.status < 500)) return { state: "uncertain_no_automatic_retry", reason: "legacy_rejection_not_proven" };
    if (value.state === "accepted_by_provider" && !(value.status === 202 && typeof value.id === "string" && /^[A-Za-z0-9_.:/=-]{1,256}$/.test(value.id))) return { state: "uncertain_no_automatic_retry", reason: "legacy_receipt_not_qualified" };
    return { state: value.state === "started_no_automatic_retry" ? "uncertain_no_automatic_retry" : SLOT_STATES.has(value.state) ? value.state : "opaque_existing_slot_no_retry" };
  } catch { return { state: "opaque_existing_slot_no_retry" }; }
}

export async function attemptFixtureReport(data, bodies, { now, directory, host, readAuthority = () => null, transport, io = { fsync: fsyncSync } } = {}) {
  // There is deliberately no live transport or credential loading in this draft.
  if (!transport || transport.kind !== "fixture" || typeof transport.send !== "function") throw new Error("draft_live_transport_disabled");
  const firstAuthority = await readAuthority();
  const authorityHash = assertAuthority(firstAuthority, host, now);
  if (!bodies || typeof bodies.html !== "string" || typeof bodies.text !== "string") throw new Error("rendered_report_required");
  privateDirectory(directory, io);
  const slot = slotId(now), path = join(directory, slot + ".json");
  const meta = { slot, at: new Date(now).toISOString(), recipient: OWNER, state: "started_no_automatic_retry", owner_host: host, authority_fence: firstAuthority.fence, ledger_event: firstAuthority.ledger_event, generated_at: data.generated_at, source_captured_at: data.source_captured_at ?? null, source_stale: data.source_stale === true, body_sha256: sha(bodies.html + "\0" + bodies.text) };
  try { writeNew(path, meta, io, "reservation"); }
  catch (error) {
    if (error.code === "EEXIST") return { state: "slot_already_attempted", slot, previous: observeLegacySlot(path) };
    return { state: "reservation_not_durable_no_send", slot };
  }
  let result;
  try {
    if (assertAuthority(await readAuthority(), host, now) !== authorityHash) throw new Error("owner_changed_before_send");
  } catch {
    result = { ...meta, state: "authority_changed_no_send" };
  }
  if (!result) {
    try {
      const response = await transport.send({ recipient: OWNER, subject: "Andamento da petição — " + data.generated_at, html: bodies.html, text: bodies.text });
      const receipt = typeof response?.id === "string" && /^[A-Za-z0-9_.:/=-]{1,256}$/.test(response.id) ? response.id : null;
      const state = response?.status === 202 && receipt ? "accepted_by_provider" : Number.isInteger(response?.status) && response.status >= 400 && response.status < 500 ? "rejected_by_provider" : "uncertain_no_automatic_retry";
      result = { ...meta, state, status: response?.status ?? null, id: receipt, delivery: "Não comprovada pelo aceite" };
    } catch { result = { ...meta, state: "uncertain_no_automatic_retry" }; }
  }
  try { replaceDurable(path, result, io); }
  catch { return { state: "uncertain_no_automatic_retry", slot, reason: "result_not_durably_recorded", provider_accepted_observed: result.state === "accepted_by_provider", id: result.id ?? null }; }
  return result;
}
