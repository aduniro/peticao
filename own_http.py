"""Own effect and original invariants only; no transport or mutations."""
def verify_own_state(seed,before,after):
 def require(ok,label):
  if not ok:raise RuntimeError('R14 assertion: '+label)
 require(seed['identityPreconditionSeeded']is True and seed['externalIdentityVerified']is False and seed['ownArtifactsSeeded']==0,'explicit synthetic identity only')
 require(after['sourceFingerprint']==before['sourceFingerprint'] and after['originalSha256']==seed['originalSha256'],'original batch unchanged')
 c=after['counts'];a=after['artifact']
 require(all(c[n]==1 for n in ['president_own_document_intents','president_own_document_results','president_own_document_artifacts']),'one immutable own effect')
 require(a and a['receiptId']==seed['receiptId'] and a['documentVersion']==seed['documentVersion'] and a['sourceSha256']==seed['originalSha256'] and a['createdBy']==1 and a['source']=='president-own' and a['sha256']!=seed['originalSha256'],'own provenance')
 require(all(c[n]==0 for n in ['batch_document_versions','batch_a1_jobs','batch_a1_validations','president_own_a1_inputs','mail_messages','mail_message_attempts','mail_outbox','batch_sends']),'no source history mutation signing approval or mail')
 return True
