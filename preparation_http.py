"""Modern render-only snapshot assertions; no mutation, approval or signature calls."""
def require(ok,message):
 if not ok:raise RuntimeError('R13 assertion: '+message)
def verify_prepared(seed,snapshot):
 require(seed['readyPdfSeeded']is False and seed['cryptographicClassificationSeeded']is False and seed['emptyDocumentTables']=={'batches':0,'versions':0,'preparations':0},'no prebuilt PDF or batch seed')
 require(snapshot['batches']==1 and snapshot['kind']=='final'and snapshot['status']=='prepared'and snapshot['signatureKind']=='none','actual final prepared baseline state')
 require(snapshot['listHash']==seed['listHash']and snapshot['counts']['signatures']==3 and snapshot['counts']['batch_preparations']==1 and snapshot['counts']['batch_document_versions']==1,'all three confirmed signatures reserved once with exact list hash')
 require(snapshot['snapshotVersion']==2 and snapshot['signaturePreparation']=='a1'and snapshot['preparedSignedNote']==''and snapshot['referencePublished']is False,'modern render-only snapshot, no publication')
 require(snapshot['documentReference']['url']=='https://documents.example.org/api/documentos/referencia/'+snapshot['documentReference']['id'],'separate reference origin canonical URL')
 require(snapshot['counts']['document_references']==1 and all(snapshot['counts'][n]==0 for n in ['batch_a1_jobs','batch_a1_validations','document_reference_bindings']),'no A1 job/validation/publication effects')
 require(snapshot['historyAuthorId']==1 and snapshot['historyRecordedBy']==1 and snapshot['historyVariant']=='original'and snapshot['exactHistoryBytes']is True,'history publication and author')
 require(all(snapshot['counts'][n]==0 for n in ['mail_messages','mail_message_attempts','mail_outbox','batch_sends']),'preparation emits no mail or send')
 return True

