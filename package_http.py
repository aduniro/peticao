"""Fixed reviewed HTTP protocol. No automatic POST retries and no OTP/cookie export."""
from pathlib import Path
import concurrent.futures,hashlib,json,re,stat,urllib.parse,uuid

def require(ok,label):
 if not ok:raise RuntimeError('R9 assertion: '+label)
def spool_state(run):
 root=run/'mail-outbox';out={}
 for p in root.iterdir():
  require(not p.is_symlink()and p.is_file()and stat.S_IMODE(p.stat().st_mode)==0o600 and p.stat().st_uid==root.stat().st_uid,'private own spool metadata')
  require(p.suffix=='.json'and p.stat().st_size<1024*1024,'bounded spool JSON')
  out[p.name]=hashlib.sha256(p.read_bytes()).hexdigest()
 return out

def approval_otp(run,before):
 after=spool_state(run);new=set(after)-set(before);require(len(new)==1,'one approval spool file')
 p=run/'mail-outbox'/next(iter(new));value=json.loads(p.read_text());require(value['to']=='qa-approver@example.test'and not value.get('attachments'),'approval destination')
 match=re.search(r': (\d{6})$',value['subject']);require(match is not None,'approval subject protocol')
 return match[1]

def verify_sent_batch(snapshot,batch_id):
 rows=[v for v in snapshot['batches']if v['id']==batch_id]
 require(len(rows)==1 and rows[0]['status']=='sent' and rows[0]['sent_at']is not None and rows[0]['approval_code_hash']is None,'sent batch timestamp and consumed code')
 sends=[v for v in snapshot['sends']if v['batch_id']==batch_id]
 require(len(sends)==1 and sends[0]['ok']is True,'exactly one accepted recipient after dispatch')
 return True

def verify_reconciled_state(decision,snapshot,batch_id):
 # f555 counts one INSERT batch_sends plus one transition prepared→sent.
 require(decision.get('ok')is True and decision.get('complete')is True and decision.get('updated')==2,'reconciliation decision inserts recipient and transitions batch')
 return verify_sent_batch(snapshot,batch_id)

def verify_document_preservation(before,after):
 expected={'batches','batch_document_versions','batch_packages','petition_base_artifacts','petition_base_validations','petition_base_selections'}
 require(isinstance(before,dict)and isinstance(after,dict)and set(before)==expected and set(after)==expected,'complete immutable byte fingerprint inventory')
 require(all(isinstance(v,str)and re.fullmatch('[a-f0-9]{64}',v)for v in [*before.values(),*after.values()]),'valid byte fingerprints')
 require(before==after,'document bytes and immutable rows changed')
 return True

def exercise(run,request,check,fixture,seed):
 records=[];markers=[];immutable_before=fixture('snapshot')['documentByteFingerprints']
 def observe(label,ok):require(ok,label);records.append(label)
 def post(label,batch,kind,values,cookie,expect=303):
  return check(label,'POST',f'/api/admin/lotes/{batch}/{kind}',expect,urllib.parse.urlencode(values),cookie)
 def login(email,password,label):
  _,h=check(label,'POST','/api/admin/login',303,urllib.parse.urlencode({'email':email,'password':password}));cookie=h.get('set-cookie','').split(';')[0]
  require(cookie.startswith('adm=')and 'Secure' in h.get('set-cookie','')and 'HttpOnly' in h.get('set-cookie','')and 'SameSite=strict' in h.get('set-cookie',''),'unchanged secure session cookie');markers.append(cookie);return cookie
 def row(snapshot,n):return next(v for v in snapshot['batches']if v['id']==n)
 def intent(n):
  v=next(v for v in seed['packages']if v['batchId']==n)
  return {'requestId':str(uuid.uuid4()),'expectedDocumentVersion':v['documentVersion'],'expectedPackageId':v['packageId'],'expectedPackageDigest':v['packageDigest']}
 check('unauthenticated code','POST','/api/admin/lotes/1/codigo',401,'requestId='+str(uuid.uuid4()))
 owner=login('owner@fixture.invalid','Fixture-Only-92837465','owner login')
 post('stepup required',1,'codigo',intent(1),owner,403)
 fixture('stepup-fixture')
 reader=login('reader@fixture.invalid','Fixture-Reader-92837465','reader login');fixture('stepup-fixture')
 post('reader code refused',1,'codigo',intent(1),reader,403)
 initial=spool_state(run);require(not initial,'initial spool empty')
 for label,values in [('missing intent',{}),('unknown field',{'requestId':str(uuid.uuid4()),'extra':'x'}),('duplicate field',[('requestId',str(uuid.uuid4())),('requestId',str(uuid.uuid4()))])]:post(label,1,'codigo',values,owner,400)
 observe('invalid and unauthorized forms create no spool',spool_state(run)==initial and fixture('snapshot')['counts']['mail_messages']==0)
 i1=intent(1);_,h=post('request code package one',1,'codigo',i1,owner)
 require('Código enviado ao aprovador.'==urllib.parse.parse_qs(urllib.parse.urlsplit(h.get('location','')).query).get('msg',[None])[0],'303 is explicit success message')
 code1=approval_otp(run,initial);markers.append(code1);before=fixture('snapshot');spool_before=spool_state(run)
 wrong='000000'if code1!='000000'else'111111';post('incorrect code',1,'aprovar',{'code':wrong},owner)
 wrong_state=fixture('snapshot');observe('incorrect code increments once without approval or dispatch',row(wrong_state,1)['approval_attempts']==1 and row(wrong_state,1)['approved_at']is None and wrong_state['counts']['batch_sends']==0 and spool_state(run)==spool_before)
 post('same code intent replay',1,'codigo',i1,owner);again=fixture('snapshot')
 keys=['approval_code_hash','approval_code_expires_at','approval_attempts']
 observe('same intent preserves code expiry and guesses without new mail',all(row(again,1)[k]==row(wrong_state,1)[k]for k in keys)and again['counts']==wrong_state['counts']and spool_state(run)==spool_before)
 def approve_once(index):
  status,body,headers=request('POST','/api/admin/lotes/1/aprovar',urllib.parse.urlencode({'code':code1}),owner)
  require(status==303,'concurrent approval response');return {'check':'concurrent approval '+str(index),'method':'POST','path':'/api/admin/lotes/1/aprovar','status':status,'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()}
 with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:concurrent_results=list(pool.map(approve_once,[1,2]))
 # Both calls were deliberate, distinct race participants. Never repeat after uncertain response.
 after=fixture('snapshot');observe('concurrent approval consumes once and sends one package',after['counts']['batch_sends']==1 and len([v for v in after['messages']if v['kind']=='lote'and v['status']=='accepted'])==1 and row(after,1)['approved_at']is not None and len(spool_state(run))==2 and verify_sent_batch(after,1))
 verified=fixture('verify-attachments');observe('first archived envelope has both exact PDFs',len(verified['verified'])==1 and verified['verified'][0]['batchId']==1 and verified['verified'][0]['exactBytes'])
 before_replay=spool_state(run);post('consumed approval replay',1,'aprovar',{'code':code1},owner);replayed=fixture('snapshot')
 observe('consumed approval replay emits no second transport',spool_state(run)==before_replay and replayed['counts']==after['counts'])
 i2=intent(2);pre_code2=spool_state(run);post('request code package two',2,'codigo',i2,owner);code2=approval_otp(run,pre_code2);markers.append(code2)
 fixture('fault-on');post('accepted transport persistence fault',2,'aprovar',{'code':code2},owner,500);fault=fixture('snapshot');fixture('fault-off')
 observe('accepted journal survives rolled back recipient persistence',len([m for m in fault['messages']if m['kind']=='lote'and m['status']=='accepted'])==2 and len([s for s in fault['sends']if s['batch_id']==2])==0)
 frozen_spool=spool_state(run);frozen_counts=fault['counts'].copy()
 body,_=check('inspect accepted package','GET','/api/admin/lotes/2/conciliar',200,cookie=owner);inspection=json.loads(body)
 require(inspection.get('ok')and inspection.get('proof')and len(inspection.get('recipients',[]))==1 and inspection['recipients'][0]['state']=='accepted','accepted reconciliation proof');markers.append(inspection['proof'])
 body,_=post('reconcile accepted package',2,'conciliar',{'proof':inspection['proof']},owner,200);decision=json.loads(body)
 observe('HTTP reconciliation records accepted recipient and sent batch',verify_reconciled_state(decision,fixture('snapshot'),2))
 body,_=post('reconcile same proof replay',2,'conciliar',{'proof':inspection['proof']},owner,200);decision=json.loads(body)
 require(decision=={'ok':True,'updated':0,'complete':True},'reconciliation replay zero')
 final=fixture('snapshot');observe('reconciliation and replay never transport again',spool_state(run)==frozen_spool and final['counts']['mail_messages']==frozen_counts['mail_messages']and final['counts']['mail_message_attempts']==frozen_counts['mail_message_attempts']and final['counts']['batch_sends']==2)
 verified=fixture('verify-attachments');observe('both immutable two-PDF envelopes match exact fixture bytes',len(verified['verified'])==2 and sorted(v['batchId']for v in verified['verified'])==[1,2]and all(v['exactBytes']for v in verified['verified']))
 (run/'private-markers.json').write_text(json.dumps(markers));(run/'private-markers.json').chmod(0o600)
 observe('all seeded document bytes and immutable metadata preserved',verify_document_preservation(immutable_before,final['documentByteFingerprints']))
 # No credential/code/proof/body/spool filename is returned in technical receipts.
 return {'complete':True,'documentByteFingerprintsStable':True,'assertions':records,'concurrentHttpReceipts':concurrent_results,'archivedAttachmentProofs':verified,'spoolFiles':len(frozen_spool),'newApprovalCodes':2,'newAcceptedPackageTransports':2,'realDeliveryConfirmed':False,'syntheticCryptographicClassificationOnly':True,'remaining':['runtime code expiry and five-wrong-attempt threshold','indeterminate dev transport','browser approval interface','real certificate/validator/provider/delivery']}
