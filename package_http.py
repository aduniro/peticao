"""Three fixed LOCAL HTTP edge scenarios; no automatic POST retry or credential export."""
from pathlib import Path
from contextlib import contextmanager
import hashlib,json,os,re,stat,urllib.parse,uuid

def require(ok,label):
 if not ok:raise RuntimeError('R11 assertion: '+label)
def spool_state(run):
 root=run/'mail-outbox';out={}
 for p in root.iterdir():
  require(not p.is_symlink() and p.is_file() and stat.S_IMODE(p.stat().st_mode)==0o600 and p.stat().st_uid==os.getuid(),'private own spool metadata')
  require(p.suffix=='.json' and p.stat().st_size<1024*1024,'bounded spool JSON')
  out[p.name]=hashlib.sha256(p.read_bytes()).hexdigest()
 return out

def approval_otp(run,before):
 after=spool_state(run);new=set(after)-set(before);require(len(new)==1,'one approval spool file')
 value=json.loads((run/'mail-outbox'/next(iter(new))).read_text());require(value['to']=='qa-approver@example.test' and not value.get('attachments'),'approval destination')
 match=re.search(r': (\d{6})$',value['subject']);require(match is not None,'approval subject protocol');return match[1]

def verify_document_preservation(before,after):
 expected={'batches','batch_document_versions','batch_packages','petition_base_artifacts','petition_base_validations','petition_base_selections'}
 require(isinstance(before,dict) and isinstance(after,dict) and set(before)==expected and set(after)==expected,'complete immutable byte fingerprint inventory')
 require(all(isinstance(v,str) and re.fullmatch('[a-f0-9]{64}',v) for v in [*before.values(),*after.values()]),'valid byte fingerprints')
 require(before==after,'document bytes and immutable rows changed');return True

def verify_spool_identity(path,fd,identity,mode):
 a=os.fstat(fd);b=path.lstat()
 require(path.resolve()==path and not stat.S_ISLNK(b.st_mode) and stat.S_ISDIR(a.st_mode),'canonical spool directory')
 require((a.st_dev,a.st_ino,a.st_uid)==identity==(b.st_dev,b.st_ino,b.st_uid) and a.st_uid==os.getuid(),'same owned spool inode')
 allowed={mode} if isinstance(mode,int) else set(mode)
 require(stat.S_IMODE(a.st_mode)==stat.S_IMODE(b.st_mode) and stat.S_IMODE(a.st_mode) in allowed,'expected private spool mode')

@contextmanager
def readonly_spool(run,cancellation,proof):
 """Only own existing directory mode changes; no rename, deletion, or global permissions."""
 path=run/'mail-outbox';require(run.resolve()==run and path.parent==run and os.getuid()!=0,'nonroot own run spool')
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);a=os.fstat(fd);identity=(a.st_dev,a.st_ino,a.st_uid);before=None;restore_admitted=False
 try:
  verify_spool_identity(path,fd,identity,0o700);before=spool_state(run)
  # Admission precedes the syscall: TERM may arrive after fchmod changed mode, before Python returns.
  restore_admitted=True
  os.fchmod(fd,0o500);verify_spool_identity(path,fd,identity,0o500)
  require(not os.access(path,os.W_OK),'write permission is actually absent')
  proof.update(applied=True,modeBefore='0700',modeDuring='0500',sameInode=True)
  yield
 finally:
  # TERM/INT during restoration are counted by the outer cancellation state, not raised.
  previous=cancellation.cleaning;cancellation.cleaning=True
  try:
   if restore_admitted:
    # Observe either admitted mode, never infer it from a post-syscall assignment.
    verify_spool_identity(path,fd,identity,{0o500,0o700})
    os.fchmod(fd,0o700);verify_spool_identity(path,fd,identity,0o700)
    require(before is not None and spool_state(run)==before,'fault changed existing spool files')
    proof.update(restored=True,modeAfter='0700',sameFilesAndHashes=True)
  finally:
   os.close(fd);cancellation.cleaning=previous

def verify_blocked(snapshot,batch,attempts):
 row=next(v for v in snapshot['batches'] if v['id']==batch)
 require(row['status']=='prepared' and row['approved_at'] is None and row['sent_at'] is None and row['approval_code_hash'] is not None and row['approval_attempts']==attempts,'blocked batch remains unapproved')
 require(not [s for s in snapshot['sends'] if s['batch_id']==batch],'blocked batch has no recipient result')
 return row

def same_code_state(before,after):
 keys=['approval_code_hash','approval_code_expires_at','approval_attempts','approved_at','sent_at','status']
 return all(before[k]==after[k] for k in keys)

def exercise(run,request,check,fixture,seed,cancellation):
 records=[];markers=[];immutable_before=fixture('snapshot')['documentByteFingerprints']
 def observe(label,ok):require(ok,label);records.append(label)
 def post(label,batch,kind,values,cookie,expect=303):return check(label,'POST',f'/api/admin/lotes/{batch}/{kind}',expect,urllib.parse.urlencode(values),cookie)
 def row(snapshot,n):return next(v for v in snapshot['batches'] if v['id']==n)
 def intent(n):
  v=next(v for v in seed['packages'] if v['batchId']==n)
  return {'requestId':str(uuid.uuid4()),'expectedDocumentVersion':v['documentVersion'],'expectedPackageId':v['packageId'],'expectedPackageDigest':v['packageDigest']}
 def issue(n,label):
  before=spool_state(run);i=intent(n);_,h=post(label,n,'codigo',i,owner)
  require(urllib.parse.parse_qs(urllib.parse.urlsplit(h.get('location','')).query).get('msg')==['Código enviado ao aprovador.'],'explicit code request success')
  code=approval_otp(run,before);markers.append(code);return i,code
 def message(headers):return urllib.parse.parse_qs(urllib.parse.urlsplit(headers.get('location','')).query).get('msg',[None])[0]
 _,h=check('owner login','POST','/api/admin/login',303,urllib.parse.urlencode({'email':'owner@fixture.invalid','password':'Fixture-Only-92837465'}))
 cookie_header=h.get('set-cookie','');owner=cookie_header.split(';')[0]
 require(owner.startswith('adm=') and all(v in cookie_header for v in ['Secure','HttpOnly','SameSite=strict']),'unchanged secure session cookie');markers.append(owner)
 # Private marker file is created before subsequent failure is possible; never exported.
 def save_markers():
  p=run/'private-markers.json';p.write_text(json.dumps(markers));p.chmod(0o600)
 save_markers();fixture('stepup-fixture');require(not spool_state(run),'empty initial own spool')
 i1,c1=issue(1,'request expiry code');save_markers();expiry=fixture('expiryseed');require(expiry=={'expirySeeded':True,'realTimeWait':False,'batchId':1},'explicit expiry timestamp fixture')
 expired=fixture('snapshot');expired_row=verify_blocked(expired,1,0);frozen=spool_state(run)
 _,h=post('expired correct code refused',1,'aprovar',{'code':c1},owner)
 require(message(h)=='Solicite um novo código.','expiry refusal before context admission')
 _,h=post('expired same intent refused',1,'codigo',i1,owner);require(message(h)=='Solicite um novo código.','expired intent cannot renew')
 after=fixture('snapshot');verify_blocked(after,1,0)
 observe('timestamp-expired correct code and intent replay refuse without renewal or transport',same_code_state(expired_row,row(after,1)) and after['counts']==expired['counts'] and spool_state(run)==frozen)

 i2,c2=issue(2,'request five-attempt code');save_markers();frozen=spool_state(run);wrong='000000' if c2!='000000' else '111111'
 for n in range(1,6):
  _,h=post('incorrect code attempt '+str(n),2,'aprovar',{'code':wrong},owner);require(message(h)=='Código incorreto.','wrong code refusal')
  snap=fixture('snapshot');verify_blocked(snap,2,n);require(spool_state(run)==frozen,'wrong attempt cannot transport')
 threshold=fixture('snapshot');row5=verify_blocked(threshold,2,5)
 _,h=post('correct code after five refused',2,'aprovar',{'code':c2},owner);require(message(h)=='Muitas tentativas. Solicite um novo código.','five-attempt threshold refusal')
 _,h=post('same exhausted intent refused',2,'codigo',i2,owner);require(message(h)=='Solicite um novo código.','exhausted intent cannot reset guesses')
 after=fixture('snapshot');verify_blocked(after,2,5)
 observe('five real wrong HTTP codes block correct code and intent replay without resetting guesses',same_code_state(row5,row(after,2)) and after['counts']==threshold['counts'] and spool_state(run)==frozen)

 i3,c3=issue(3,'request uncertain-transport code');save_markers();pre=fixture('snapshot');frozen=spool_state(run);fault_proof={}
 with readonly_spool(run,cancellation,fault_proof):
  _,h=post('dev spool transport indeterminate',3,'aprovar',{'code':c3},owner)
  require(message(h)=='Enviado a 0 destinatário(s); 1 falha(s). Resultado do envio a conferir. Verifique o histórico antes de tentar outra ação.','uncertain response explicitly requires review')
 uncertain=fixture('snapshot');b=row(uncertain,3)
 require(fault_proof.get('restored') and fault_proof.get('sameFilesAndHashes'),'spool mode and identity restored')
 require(b['status']=='failed' and b['approved_at'] is not None and b['sent_at'] is None and b['approval_code_hash'] is None,'uncertain batch approval consumed once without sent marker')
 require(len([s for s in uncertain['sends'] if s['batch_id']==3 and s['ok'] is False])==1,'uncertain recipient result')
 lotes=[m for m in uncertain['messages'] if m['kind']=='lote'];attempts=[a for a in uncertain['attempts'] if a['kind']=='lote']
 observe('owned dev-spool write failure records one indeterminate transport and no accepted envelope',len(lotes)==1 and lotes[0]['status']=='indeterminate' and len(attempts)==1 and attempts[0]['state']=='indeterminate' and spool_state(run)==frozen and uncertain['counts']['mail_messages']==pre['counts']['mail_messages']+1 and uncertain['counts']['mail_message_attempts']==pre['counts']['mail_message_attempts']+1)
 body,_=check('inspect indeterminate package','GET','/api/admin/lotes/3/conciliar',200,cookie=owner);inspection=json.loads(body)
 require(inspection.get('ok') is True and inspection.get('proof') and len(inspection.get('recipients',[]))==1 and inspection['recipients'][0]['state']=='indeterminate','indeterminate reconciliation evidence');markers.append(inspection['proof']);save_markers()
 for label in ['reconcile indeterminate without resend','replay indeterminate reconciliation']:
  body,_=post(label,3,'conciliar',{'proof':inspection['proof']},owner,200);require(json.loads(body)=={'ok':True,'updated':0,'complete':False},'uncertain reconciliation incomplete, no update')
 _,h=post('consumed uncertain approval refuses retry',3,'aprovar',{'code':c3},owner);require(message(h)=='Lote não está disponível para envio.','uncertain approval latch refusal')
 for label,values in [('uncertain same code intent refused',i3),('uncertain new code intent refused',intent(3))]:
  _,h=post(label,3,'codigo',values,owner);require(message(h)=='Lote não está pronto para aprovação.','uncertainty cannot issue another code')
 final=fixture('snapshot')
 observe('indeterminate reconciliation stays incomplete and retries never create another code or transport',final['counts']==uncertain['counts'] and final['attempts']==uncertain['attempts'] and final['messages']==uncertain['messages'] and final['sends']==uncertain['sends'] and same_code_state(b,row(final,3)) and spool_state(run)==frozen)
 observe('all seeded document bytes and immutable rows preserved',verify_document_preservation(immutable_before,final['documentByteFingerprints']))
 return {'complete':True,'assertions':records,'documentByteFingerprintsStable':True,'expirySeededPastTimestamp':True,'realFifteenMinuteWait':False,'fiveWrongHttpAttempts':5,'newApprovalCodes':3,'newAcceptedPackageTransports':0,'indeterminatePackageAttempts':1,'spoolFiles':len(frozen),'spoolPermissionFault':fault_proof,'realDeliveryConfirmed':False,'syntheticCryptographicClassificationOnly':True,'remaining':['browser approval interface','real certificate/validator/provider/delivery','target compatibility and full rollback/forward recovery']}
