import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { audit, tx } from "./db";
import { authorizeBatchActor, documentVersion, type ApprovalRow } from "./batches";
import type { SessaoAdmin } from "./admin-users";
import { TEXT_VERSION } from "@/content/peticao";
import { freezeBatchPackage, verifyBatchPackage, type BatchPackageManifest } from "./batch-package-contract";
import { petitionBaseValidationPolicyFingerprint, petitionBaseValidationReady, isCurrentStoredPetitionBaseEvidence, type PetitionBaseValidationBinding } from "./petition-base-validation";
const digest = (v: Buffer | string) => createHash("sha256").update(v).digest("hex");
const id = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v>0 && v<=2147483647;
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const error = (code: "disabled"|"parameters"|"forbidden"|"not_found"|"request_conflict"|"revision_conflict"|"document_conflict"|"selection_conflict"|"validation_required"|"package_invalid"|"package_too_large"|"integrity"|"delivery_started") => ({ok:false as const,error:code});
const enabled = () => process.env.BATCH_PACKAGE_ENABLED === "1" && process.env.GOVBR_BASE_ENABLED === "1" && petitionBaseValidationReady();
function limits() {
 const raw=process.env.BATCH_PACKAGE_MAX_ENCODED_BYTES??String(18*1024*1024);if(!/^[0-9]+$/.test(raw))return null;
 const maxEncodedBytes=Number(raw),reservedEnvelopeBytes=262144;
 return Number.isSafeInteger(maxEncodedBytes)&&maxEncodedBytes>reservedEnvelopeBytes&&maxEncodedBytes<=100*1024*1024?{maxEncodedBytes,reservedEnvelopeBytes}:null;
}
async function authorized(c:PoolClient,actor:SessaoAdmin|null){
 await c.query("SET LOCAL lock_timeout='1000ms';SET LOCAL statement_timeout='5000ms';SELECT pg_advisory_xact_lock(7003)");
 return !!actor?.sessaoId&&await authorizeBatchActor(c,actor)&&!!(await c.query("SELECT 1 FROM admin_sessions WHERE id=$1 AND user_id=$2 AND expira_em>clock_timestamp() AND stepup_ate>clock_timestamp() FOR SHARE",[actor.sessaoId,actor.userId])).rowCount;
}
async function binding(c:PoolClient,artifactId:string):Promise<PetitionBaseValidationBinding|null>{
 const row=(await c.query<{value:string}>("SELECT value FROM settings WHERE key='president_profile_v1' FOR SHARE")).rows[0];if(!row)return null;
 let p;try{p=JSON.parse(row.value);}catch{return null;}
 if(!p||p.version!==1||p.enabled!==true||!id(p.responsibleId)||!id(p.revision)||!hash(p.cpfHash)||!(await c.query("SELECT 1 FROM admin_users WHERE id=$1 AND ativo FOR SHARE",[p.responsibleId])).rowCount)return null;
 return{artifactId,petitionTextVersion:TEXT_VERSION,responsibleId:p.responsibleId,profileRevision:p.revision,expectedSignerCpfHash:p.cpfHash};
}
const boundHash=(b:PetitionBaseValidationBinding)=>digest(JSON.stringify([b.artifactId,b.petitionTextVersion,b.responsibleId,b.profileRevision,b.expectedSignerCpfHash]));
type Row={id:string;batch_id:number;ordinal:number;document_version:string;selection_id:string;base_validation_id:string;base_artifact_id:string;base_sha256:string;batch_version_id:string;batch_sha256:string;manifest:string;package_digest:string;encoded_budget_bytes:number;reserved_envelope_bytes:number;actor_id:number;request_fingerprint:string;created_at:Date};
const project=(r:Row)=>({packageId:r.id,batchId:r.batch_id,ordinal:r.ordinal,documentVersion:r.document_version,selectionId:r.selection_id,baseValidationId:r.base_validation_id,baseArtifactId:r.base_artifact_id,baseSha256:r.base_sha256,batchVersionId:r.batch_version_id,batchSha256:r.batch_sha256,packageDigest:r.package_digest,createdBy:r.actor_id,createdAt:r.created_at.toISOString(),approvalRequired:true as const,dispatchAllowed:false as const});
/** Metadata for the exact actor/batch/request; no gate can turn this read into another preparation. */
export async function getBatchPackageRequest(batchId:number,requestId:string,actor:SessaoAdmin|null){
 if(!id(batchId)||!uuid(requestId))return error('parameters');
 return tx(async c=>{
  if(!await authorized(c,actor))return error('forbidden');
  const row=(await c.query<Row>('SELECT * FROM batch_packages WHERE batch_id=$1 AND actor_id=$2 AND request_id=$3',[batchId,actor!.userId,requestId])).rows[0];if(!row)return error('not_found');
  const batch=(await c.query<ApprovalRow>('SELECT * FROM batches WHERE id=$1',[batchId])).rows[0];
  const latest=(await c.query<{id:string}>('SELECT id FROM batch_packages WHERE batch_id=$1 AND document_version=$2 ORDER BY ordinal DESC LIMIT 1',[batchId,row.document_version])).rows[0];
  return{ok:true as const,requestId,package:project(row),isCurrent:!!batch&&documentVersion(batch)===row.document_version&&latest?.id===row.id};
 });
}
/** Review metadata only. It cannot freeze a package, validate a signature or approve a batch. */
export async function getBatchPackageReview(batchId:number,actor:SessaoAdmin|null){
 if(!id(batchId))return error('parameters');
 return tx(async c=>{
  if(!await authorized(c,actor))return error('forbidden');
  const batch=(await c.query<ApprovalRow>('SELECT * FROM batches WHERE id=$1',[batchId])).rows[0];if(!batch)return error('not_found');
  const version=documentVersion(batch),latest=(await c.query<Row>('SELECT * FROM batch_packages WHERE batch_id=$1 AND document_version=$2 ORDER BY ordinal DESC LIMIT 1',[batchId,version])).rows[0];
  const selected=(await c.query<{id:string;artifact_sha256:string}>('SELECT id,artifact_sha256 FROM petition_base_selections ORDER BY revision DESC LIMIT 1')).rows[0];
  const configured=enabled();
  const approvalReady=configured&&!!latest&&latest.selection_id===selected?.id&&!batch.approved_at&&['prepared','failed'].includes(batch.status)&&batch.signature_kind==='icp-brasil'&&await batchPackageDispatchReadyTx(c,latest.id)&&(await readFrozenBatchPackageTx(c,latest.id)).ok;
  return{ok:true as const,batchId,documentVersion:version,configured,approvalReady,canPrepare:configured&&!!selected&&!batch.approved_at&&['prepared','failed'].includes(batch.status)&&!!batch.pdf&&!!batch.signed_pdf&&batch.signature_kind==='icp-brasil',selectionId:selected?.id??null,selectionSha256:selected?.artifact_sha256??null,latestPackage:latest?project(latest):null};
 });
}
/** Explicit package preparation only. A new version requires CAS and no approval/delivery already started. */
export async function prepareBatchPackage(input:{batchId:number;requestId:string;expectedDocumentVersion:string;expectedSelectionId:string;expectedPackageRevision:number},actor:SessaoAdmin|null){
 if(!enabled())return error('disabled');
 if(!input||Object.keys(input).sort().join(',')!=='batchId,expectedDocumentVersion,expectedPackageRevision,expectedSelectionId,requestId'||!id(input.batchId)||!uuid(input.requestId)||!uuid(input.expectedSelectionId)||!hash(input.expectedDocumentVersion)||!Number.isSafeInteger(input.expectedPackageRevision)||input.expectedPackageRevision<0||input.expectedPackageRevision>=2147483647)return error('parameters');
 const intent={...input},requestFingerprint=digest(JSON.stringify([input.batchId,input.expectedDocumentVersion,input.expectedSelectionId,input.expectedPackageRevision])),budget=limits();if(!budget)return error('disabled');
 return tx(async c=>{
  if(!await authorized(c,actor))return error('forbidden');if(!enabled())return error('disabled');
  const batch=(await c.query<ApprovalRow>('SELECT * FROM batches WHERE id=$1 FOR UPDATE',[intent.batchId])).rows[0];
  const latest=(await c.query<Row>('SELECT * FROM batch_packages WHERE batch_id=$1 AND document_version=$2 ORDER BY ordinal DESC LIMIT 1',[intent.batchId,intent.expectedDocumentVersion])).rows[0];
  const previous=(await c.query<Row>('SELECT * FROM batch_packages WHERE actor_id=$1 AND request_id=$2',[actor!.userId,intent.requestId])).rows[0];
  if(previous)return previous.request_fingerprint===requestFingerprint?{ok:true as const,package:project(previous),isCurrent:previous.id===latest?.id&&!!batch&&documentVersion(batch)===intent.expectedDocumentVersion,replayed:true}:error('request_conflict');
  if((latest?.ordinal??0)!==intent.expectedPackageRevision)return error('revision_conflict');
  if(!batch||!['prepared','failed'].includes(batch.status)||batch.approved_at||!batch.pdf||!batch.signed_pdf||batch.signature_kind!=='icp-brasil'||documentVersion(batch)!==intent.expectedDocumentVersion||digest(batch.pdf)!==batch.pdf_sha256||digest(batch.signed_pdf)!==batch.signed_pdf_sha256)return error('document_conflict');
  if((await c.query('SELECT 1 FROM batch_sends WHERE batch_id=$1 LIMIT 1',[batch.id])).rowCount)return error('delivery_started');
  const signed=(await c.query<{id:string;bytes:Buffer;sha256:string;list_hash:string;signature_kind:string}>(("SELECT id,bytes,sha256,list_hash,signature_kind FROM batch_document_versions WHERE batch_id=$1 AND variant='signed' ORDER BY ordinal DESC LIMIT 1 FOR SHARE"),[batch.id])).rows[0];
  if(!signed||signed.signature_kind!=='icp-brasil'||signed.list_hash!==batch.list_hash||signed.sha256!==batch.signed_pdf_sha256||!signed.bytes.equals(batch.signed_pdf))return error('document_conflict');
  const selected=(await c.query<{id:string;artifact_id:string;artifact_sha256:string;petition_text_version:string;responsible_id:number;profile_revision:number;validator_configuration_sha256:string}>("SELECT * FROM petition_base_selections ORDER BY revision DESC LIMIT 1 FOR SHARE")).rows[0];
  if(!selected||selected.id!==intent.expectedSelectionId)return error('selection_conflict');
  const current=await binding(c,selected.artifact_id),policy=petitionBaseValidationPolicyFingerprint();
  if(!current||!policy||selected.petition_text_version!==TEXT_VERSION||selected.responsible_id!==current.responsibleId||selected.profile_revision!==current.profileRevision||selected.validator_configuration_sha256!==policy)return error('selection_conflict');
  const base=(await c.query<{bytes:Buffer;sha256:string}>('SELECT bytes,sha256 FROM petition_base_artifacts WHERE id=$1 FOR SHARE',[selected.artifact_id])).rows[0];
  if(!base||base.sha256!==selected.artifact_sha256||digest(base.bytes)!==base.sha256)return error('integrity');
  const evidence=(await c.query<{id:string;report:unknown;report_sha256:string;validator_configuration_sha256:string}>("SELECT id,report,report_sha256,validator_configuration_sha256 FROM petition_base_validations WHERE artifact_id=$1 AND binding_sha256=$2 AND validator_configuration_sha256=$3 ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE",[selected.artifact_id,boundHash(current),policy])).rows[0];
  if(!evidence||!isCurrentStoredPetitionBaseEvidence(evidence.report,current,base.sha256,evidence.validator_configuration_sha256,evidence.report_sha256))return error('validation_required');
  const frozen=freezeBatchPackage({batchId:batch.id,documentVersion:intent.expectedDocumentVersion,batch:{versionId:signed.id,sha256:signed.sha256,byteLength:signed.bytes.length},basePetition:{artifactId:selected.artifact_id,versionId:selected.artifact_id,sha256:base.sha256,byteLength:base.bytes.length,validationState:'valid',method:'gov-br-advanced'}});
  if(!frozen.ok)return error('package_invalid');const checked=verifyBatchPackage(frozen.manifest,frozen.packageDigest,new Map([[signed.id,signed.bytes],[selected.artifact_id,base.bytes]]),budget);if(!checked.ok)return error(checked.error==='package_too_large'?'package_too_large':'package_invalid');
  if(!enabled()||petitionBaseValidationPolicyFingerprint()!==policy||JSON.stringify(limits())!==JSON.stringify(budget))return error('disabled');
  const packageId=randomUUID(),ordinal=intent.expectedPackageRevision+1;
  const saved=(await c.query<Row>(`INSERT INTO batch_packages(id,batch_id,ordinal,document_version,previous_package_id,previous_ordinal,selection_id,base_validation_id,base_artifact_id,base_sha256,batch_version_id,batch_sha256,manifest,package_digest,encoded_budget_bytes,reserved_envelope_bytes,actor_id,request_id,request_fingerprint)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,[packageId,batch.id,ordinal,intent.expectedDocumentVersion,latest?.id??null,latest?.ordinal??null,selected.id,evidence.id,selected.artifact_id,base.sha256,signed.id,signed.sha256,frozen.canonical,frozen.packageDigest,budget.maxEncodedBytes,budget.reservedEnvelopeBytes,actor!.userId,intent.requestId,requestFingerprint])).rows[0];
  await audit('batch_package_frozen',null,{packageId,batchId:batch.id,ordinal,documentVersion:intent.expectedDocumentVersion,selectionId:selected.id,baseValidationId:evidence.id,baseArtifactId:selected.artifact_id,baseSha256:base.sha256,batchVersionId:signed.id,batchSha256:signed.sha256,packageDigest:frozen.packageDigest,userId:actor!.userId},c);
  return{ok:true as const,package:project(saved),isCurrent:true,replayed:false};
 });
}
/** Internal exact read. Caller must authorize in the same transaction. Never implies dispatch permission. */
export async function readFrozenBatchPackageTx(c:PoolClient,packageId:string){
 if(!uuid(packageId))return error('parameters');
 const row=(await c.query<Row>('SELECT * FROM batch_packages WHERE id=$1',[packageId])).rows[0];if(!row)return error('not_found');
 let parsed:unknown;try{parsed=JSON.parse(row.manifest);}catch{return error('integrity');}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return error('integrity');const manifest=parsed as BatchPackageManifest;
 if(manifest.batchId!==row.batch_id||manifest.documentVersion!==row.document_version||manifest.batch?.versionId!==row.batch_version_id||manifest.batch?.sha256!==row.batch_sha256||manifest.basePetition?.artifactId!==row.base_artifact_id||manifest.basePetition?.versionId!==row.base_artifact_id||manifest.basePetition?.sha256!==row.base_sha256)return error('integrity');
 const signed=(await c.query<{bytes:Buffer}>('SELECT bytes FROM batch_document_versions WHERE id=$1 AND batch_id=$2 AND variant=$3 AND signature_kind=$4',[row.batch_version_id,row.batch_id,'signed','icp-brasil'])).rows[0],base=(await c.query<{bytes:Buffer}>('SELECT bytes FROM petition_base_artifacts WHERE id=$1',[row.base_artifact_id])).rows[0];
 if(!signed||!base)return error('integrity');const bytes=new Map([[row.batch_version_id,Buffer.from(signed.bytes)],[row.base_artifact_id,Buffer.from(base.bytes)]]);
 if(!verifyBatchPackage(manifest,row.package_digest,bytes,{maxEncodedBytes:row.encoded_budget_bytes,reservedEnvelopeBytes:row.reserved_envelope_bytes}).ok)return error('integrity');
 return{ok:true as const,package:project(row),manifest,bytes};
}
/** Recheck operational policy for a NEW approval/attempt. Historical reads deliberately do not call this. */
export async function batchPackageDispatchReadyTx(c:PoolClient,packageId:string){
 if(!enabled())return false;
 const row=(await c.query<Row>('SELECT * FROM batch_packages WHERE id=$1',[packageId])).rows[0];if(!row)return false;
 const current=await binding(c,row.base_artifact_id),policy=petitionBaseValidationPolicyFingerprint();if(!current||!policy)return false;
 const original=(await c.query<{binding_sha256:string;validator_configuration_sha256:string}>('SELECT binding_sha256,validator_configuration_sha256 FROM petition_base_validations WHERE id=$1',[row.base_validation_id])).rows[0];
 if(!original||original.binding_sha256!==boundHash(current)||original.validator_configuration_sha256!==policy)return false;
 const evidence=(await c.query<{report:unknown;report_sha256:string;validator_configuration_sha256:string}>("SELECT report,report_sha256,validator_configuration_sha256 FROM petition_base_validations WHERE artifact_id=$1 AND binding_sha256=$2 AND validator_configuration_sha256=$3 ORDER BY created_at DESC,id DESC LIMIT 1 FOR SHARE",[row.base_artifact_id,boundHash(current),policy])).rows[0];
 return !!evidence&&isCurrentStoredPetitionBaseEvidence(evidence.report,current,row.base_sha256,evidence.validator_configuration_sha256,evidence.report_sha256)&&enabled()&&policy===petitionBaseValidationPolicyFingerprint();
}
/** Authenticated historical read: resolve the exact frozen pair, never the current base selection. Not permission to send. */
export async function readFrozenBatchPackage(packageId:string,actor:SessaoAdmin|null){
 if(!uuid(packageId))return error('parameters');
 return tx(async c=>{
  if(!await authorized(c,actor))return error('forbidden');const result=await readFrozenBatchPackageTx(c,packageId);if(!result.ok)return result;
  await audit('batch_package_read',null,{packageId,batchId:result.package.batchId,packageDigest:result.package.packageDigest,userId:actor!.userId},c);
  return result;
 });
}
