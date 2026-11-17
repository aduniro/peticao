#!/usr/bin/env node
/** Node20-compatible downloader/extractor. Never executes npm/package scripts or PDF.js itself. */
import { readFile, writeFile, mkdir, rename, lstat } from "node:fs/promises";
import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { homedir } from "node:os";

const lock = JSON.parse(await readFile(new URL("./pdfjs-assets.lock.json", import.meta.url), "utf8"));
if (lock.package !== "pdfjs-dist" || lock.version !== "6.5.438" || lock.archiveUrl !== "https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.5.438.tgz") throw Error("Invalid PDF.js asset lock");
const args = process.argv.slice(2), options = {};
let offline = false;
for (let n = 0; n < args.length; n++) {
  if (args[n] === "--offline") { if (offline) throw Error("Duplicate offline option");offline = true;continue; }
  if (!["--destination", "--cache-dir"].includes(args[n]) || !args[n + 1] || !isAbsolute(args[n + 1])) throw Error("Use --offline and absolute --destination/--cache-dir paths");
  if (options[args[n]]) throw Error("Duplicate option");
  options[args[n]] = args[++n];
}
const destination = resolve(options["--destination"] ?? fileURLToPath(new URL(`../public/vendor/pdfjs/${lock.version}/`, import.meta.url)));
const cache = resolve(options["--cache-dir"] ?? join(homedir(), ".cache", "peticao", "pdfjs-dist", lock.version));
async function noSymlink(path) {
  const absolute = resolve(path), components = absolute.split(sep).filter(Boolean); let current = sep;
  for (const component of components) {
    current = join(current, component);
    try { if ((await lstat(current)).isSymbolicLink()) throw Error("Refusing symbolic link in PDF.js asset path"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}
await noSymlink(cache);await mkdir(cache, { recursive: true, mode: 0o700 });
const archivePath = join(cache, "package.tgz");
let archive;
try {
  await noSymlink(archivePath);const stat = await lstat(archivePath);
  if (!stat.isFile() || stat.size !== lock.archiveSize || stat.size > lock.maximumArchiveBytes) throw Error("Cached PDF.js archive length mismatch");
  archive = await readFile(archivePath);
}
catch (error) {
  if (error.code !== "ENOENT") throw error;
  if (offline) throw Error("PDF.js archive cache missing in offline mode");
  const response = await fetch(lock.archiveUrl, { redirect: "error", signal: AbortSignal.timeout(30_000), credentials: "omit", headers: { accept: "application/octet-stream" } });
  if (!response.ok || !response.body) throw Error("PDF.js archive download failed");
  const reader = response.body.getReader(), chunks = [];let total = 0;
  for (;;) {
    const { done, value } = await reader.read();if (done) break;
    total += value.byteLength;if (total > lock.maximumArchiveBytes) { await reader.cancel();throw Error("PDF.js archive is too large"); }
    chunks.push(value);
  }
  archive = Buffer.concat(chunks);
}
if (archive.length !== lock.archiveSize || archive.length > lock.maximumArchiveBytes) throw Error("PDF.js archive length mismatch");
const expected = Buffer.from(lock.archiveIntegrity.replace(/^sha512-/, ""), "base64"), actual = createHash("sha512").update(archive).digest();
if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw Error("PDF.js archive integrity mismatch");
try { await lstat(archivePath); } catch (error) {
  if (error.code !== "ENOENT") throw error;
  const tmp = join(cache, `.archive-${randomUUID()}`);await writeFile(tmp, archive, { mode: 0o600, flag: "wx" });await rename(tmp, archivePath);
}
const tar = gunzipSync(archive, { maxOutputLength: lock.maximumTarBytes });
const extracted = new Map();
const string = bytes => bytes.toString("utf8").replace(/\0.*$/s, "");
function octal(bytes) { const text = string(bytes).trim();if (!/^[0-7]*$/.test(text)) throw Error("Unsupported tar number");return text ? parseInt(text, 8) : 0; }
for (let at = 0, entries = 0; at + 512 <= tar.length; entries++) {
  if (entries > 2500) throw Error("Too many archive entries");
  const header = tar.subarray(at, at + 512);if (header.every(byte => byte === 0)) break;
  const checksum = octal(header.subarray(148, 156));let calculated = 0;
  for (let n = 0; n < 512; n++) calculated += n >= 148 && n < 156 ? 32 : header[n];
  if (calculated !== checksum) throw Error("Tar header checksum mismatch");
  const prefix = string(header.subarray(345, 500)), name = (prefix ? prefix + "/" : "") + string(header.subarray(0, 100));
  if (name.startsWith("/") || name.includes("\\") || name.split("/").includes("..") || /[\u0000-\u001f]/.test(name)) throw Error("Unsafe archive path");
  const size = octal(header.subarray(124, 136)), type = header[156];
  if (!Number.isSafeInteger(size) || size < 0 || at + 512 + size > tar.length) throw Error("Invalid archive entry size");
  const pinned = lock.files[name];
  if (pinned) {
    if (![0, 48].includes(type) || extracted.has(name) || size !== pinned.size || !/^[a-f0-9]{64}$/.test(pinned.sha256)) throw Error("Unexpected pinned asset entry");
    const bytes = tar.subarray(at + 512, at + 512 + size);
    if (createHash("sha256").update(bytes).digest("hex") !== pinned.sha256) throw Error("PDF.js asset checksum mismatch");
    if (!pinned.path || isAbsolute(pinned.path) || pinned.path.includes("\\") || pinned.path.split("/").some(part => !part || part === "." || part === "..")) throw Error("Unsafe asset destination");
    extracted.set(name, bytes);
  }
  at += 512 + Math.ceil(size / 512) * 512;
}
if (extracted.size !== Object.keys(lock.files).length) throw Error("Pinned PDF.js assets missing");
await noSymlink(destination);await mkdir(destination, { recursive: true, mode: 0o755 });
for (const [name, bytes] of extracted) {
  const target = join(destination, lock.files[name].path);await noSymlink(target);await mkdir(dirname(target), { recursive: true, mode: 0o755 });
  const tmp = join(dirname(target), `.pdfjs-${randomUUID()}`);await writeFile(tmp, bytes, { flag: "wx", mode: 0o644 });await rename(tmp, target);
}
await noSymlink(join(destination, "assets-version.json"));
await writeFile(join(destination, "assets-version.json"), JSON.stringify({ version: lock.version, archiveIntegrity: lock.archiveIntegrity, assets: extracted.size }) + "\n", { mode: 0o644 });
console.log(JSON.stringify({ ok: true, version: lock.version, assets: extracted.size, destination, offline, npmScriptsExecuted: false, pdfJsImportedInNode: false }));
