"""Private derived decision labels. Never writes approvals or source records."""
import json,os,tempfile,threading
from pathlib import Path
_LOCK=threading.RLock()
class DecisionFilterCache:
 def __init__(self,db,live_path,base):
  path=db.execute('PRAGMA database_list').fetchone()[2]
  self.path=base/'decision-filter-cache.json' if Path(path).resolve()==live_path.resolve() else None
  self.rows={};self.dirty=False
  if self.path:
   try:
    value=json.loads(self.path.read_text())
    if value.get('version')=='effective-name-v1' and isinstance(value.get('labels'),dict):self.rows=value['labels']
   except (OSError,ValueError):pass
 def get(self,key,compute):
  value=self.rows.get(key)
  if value not in ('pending','approved','rejected'):
   value=compute();self.rows[key]=value;self.dirty=True
  return value
 def flush(self):
  if not self.path or not self.dirty:return
  name=None
  try:
   fd,name=tempfile.mkstemp(prefix='.decision-filter-',dir=self.path.parent)
   os.fchmod(fd,0o600)
   with os.fdopen(fd,'w') as stream:json.dump({'version':'effective-name-v1','labels':dict(list(self.rows.items())[-40000:])},stream)
   with _LOCK:os.replace(name,self.path)
  except OSError:pass  # A derived cache must not prevent reading valid decisions.
  finally:
   if name and os.path.exists(name):os.unlink(name)

def dictionary_dependencies(record,corpus):
 """Only words that can affect this proposal, not observation timestamps/counts."""
 from name_dictionary import WORD,folded,nfc
 data,index,_=corpus;preferred=data.get('preferred',{});corrections=data.get('probable_accent_errors',{})
 words=WORD.findall(nfc(str(record.get('name') or '')+' '+str(record.get('nome_api') or '')))
 keys={folded(w) for w in words};original=list(keys)
 for word in words:
  correction=corrections.get(word.casefold(),{}).get('suggestion','')
  keys.update(folded(w) for w in WORD.findall(correction))
 for key in original:
  keys.update(folded(w) for w in WORD.findall(preferred.get(key,'')))
  for entry in index.get(key,[]):keys.update(folded(w) for w in WORD.findall(entry.get('form','')))
 return {'words':{key:{'present':key in index,'variants':sorted({(e.get('form',''),e.get('source','')) for e in index.get(key,[])}),'preferred':preferred.get(key)} for key in sorted(keys)},'corrections':{w.casefold():corrections.get(w.casefold()) for w in words}}

class DependencyIndex:
 def __init__(self,corpus):self.corpus=corpus;self.words={}
 def record(self,record):
  from name_dictionary import WORD,nfc
  from data import fingerprint
  keys=sorted(set(WORD.findall(nfc(str(record.get('name') or '')+' '+str(record.get('nome_api') or '')))))
  for word in keys:
   if word not in self.words:self.words[word]=fingerprint(dictionary_dependencies({'name':word},self.corpus))
  return [self.words[word] for word in keys]
