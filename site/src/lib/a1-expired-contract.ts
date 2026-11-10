export type CloseExpiredA1Intent = { batchId:number; requestId:string; jobId:string; expectedRevision:number; expectedDocumentVersion:string; expectedOwnArtifactId?:string };
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
export function closeExpiredA1Intent(value:unknown):CloseExpiredA1Intent|null {
 if(!value||typeof value!=="object"||Array.isArray(value))return null;
 const v=value as Record<string,unknown>, keys=["batchId","requestId","jobId","expectedRevision","expectedDocumentVersion"], own=Object.hasOwn(v,"expectedOwnArtifactId");
 if(Object.keys(v).sort().join(",")!==[...keys,...(own?["expectedOwnArtifactId"]:[])].sort().join(",") || !Number.isInteger(v.batchId)||Number(v.batchId)<1||Number(v.batchId)>2147483647||!uuid(v.requestId)||!uuid(v.jobId)||!Number.isInteger(v.expectedRevision)||Number(v.expectedRevision)<1||Number(v.expectedRevision)>2147483647||typeof v.expectedDocumentVersion!=="string"||!/^[a-f0-9]{64}$/.test(v.expectedDocumentVersion)||own&&!uuid(v.expectedOwnArtifactId))return null;
 return {batchId:Number(v.batchId),requestId:v.requestId,jobId:v.jobId,expectedRevision:Number(v.expectedRevision),expectedDocumentVersion:v.expectedDocumentVersion,...(own?{expectedOwnArtifactId:v.expectedOwnArtifactId as string}:{})};
}
