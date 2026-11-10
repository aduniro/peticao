import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { profiledMailDeliveryStoreSource } from "./mail-delivery-compiled-diagnostic.mjs";
const site="/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site",source=readFileSync(site+"/src/lib/mail-delivery-admin-store.ts","utf8"),trace="/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/mail-delivery-compiled-QA-STATIC/csv-store-profile.jsonl";
test("observability transform keeps all budgets, business SQL, auth and audit code",()=>{
 const out=profiledMailDeliveryStoreSource(source,site,trace);assert.equal(out.replacementCount,9);
 const between=(text,start,end)=>text.split(start)[1].split(end)[0];
 assert.equal(between(source,'const BASE_CTE =','async function preflight'),between(out.source,'const BASE_CTE =','async function preflight'));
 assert.equal(between(source,'async function authorize(','/** A source row'),between(out.source,'async function authorize(','/** A source row'));
 assert.equal(source.slice(source.indexOf('export async function auditMailDeliveryExport(')),out.source.slice(out.source.indexOf('export async function auditMailDeliveryExport(')));
 for(const guard of['SOURCE_BYTES = 128 * 1024 * 1024','JSON_BYTES = 16 * 1024 * 1024','EXPORT_BYTES = 64 * 1024 * 1024','DEADLINE_MS = 10_000','throw new Error("delivery_export_contact_unavailable")','throw new Error("delivery_export_budget")'])assert.ok(out.source.includes(guard));
 assert.ok(!/from ["'](?:@|\.\/)/.test(out.source));assert.ok(!out.source.includes('console.log'));
 const ts=createRequire(import.meta.url)("/home/barre/.cache/peticao-admin-deps-preview-v1/node_modules/typescript/lib/typescript.js");
 const compiled=ts.transpileModule(out.source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext},reportDiagnostics:true,fileName:"qa-profile.ts"});assert.deepEqual(compiled.diagnostics,[]);
});
test("changed store or unsafe trace location fails closed instead of silently weakening instrumentation",()=>{
 assert.throws(()=>profiledMailDeliveryStoreSource(source.replace('const SOURCE_BYTES =','const CHANGED_BYTES ='),site,trace));
 assert.throws(()=>profiledMailDeliveryStoreSource(source,site,"/tmp/unrelated.jsonl"));
});
