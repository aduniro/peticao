import { readFileSync } from "node:fs";
import { cf, conta, kvId, DOMINIO, ENDERECO, DONO } from "./lib.mjs";
const z = await conta(); const acc = z.account.id;
let kv = await kvId(acc);
if (!kv) { const r = await cf(`/accounts/${acc}/storage/kv/namespaces`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "ponte-caixa" }) }); console.log("KV:", r.success, JSON.stringify(r.errors ?? "")); kv = r.result?.id; }
console.log("namespace KV:", kv ? "ok" : "FALHOU");
const meta = { main_module: "worker.mjs", compatibility_date: "2025-01-01", bindings: [{ type: "kv_namespace", name: "CAIXA", namespace_id: kv }] };
const fd = new FormData();
fd.set("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
fd.set("worker.mjs", new Blob([readFileSync(new URL("./worker.mjs", import.meta.url), "utf8")], { type: "application/javascript+module" }), "worker.mjs");
const up = await cf(`/accounts/${acc}/workers/scripts/ponte-entrada`, { method: "PUT", body: fd });
console.log("worker:", up.success, JSON.stringify(up.errors ?? "").slice(0, 200));
const regras = (await cf(`/zones/${z.id}/email/routing/rules?per_page=100`)).result ?? [];
if (regras.some((x) => x.matchers?.some((m) => m.value === ENDERECO))) console.log("regra já existe");
else { const r = await cf(`/zones/${z.id}/email/routing/rules`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "ponte de aprovação (Worker)", enabled: true, matchers: [{ type: "literal", field: "to", value: ENDERECO }], actions: [{ type: "worker", value: ["ponte-entrada"] }] }) }); console.log("regra:", r.success, JSON.stringify(r.errors ?? "").slice(0, 200)); }
console.log("endereço da ponte:", ENDERECO, "| dono:", DONO);
