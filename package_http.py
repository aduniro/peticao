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

