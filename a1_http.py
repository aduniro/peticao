"""Read-only assertions for queued original-mode admission, never worker/signing."""
def verify_admitted(before,after,request_id=None):
 if before['job']is not None or before['counts']['batch_a1_jobs']!=0:raise RuntimeError('empty initial job state required')
 if after['counts']['batch_a1_jobs']!=1 or after['counts']['batch_a1_validations']!=0:raise RuntimeError('exactly one queued admission')
 if any(after['counts'][n]!=0 for n in ['mail_messages','mail_message_attempts','mail_outbox','batch_sends','document_reference_bindings']):raise RuntimeError('no side effects')
 if before['documentFingerprint']!=after['documentFingerprint']:raise RuntimeError('original/preparation/history immutable')
 job=after['job']
 required={'state':'queued','attempts':0,'revision':1,'batchId':1,'documentVersion':before['documentVersion'],'inputArtifactVersionId':before['historyVersionId'],'inputSha256':before['pdfSha256'],'inputByteLength':before['pdfBytes'],'listHash':before['listHash'],'policyRevision':1,'ownArtifactId':None,'outputVersionId':None,'outputSha256':None,'validationReportId':None,'leaseUntil':None}
 if request_id is not None:required['requestId']=request_id
 if not job or any(job.get(k)!=v for k,v in required.items()):raise RuntimeError('queued job bound to exact original')
 if not after.get('jobFingerprint'):raise RuntimeError('job fingerprint required for reload immutability')
 return True
