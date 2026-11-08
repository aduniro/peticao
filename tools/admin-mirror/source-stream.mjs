import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { digest, canonical, validateContract, validateSnapshot, validateManifest, validateRow } from "./snapshot.mjs";

/** Build code without source credentials; stdout must only be consumed inside the local importer. */
export function exportProgram(contract, knownBlobs = []) {
  validateContract(contract);
  if (!Array.isArray(knownBlobs) || knownBlobs.some(hash => !/^[a-f0-9]{64}$/.test(hash))) throw new Error("MIRROR_BLOB_CACHE");
  return 'import { createHash } from "node:crypto";\n'
    + canonical.toString() + "\n"
    + 'const digest = value => createHash("sha256").update(canonical(value)).digest("hex");\n'
    + "const MIRROR_CONTRACT = " + JSON.stringify(contract) + ";\n"
    + "const MIRROR_KNOWN_BLOBS = " + JSON.stringify(knownBlobs) + ";\n"
    + readFileSync(new URL("./export-source.mjs", import.meta.url), "utf8");
}

export async function collectSource(contract, options = {}, spawnProcess = spawn) {
  const program = exportProgram(contract, options.knownBlobs ?? []);
  const proc = spawnProcess("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=2", "peticao-root", "nice -n 15 node --max-old-space-size=256 --input-type=module"], { stdio: ["pipe", "pipe", "pipe"] });
  proc.stderr.on("data", () => {}); // No remote exception text, credentials or rows enter host logs.
  proc.stdin.on("error", () => {});
  const exit = new Promise((resolve, reject) => {
    proc.once("error", reject); proc.once("close", (code, signal) => resolve({ code, signal }));
  });
  exit.catch(() => {});
  const timeout = setTimeout(() => proc.kill("SIGTERM"), options.timeoutMs ?? 180000);
  const tables = new Map(contract.map(spec => [spec.name, { name: spec.name, rows: [], count: null, sha256: null }]));
  const checks = new Map(contract.map(spec => [spec.name, { hash: createHash("sha256").update("["), count: 0, keys: new Set(), spec }]));
  const blobs = new Map();
  let header = null, complete = false, bytes = 0;
  try {
    proc.stdin.end(program);
    const lines = createInterface({ input: proc.stdout, crlfDelay: Infinity });
    for await (const line of lines) {
      bytes += Buffer.byteLength(line);
      if (bytes > (options.maxBytes ?? 900 * 1024 * 1024)) throw new Error("MIRROR_SOURCE_SIZE_LIMIT");
      const item = JSON.parse(line);
      if (complete) throw new Error("MIRROR_SOURCE_TRAILING_DATA");
      if (item.type === "header") {
        if (header || item.readOnly !== true) throw new Error("MIRROR_SOURCE_HEADER"); header = item;
      } else if (item.type === "blob") {
        if (!header || !options.onBlob || !/^[a-f0-9]{64}$/.test(item.hash) || !Number.isSafeInteger(item.index) || item.index < 0 || typeof item.data !== "string" || item.data.length > 90000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) throw new Error("MIRROR_BLOB_CHUNK");
        let blob = blobs.get(item.hash);
        if (!blob) { blob = { index: 0, bytes: 0, hash: createHash("sha256") }; blobs.set(item.hash, blob); }
        if (blob.index !== item.index) throw new Error("MIRROR_BLOB_ORDER");
        const content = Buffer.from(item.data, "base64"); blob.hash.update(content); blob.bytes += content.length; blob.index++;
        await options.onBlob(item.hash, content);
      } else if (item.type === "blob-complete") {
        const blob = blobs.get(item.hash);
        if (!blob || blob.bytes !== item.bytes || blob.hash.digest("hex") !== item.hash) throw new Error("MIRROR_BLOB_CHECKSUM");
        await options.onBlobComplete?.(item.hash); blobs.delete(item.hash);
      } else if (item.type === "row") {
        const table = tables.get(item.table);
        if (!header || !table || table.count !== null) throw new Error("MIRROR_SOURCE_ROW_ORDER");
        const check = checks.get(item.table), key = validateRow(item.row, check.spec);
        if (check.keys.has(key)) throw new Error("MIRROR_DUPLICATE_KEY"); check.keys.add(key);
        if (check.count) check.hash.update(","); check.hash.update(canonical(item.row)); check.count++;
        if (options.onRow) await options.onRow(item.table, item.row);
        else table.rows.push(item.row);
      } else if (item.type === "table") {
        const table = tables.get(item.name);
        if (!header || !table || table.count !== null) throw new Error("MIRROR_SOURCE_TABLE_ORDER");
        const check = checks.get(item.name); check.hash.update("]");
        if (check.count !== item.count || check.hash.digest("hex") !== item.sha256) throw new Error("MIRROR_SOURCE_CHECKSUM");
        table.count = item.count; table.sha256 = item.sha256;
        if (options.onProgress) await options.onProgress(item.name, item.count, bytes);
      } else if (item.type === "complete") complete = true;
      else throw new Error("MIRROR_SOURCE_RECORD_TYPE");
    }
    const status = await exit;
    if (status.code !== 0 || !header || !complete || blobs.size) throw new Error("MIRROR_SOURCE_INCOMPLETE");
    const ordered = [...tables.values()];
    const packet = { format: header.format, capturedAt: header.capturedAt, contractHash: header.contractHash, complete: true, tables: ordered,
      revision: digest(ordered.map(({ name, count, sha256 }) => ({ name, count, sha256 })).sort((a, b) => a.name.localeCompare(b.name))) };
    if (options.onRow) {
      for (const table of packet.tables) delete table.rows;
      validateManifest(packet, contract);
    } else validateSnapshot(packet, contract);
    return packet;
  } catch (error) { proc.kill("SIGTERM"); await exit.catch(() => {}); throw error; }
  finally { clearTimeout(timeout); }
}
