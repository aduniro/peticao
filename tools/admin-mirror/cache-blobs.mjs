import { createReadStream, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
process.umask(0o077);
const state = process.env.ADMIN_MIRROR_STATE ?? join(homedir(), ".local/share/peticao-admin-mirror");
const current = JSON.parse(readFileSync(join(state, "current-capture.json"), "utf8"));
if (!/^capture-[a-f0-9-]+$/.test(current.directory)) throw new Error("INVALID_CAPTURE_PATH");
const directory = join(state, "blobs"); mkdirSync(directory, { mode: 0o700, recursive: true });
const lines = createInterface({ input: createReadStream(join(state, current.directory, "batches.jsonl")), crlfDelay: Infinity });
let count = 0;
for await (const line of lines) {
  const row = JSON.parse(line);
  for (const name of ["pdf", "signed_pdf"]) if (typeof row[name] === "string" && /^\\x[0-9a-f]+$/.test(row[name])) {
    const bytes = Buffer.from(row[name].slice(2), "hex"), hash = createHash("sha256").update(bytes).digest("hex"), target = join(directory, hash + ".bin");
    if (!existsSync(target)) writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
    else if (createHash("sha256").update(readFileSync(target)).digest("hex") !== hash) throw new Error("INVALID_CACHED_BLOB");
    count++;
  }
}
console.log(JSON.stringify({ cachedDocuments: count }));
