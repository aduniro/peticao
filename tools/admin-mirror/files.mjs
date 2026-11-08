import { createReadStream, readFileSync, constants } from "node:fs";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { canonical, validateRow, validateManifest, publishBatches } from "./snapshot.mjs";

export async function* fileBatches(directory, spec, data) {
  const hash = createHash("sha256").update("[");
  const keys = new Set();
  let count = 0, chunk = [], bytes = 0;
  const input = createReadStream(join(directory, spec.name + ".jsonl"), { flags: constants.O_RDONLY | constants.O_NOFOLLOW });
  try {
    const lines = createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line) throw new Error("MIRROR_EMPTY_ROW");
      const row = JSON.parse(line), key = validateRow(row, spec);
      if (keys.has(key)) throw new Error("MIRROR_DUPLICATE_KEY"); keys.add(key);
      if (count) hash.update(","); hash.update(canonical(row)); count++;
      // Checksums describe the transport reference; SQL receives verified local bytes.
      for (const column of spec.columns) if (column.type === "bytea" && typeof row[column.name] === "string" && row[column.name].startsWith("blob:")) {
        const blobHash = row[column.name].slice(5);
        if (!/^[a-f0-9]{64}$/.test(blobHash)) throw new Error("MIRROR_BLOB_REFERENCE");
        const content = readFileSync(join(directory, "..", "blobs", blobHash + ".bin"), { flag: constants.O_RDONLY | constants.O_NOFOLLOW });
        if (createHash("sha256").update(content).digest("hex") !== blobHash) throw new Error("MIRROR_BLOB_CHECKSUM");
        row[column.name] = "\\x" + content.toString("hex");
      }
      const size = Buffer.byteLength(JSON.stringify(row));
      if (chunk.length && (chunk.length >= 500 || bytes + size > 2 * 1024 * 1024)) { yield chunk; chunk = []; bytes = 0; }
      chunk.push(row); bytes += size;
    }
    hash.update("]");
    if (count !== data.count || hash.digest("hex") !== data.sha256) throw new Error("MIRROR_FILE_CHECKSUM");
    if (chunk.length) yield chunk;
  } finally { input.destroy(); }
}

export async function publishFiles(client, directory, contract) {
  const packet = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  validateManifest(packet, contract);
  return publishBatches(client, packet, contract, (spec, data) => fileBatches(directory, spec, data));
}
