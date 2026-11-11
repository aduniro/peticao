// Narrow Node-level smoke guard. This is not OS-level network isolation.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { appendFileSync, realpathSync, statSync } from "node:fs";
import net from "node:net";
import dns from "node:dns";
import tls from "node:tls";
import dgram from "node:dgram";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

const root = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");
const run = process.env.RUNTIME_SMOKE_RUN;
assert.ok(run?.startsWith(root + "/runs/"));
assert.equal(realpathSync(run), run);
assert.equal(statSync(run).uid, process.getuid());
assert.equal(statSync(run).mode & 0o077, 0);
assert.equal(process.env.NODE_ENV, "production");
assert.equal(process.env.PREVIEW_MODE, undefined);
assert.equal(process.env.ADMIN_NO_PASSWORD, undefined);
assert.equal(process.env.DATABASE_URL, "postgres://fixture_only:fixture_only@127.0.0.1:55485/fixture_only");
assert.equal(process.env.FUNCTIONAL_PGDATA, run + '/postgres');
assert.equal(process.env.MAIL_PROVIDER, "dev");
assert.equal(process.env.MAIL_PROVIDERS, "dev");
assert.equal(process.env.CRON_SECRET, "");
assert.equal(process.env.WHATSAPP_ENABLED, "0");
assert.equal(process.env.RECIPIENTS, "");
assert.equal(process.env.APPROVER_EMAIL, "");
assert.equal(process.env.SIGNER, "none");
for (const key of ["HOME", "SECRETS_DIR", "PETICAO_CONFIG_DIR", "CREDENTIALS_DIRECTORY", "GEO_DIR"])
  assert.equal(process.env[key], run + "/empty");
const port = Number(process.env.RUNTIME_SMOKE_PORT);
assert.ok(Number.isInteger(port) && port >= 31000 && port <= 31999);
const record = (kind, transport) => appendFileSync(run + "/guard.jsonl", JSON.stringify({ kind, transport, pid: process.pid }) + "\n", { mode: 0o600 });
const deny = transport => { record("denied", transport); throw Error("RUNTIME_SMOKE_FORBIDDEN:" + transport); };
for (const target of [dns, dns.promises]) for (const key of Object.keys(target))
  if (key.startsWith("resolve") || ["reverse", "lookup", "lookupService"].includes(key)) target[key] = () => deny("dns");
// Node calls lookup even when binding an explicit numeric address. Resolve this
// one literal locally, without invoking the operating system resolver.
dns.lookup = (host, options, callback) => {
  if (host !== "127.0.0.1") return deny("dns");
  const cb = typeof options === "function" ? options : callback;
  assert.equal(typeof cb, "function");
  process.nextTick(() => options?.all ? cb(null, [{ address: host, family: 4 }]) : cb(null, host, 4));
};
for (const Constructor of [dns.Resolver, dns.promises.Resolver]) {
  for (let p = Constructor.prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const key of Object.getOwnPropertyNames(p)) if (key.startsWith("resolve") || key === "reverse") p[key] = () => deny("dns_resolver");
  }
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let v=args[0]; if(Array.isArray(v))v=v[0];
  const selectedPort=v&&typeof v==='object'?v.port:v;
  const selectedHost=v&&typeof v==='object'?v.host:args[1];
  if(Number(selectedPort)!==55485||selectedHost!=="127.0.0.1") return deny("tcp_outside_fixture");
  record("connect","fixture_database");return connect.apply(this,args);
};
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  const value = args[0];
  const selectedPort = value && typeof value === "object" ? value.port : value;
  const selectedHost = value && typeof value === "object" ? value.host : args[1];
  if (Number(selectedPort) !== port || selectedHost !== "127.0.0.1") return deny("listener_outside_reserved_loopback");
  record("listen", "reserved_loopback");
  return listen.apply(this, args);
};
tls.connect = () => deny("tls");
dgram.Socket.prototype.send = () => deny("udp");
dgram.Socket.prototype.bind = () => deny("udp_listener");
globalThis.fetch = () => deny("fetch");
for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) cp[key] = () => deny("child_process");
syncBuiltinESMExports();
record("installed", "node_only_no_egress_reserved_loopback");
