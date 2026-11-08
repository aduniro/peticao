// Test harness only; no application source is changed.
import { promises as dns } from "node:dns";
dns.resolveMx = async domain => domain.endsWith(".invalid") ? [] : [{ exchange: "mx.lab.invalid", priority: 10 }];
const original = globalThis.fetch;
const consumed = new Set();
globalThis.fetch = async (input, init) => {
  const address = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(address);
  if (url.hostname === "challenges.cloudflare.com") {
    const token = new URLSearchParams(init?.body).get("response") ?? "";
    const valid = token.startsWith("valid-") && !consumed.has(token);
    consumed.add(token);
    return new Response(JSON.stringify({ success: valid }), { headers: { "content-type": "application/json" } });
  }
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("LAB_EXTERNAL_NETWORK_BLOCKED");
  }
  return original(input, init);
};
