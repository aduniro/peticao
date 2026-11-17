/** Trusted offline import. No browser data or new queries to TRT3. */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { saveTrtEvidence,consolidateEvidence } from "../src/lib/ncpf-store";
import { encryptCpfCache } from "../src/lib/cpf-cache-crypto";
import { query,getPool } from "../src/lib/db";
import { hmac } from "../src/lib/security";
async function main() {
const file=process.argv.find(a=>a.startsWith('--input='))?.slice(8);
if(!file || !process.argv.includes('--apply')) throw new Error('explicit --input=PATH --apply required');
const counts={imported:0,changed:0,rejected:0,candidates:0};
try{
 for await(const line of createInterface({input:createReadStream(file),crlfDelay:Infinity})) {
  try{
   if(line.length>24*1024*1024)throw new Error('document_too_large');
   const r=JSON.parse(line),pdf=Buffer.from(r.pdfBase64,'base64');
   const evidence=await saveTrtEvidence({cpf:r.cpf,documentCpf:r.documentCpf,name:r.name,pdf,fetchedAt:r.fetchedAt,origin:r.origin});
   counts.changed+=await consolidateEvidence(evidence);counts.imported++;
   // Also seed pending legacy signups: they must consolidate when email confirmation arrives.
   const rows=(await query<{id:number}>('SELECT id FROM signatures WHERE cpf_hash=$1',[hmac(evidence.cpf)])).rows;
   for(const s of rows) {
    const ins=await query('INSERT INTO ncpf_candidates(signature_id,cpf_hash,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[s.id,hmac(evidence.cpf),encryptCpfCache(evidence.cpf,`ncpf-candidate:${s.id}`)]);
    counts.candidates+=ins.rowCount??0;
   }
  }catch{counts.rejected++;}
 }
 console.log(JSON.stringify(counts));
 if(counts.rejected)process.exitCode=2;
}finally{await getPool().end();}

}
main().catch(()=>{console.error("ncpf_offline_operation_failed");process.exitCode=1;});
