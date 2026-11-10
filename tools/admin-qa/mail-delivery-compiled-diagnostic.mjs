/** QA-only observability transform. Never imports/runs a store or relaxes a budget. */
import assert from "node:assert/strict";
import { resolve } from "node:path";
export function profiledMailDeliveryStoreSource(input, site, tracePath) {
  assert.equal(site,"/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site");
  assert.ok(tracePath.startsWith(site+"/../")===false&&tracePath.startsWith("/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/mail-delivery-compiled-"));
  let source=input;const replacements=[];
  const replace=(before,after)=>{assert.equal(source.split(before).length-1,1,"diagnostic source marker changed");source=source.replace(before,after);replacements.push(before);};
  source=source.replace(/from (["'])(@\/lib\/[^"']+|\.\/[^"']+)\1/g,(_all,_quote,name)=>{
    const path=name.startsWith("@/lib/")?resolve(site,"src/lib",name.slice(6)):resolve(site,"src/lib",name.slice(2));
    assert.ok(path.startsWith(site+"/src/lib/"));return "from "+JSON.stringify(path+".ts");
  });
  assert.ok(!/from ["'](?:@|\.\/)/.test(source));
  source='import { appendFileSync as __qaAppend } from "node:fs";\n'+source;
  const declaration=`\nconst __qaTrace=(phase:string,fields:Record<string,unknown>={})=>{__qaAppend(${JSON.stringify(tracePath)},JSON.stringify({phase,...fields})+"\\n",{mode:0o600});};\nconst __qaFailure=(error:unknown)=>{const e=error as {name?:unknown;message?:unknown;code?:unknown};return{errorName:typeof e?.name==="string"&&/^[A-Za-z]{1,40}$/.test(e.name)?e.name:"Error",errorCode:typeof e?.code==="string"&&/^[A-Z0-9_]{1,40}$/.test(e.code)?e.code:null,internalReason:typeof e?.message==="string"&&/^(?:delivery_|invalid_delivery_|incomplete_delivery_|duplicate_delivery_)[a-z_]+$/.test(e.message)?e.message:"redacted"};};\n`;
  replace('const SOURCE_BYTES =',declaration+'const SOURCE_BYTES =');
  replace('if (count(base.bytes) > SOURCE_BYTES)', '__qaTrace("preflight_base",{elapsedMs:performance.now()-start,records:count(base.total),bytes:count(base.bytes),budget:SOURCE_BYTES});\n  if (count(base.bytes) > SOURCE_BYTES)');
  replace('if (count(base.bytes) + count(history.bytes) > SOURCE_BYTES)', '__qaTrace("preflight_history",{elapsedMs:performance.now()-start,bytes:count(base.bytes)+count(history.bytes),budget:SOURCE_BYTES});\n  if (count(base.bytes) + count(history.bytes) > SOURCE_BYTES)');
  replace('const expected = await preflight(c, start), raw = (await c.query(READ_SQL, [provider ?? null])).rows; checkpoint(start);','const expected = await preflight(c, start); __qaTrace("source_before_query",{elapsedMs:performance.now()-start,expected});\n  const raw = (await c.query(READ_SQL, [provider ?? null])).rows; __qaTrace("source_after_query",{elapsedMs:performance.now()-start,expected,rows:raw.length}); checkpoint(start);');
  replace('if (raw.length !== expected || Buffer.byteLength(JSON.stringify(raw), "utf8") > SOURCE_BYTES)', 'const __qaRawBytes=Buffer.byteLength(JSON.stringify(raw),"utf8"); __qaTrace("source_json_bytes",{elapsedMs:performance.now()-start,bytes:__qaRawBytes,budget:SOURCE_BYTES});\n  if (raw.length !== expected || __qaRawBytes > SOURCE_BYTES)');
  replace('const rows = raw.map(r => { checkpoint(start); return project(r, provider); });','const rows = raw.map(r => { checkpoint(start); return project(r, provider); });\n  __qaTrace("projection_complete",{elapsedMs:performance.now()-start,rows:rows.length,contactStates:rows.reduce<Record<string,number>>((acc,r)=>{const k=r.evidence.contactState;acc[k]=(acc[k]??0)+1;return acc;},{})});');
  const start=source.indexOf('export async function readMailDeliveryExport('),end=source.indexOf('export async function auditMailDeliveryExport(');assert.ok(start>0&&end>start);
  let segment=source.slice(start,end);
  const change=(before,after)=>{assert.equal(segment.split(before).length-1,1,"diagnostic export marker changed");segment=segment.replace(before,after);replacements.push(before);};
  change('if (rows.some(r => r.evidence.contactState === "unavailable"))', '__qaTrace("export_availability",{elapsedMs:performance.now()-start,rows:rows.length,unavailable:rows.filter(r=>r.evidence.contactState==="unavailable").length});\n    if (rows.some(r => r.evidence.contactState === "unavailable"))');
  change('if (Buffer.byteLength(JSON.stringify(result), "utf8") > EXPORT_BYTES)', 'const __qaExportBytes=Buffer.byteLength(JSON.stringify(result),"utf8");__qaTrace("export_json_bytes",{elapsedMs:performance.now()-start,bytes:__qaExportBytes,budget:EXPORT_BYTES});\n    if (__qaExportBytes > EXPORT_BYTES)');
  change('} catch { return fail("unavailable"); }','} catch (error) { __qaTrace("export_failure",__qaFailure(error));return fail("unavailable"); }');
  source=source.slice(0,start)+segment+source.slice(end);
  assert.ok(source.includes("DEADLINE_MS = 10_000")&&source.includes("EXPORT_BYTES = 64 * 1024 * 1024"));
  return {source,replacementCount:replacements.length};
}
