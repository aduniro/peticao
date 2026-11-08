import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, writeSync, readdirSync, constants } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { collectSource } from "./source-stream.mjs";

process.umask(0o077);
const directory = resolve(process.env.ADMIN_MIRROR_STATE ?? join(homedir(), ".local/share/peticao-admin-mirror"));
mkdirSync(directory, { recursive: true, mode: 0o700 });
const capture = "capture-" + randomUUID(), output = join(directory, capture);
mkdirSync(output, { mode: 0o700 });
const contract = JSON.parse(readFileSync(new URL("./catalog.json", import.meta.url), "utf8"));
const started = Date.now();
const files = new Map();
const blobFiles = new Map(), blobDirectory = join(directory, "blobs");
mkdirSync(blobDirectory, { recursive: true, mode: 0o700 });
try {
  for (const table of contract) files.set(table.name, openSync(join(output, table.name + ".jsonl"), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600));
  const packet = await collectSource(contract, {
    knownBlobs: readdirSync(blobDirectory).filter(name => /^[a-f0-9]{64}\.bin$/.test(name)).map(name => name.slice(0, -4)),
    onBlob: async (hash, content) => {
      if (!blobFiles.has(hash)) blobFiles.set(hash, openSync(join(blobDirectory, hash + ".part"), constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600));
      writeSync(blobFiles.get(hash), content);
    },
    onBlobComplete: async hash => {
      closeSync(blobFiles.get(hash)); blobFiles.delete(hash);
      renameSync(join(blobDirectory, hash + ".part"), join(blobDirectory, hash + ".bin"));
    },
    onRow: async (table, row) => { writeSync(files.get(table), JSON.stringify(row) + "\n"); },
    onProgress: async (table, count, bytes) => {
      const state = { phase: "capturing", table, count, bytes, at: new Date().toISOString() };
      writeFileSync(join(directory, "capture-status.json"), JSON.stringify(state), { mode: 0o600 });
      console.log(JSON.stringify(state));
    },
  });
  writeFileSync(join(output, "manifest.json"), JSON.stringify(packet), { mode: 0o600 });
  writeFileSync(join(directory, "current-capture.json.part"), JSON.stringify({ directory: capture }), { mode: 0o600 });
  renameSync(join(directory, "current-capture.json.part"), join(directory, "current-capture.json"));
  const state = { phase: "captured", readOnly: true, revision: packet.revision, capturedAt: packet.capturedAt, elapsedSeconds: Math.round((Date.now() - started) / 1000), counts: Object.fromEntries(packet.tables.map(t => [t.name, t.count])) };
  writeFileSync(join(directory, "capture-status.json"), JSON.stringify(state, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(state));
} catch {
  writeFileSync(join(directory, "capture-status.json"), JSON.stringify({ phase: "failed", at: new Date().toISOString() }), { mode: 0o600 });
  console.error("MIRROR_CAPTURE_FAILED: previous snapshot retained"); process.exitCode = 1;
} finally { for (const fd of [...files.values(), ...blobFiles.values()]) closeSync(fd); }
