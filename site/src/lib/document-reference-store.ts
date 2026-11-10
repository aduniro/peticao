import { randomUUID, createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { audit, tx } from "./db";
import { documentReferenceUrl, validDocumentReference } from "./document-reference-contract";
const validId=(id:number)=>Number.isInteger(id)&&id>0&&id<=2147483647;
const hash=(s:string)=>typeof s==="string"&&/^[a-f0-9]{64}$/.test(s);
const digest=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");

/** Called inside authorized batch creation, before frozen rendering. No HTTP input origin. */
export async function reserveDocumentReferenceTx(c:PoolClient,batchId:number,createdBy:number|null) {
 if(process.env.DOCUMENT_REFERENCE_ENABLED!=="1") return null;
 if(!validId(batchId)||createdBy!==null&&!validId(createdBy)) throw new Error("invalid_document_reference");
 const origin=process.env.DOCUMENT_REFERENCE_ORIGIN??"";
 const id=randomUUID(),url=documentReferenceUrl(origin,id);
 if(!url) throw new Error("document_reference_origin_invalid");
 const batch=(await c.query("SELECT status,pdf,signed_pdf,approved_at FROM batches WHERE id=$1 FOR UPDATE",[batchId])).rows[0];
 if(!batch||batch.status!=="preparing"||batch.pdf||batch.signed_pdf||batch.approved_at) throw new Error("document_reference_reservation_closed");
 const previous=(await c.query<{id:string;origin:string}>("SELECT id,origin FROM document_references WHERE batch_id=$1",[batchId])).rows[0];
 if(previous){if(previous.origin!==origin) throw new Error("document_reference_origin_changed");return {id:previous.id,url:documentReferenceUrl(previous.origin,previous.id)!};}
 await c.query("INSERT INTO document_references(id,batch_id,origin,created_by) VALUES($1,$2,$3,$4)",[id,batchId,origin,createdBy]);
 await audit("document_reference_reserved",null,{referenceId:id,batchId,userId:createdBy},c);
 return {id,url};
}

/** Internal publication transaction: caller already checked Total/session/stepup and exact approval. */
export async function bindDocumentReferenceTx(c:PoolClient,versionId:string,sha256:string,boundBy:number) {
 if(!validDocumentReference(versionId)||!hash(sha256)||!validId(boundBy)) throw new Error("invalid_document_reference_binding");
 const row=(await c.query<{reference_id:string;version_id:string;bytes:Buffer;sha256:string;pdf:Buffer;signed_pdf:Buffer|null;approved_at:string|null;status:string;variant:string}>(`SELECT r.id reference_id,v.id version_id,v.bytes,v.sha256,v.variant,b.pdf,b.signed_pdf,b.approved_at,b.status
 FROM document_references r JOIN batch_document_versions v ON v.batch_id=r.batch_id JOIN batches b ON b.id=r.batch_id
 WHERE v.id=$1 FOR UPDATE OF b`,[versionId])).rows[0];
 if(!row) return {ok:true as const,bound:false as const}; // Historical PDFs have no reserved reference.
 if(!Buffer.isBuffer(row.pdf)||!row.approved_at||!["prepared","failed","sent"].includes(row.status)||row.sha256!==sha256||digest(row.bytes)!==sha256||!row.bytes.equals(row.signed_pdf??row.pdf)||row.variant!==(row.signed_pdf?"signed":"original")) return {ok:false as const,error:"reference_ineligible" as const};
 const existing=(await c.query<{version_id:string;sha256:string}>("SELECT version_id,sha256 FROM document_reference_bindings WHERE reference_id=$1",[row.reference_id])).rows[0];
 if(existing) return existing.version_id===versionId&&existing.sha256===sha256?{ok:true as const,bound:true as const,existing:true as const}:{ok:false as const,error:"reference_already_bound" as const};
 await c.query("INSERT INTO document_reference_bindings(reference_id,version_id,sha256,bound_by) VALUES($1,$2,$3,$4)",[row.reference_id,versionId,sha256,boundBy]);
 await audit("document_reference_bound",null,{referenceId:row.reference_id,versionId,sha256,userId:boundBy},c);
 return {ok:true as const,bound:true as const,existing:false as const};
}

/** Caller still MUST apply publicDocumentVerification: a binding grants no publication. */
export async function resolveDocumentReference(referenceId:string) {
 if(process.env.DOCUMENT_VERIFICATION_PUBLIC!=="1"||process.env.DOCUMENT_REFERENCE_ENABLED!=="1"||!validDocumentReference(referenceId)) return null;
 return tx(async c=>{
  await c.query("SET LOCAL statement_timeout='2000ms'");
  const r=(await c.query<{version_id:string;sha256:string}>("SELECT version_id,sha256 FROM document_reference_bindings WHERE reference_id=$1",[referenceId])).rows[0];
  return r?{versionId:r.version_id,sha256:r.sha256}:null;
 });
}

/** Snapshot and durable reservation must agree at claim and finish, including legacy absence. */
export async function snapshotReferenceMatchesTx(c:PoolClient,batchId:number,reference:unknown) {
 const row=(await c.query<{id:string;origin:string}>("SELECT id,origin FROM document_references WHERE batch_id=$1 FOR SHARE",[batchId])).rows[0];
 if(!row) return reference===undefined;
 if(!reference||typeof reference!=="object"||Object.keys(reference).sort().join(",")!=="id,url") return false;
 const r=reference as {id:string;url:string};
 return r.id===row.id&&r.url===documentReferenceUrl(row.origin,row.id);
}
