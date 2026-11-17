import { signatureExplorerSearch, type SignatureExplorerOptions, type SignatureExplorerResult } from "./signature-explorer-admin-contract";
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, fields: string) => Object.keys(v).sort().join(",") === fields.split(",").sort().join(",");
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const text = (v: unknown): v is string => typeof v === "string" && v.length <= 4096 && !v.includes("\u0000");
const countObject = (v: unknown, fields: string): v is Record<string, number> => object(v) && keys(v, fields) && Object.values(v).every(count);
const facetKeys = ["categoria","instituicao","cargo","campus","regiao","uf","cidade","pais","universidade","status","cpf","whatsapp"];
/** Response is checked against the exact page requested and the server-issued contact capability. */
export function parseSignatureExplorerResult(value: unknown, options: SignatureExplorerOptions): SignatureExplorerResult | null {
  if (!object(value) || !keys(value,"ok,asOf,capabilities,coverage,total,linhas,pontos,facetas,totais,semLocal,pagina,limite") || value.ok !== true || typeof value.asOf !== "string" || value.asOf.length > 35 || !/^\d{4}-\d\d-\d\dT/.test(value.asOf) || !Number.isFinite(Date.parse(value.asOf)) || value.pagina !== options.page || value.limite !== options.limit || !count(value.total) || !count(value.semLocal) || value.semLocal > value.total || !object(value.capabilities) || !keys(value.capabilities,"contacts") || typeof value.capabilities.contacts !== "boolean" || !object(value.coverage) || !keys(value.coverage,"matched,totalRowsReturned,facetsComplete,mapComplete,complete") || value.coverage.matched !== value.total || value.coverage.facetsComplete !== true || value.coverage.mapComplete !== true || value.coverage.complete !== true || !Array.isArray(value.linhas) || value.linhas.length > options.limit || value.coverage.totalRowsReturned !== value.linhas.length || value.linhas.length > value.total || value.linhas.length !== Math.min(options.limit,Math.max(0,value.total-(options.page-1)*options.limit)) || !Array.isArray(value.pontos) || !object(value.facetas) || !Object.keys(value.facetas).every(k => facetKeys.includes(k)) || !["instituicao","cargo","campus","pais","universidade","uf","cidade"].every(k => Object.hasOwn(value.facetas as object,k)) || !countObject(value.totais,"confirmadas,pendentes,servidores,apoiadores,estrangeiros,cpfConferido")) return null;
  if (value.totais.confirmadas + value.totais.pendentes !== value.total || value.totais.servidores + value.totais.apoiadores + value.totais.estrangeiros !== value.total || value.totais.cpfConferido > value.total) return null;
  const ids = new Set<number>();
  for (const row of value.linhas) {
    if (!object(row) || !keys(row,"id,nome,categoria,instituicao,cargo,regiao,campus,cidadeUf,pais,status,criada,confirmada,cpf,whatsapp,waConfirmado") || !Number.isInteger(row.id) || (row.id as number) < 1 || (row.id as number) > 2147483647 || ids.has(row.id as number) || !["nome","categoria","instituicao","cargo","regiao","campus","cidadeUf","pais","status","criada","whatsapp"].every(k => text(row[k])) || !["servidor","apoiador","estrangeiro"].includes(String(row.categoria)) || !["pending","confirmed"].includes(String(row.status)) || row.confirmada !== null && !text(row.confirmada) || typeof row.cpf !== "boolean" || typeof row.waConfirmado !== "boolean" || !value.capabilities.contacts && row.whatsapp !== "") return null;
    ids.add(row.id as number);
  }
  let mapped = 0;const pointKeys = new Set<string>();
  for (const point of value.pontos) {
    if (!object(point) || !keys(point,"chave,lat,lon,nome,uf,conf,pend,por") || !text(point.chave) || pointKeys.has(point.chave) || !text(point.nome) || !text(point.uf) || typeof point.lat !== "number" || !Number.isFinite(point.lat) || point.lat < -90 || point.lat > 90 || typeof point.lon !== "number" || !Number.isFinite(point.lon) || point.lon < -180 || point.lon > 180 || !count(point.conf) || !count(point.pend) || !object(point.por) || !Object.keys(point.por).every(k => ["servidor","apoiador","estrangeiro"].includes(k))) return null;
    let conf = 0, pend = 0;for (const category of Object.values(point.por)) { if (!countObject(category,"conf,pend")) return null;conf += category.conf;pend += category.pend; }
    if (conf !== point.conf || pend !== point.pend) return null;mapped += point.conf + point.pend;pointKeys.add(point.chave);
  }
  if (mapped + value.semLocal !== value.total) return null;
  for (const facets of Object.values(value.facetas)) {
    if (!Array.isArray(facets)) return null;const seen = new Set<string>();
    for (const facet of facets) { if (!object(facet) || !keys(facet,facet.rotulo === undefined ? "v,n" : "v,n,rotulo") || !text(facet.v) || seen.has(facet.v) || !count(facet.n) || facet.rotulo !== undefined && !text(facet.rotulo)) return null;seen.add(facet.v); }
  }
  return value as unknown as SignatureExplorerResult;
}
export type ExplorerRead = { ok: true; data: SignatureExplorerResult } | { ok: false; kind: "invalid" | "http" | "uncertain" | "aborted"; status?: number };
/** One debounced query corresponds to one bounded GET; cleanup aborts without retry. */
export async function readSignatureExplorer(params: URLSearchParams, signal?: AbortSignal, transport: typeof fetch = fetch, timeoutMs = 15_000): Promise<ExplorerRead> {
  const parsed = signatureExplorerSearch(params);if (!parsed.ok || parsed.options.format !== "json") return { ok: false, kind: "invalid" };if (signal?.aborted) return { ok: false, kind: "aborted" };
  const controller = new AbortController();let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, timer: ReturnType<typeof setTimeout> | undefined, resolveAbort: ((value: ExplorerRead) => void) | undefined;
  const abort = () => { controller.abort();void reader?.cancel().catch(() => {});resolveAbort?.({ ok: false, kind: "aborted" }); };
  const aborted = new Promise<ExplorerRead>(resolve => { resolveAbort = resolve; });signal?.addEventListener("abort",abort,{once:true});
  const work = async (): Promise<ExplorerRead> => {
    try {
      const response = await transport(`/api/admin/assinaturas/explorar?${params}`,{method:"GET",credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",headers:{accept:"application/json"},signal:controller.signal});
      if (!response.ok) { void response.body?.cancel().catch(() => {});return {ok:false,kind:"http",status:response.status}; }
      const length = response.headers.get("content-length"), max = 32 * 1024 * 1024;
      if (!response.body || (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "application/json" || length !== null && (!/^\d+$/.test(length) || Number(length) > max)) { void response.body?.cancel().catch(() => {});return {ok:false,kind:"invalid"}; }
      reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
      for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>max){void reader.cancel().catch(()=>{});return{ok:false,kind:"invalid"};}chunks.push(part.value);}
      const bytes=new Uint8Array(size);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.byteLength;}
      const value:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)),data=parseSignatureExplorerResult(value,parsed.options);return data?{ok:true,data}:{ok:false,kind:"invalid"};
    }catch{return{ok:false,kind:signal?.aborted?"aborted":"uncertain"};}finally{try{reader?.releaseLock();}catch{/* cancelled reader */}}
  };
  try{return await Promise.race([work(),aborted,new Promise<ExplorerRead>(resolve=>{timer=setTimeout(()=>{controller.abort();void reader?.cancel().catch(()=>{});resolve({ok:false,kind:"uncertain"});},Math.max(1,Math.min(30000,timeoutMs)));})]);}
  finally{if(timer!==undefined)clearTimeout(timer);signal?.removeEventListener("abort",abort);}
}
