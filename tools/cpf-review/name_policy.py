"""Central print-name policy. Never changes identity evidence or CPF decisions."""
import hashlib,json,re,unicodedata
from collections import Counter
from pathlib import Path
from functools import lru_cache
POLICY_PATH=Path(__file__).resolve().parents[2]/'site/src/content/name-print-policy.json'
WORD=re.compile(r"[^\W\d_]+(?:['’ʼ‘-][^\W\d_]+)*",re.UNICODE)

def fold(value):
 return ''.join(c for c in unicodedata.normalize('NFD',str(value or '').lower().replace('’',"'").replace('ʼ',"'")) if not unicodedata.combining(c))

@lru_cache(maxsize=4)
def _policy(raw):return json.loads(raw)
def policy():return _policy(POLICY_PATH.read_bytes())
def words(value):return WORD.findall(unicodedata.normalize('NFC',str(value or '')))
def significant(value):return [w for w in words(value) if fold(w) not in set(policy()['particles'])]
def full_words(value):return [w for w in significant(value) if len(fold(w))>1]
def key(value):return [fold(w) for w in words(value)]
def subsequence(a,b):
 position=0
 for word in b:
  if position<len(a) and a[position]==word:position+=1
 return position==len(a)

def restore_particles(base,evidence):
 """Merge aligned particle runs, preferring the official API particles."""
 particles=set(policy()['particles']);bw=words(base);ew=words(evidence)
 bnames=[(i,fold(w)) for i,w in enumerate(bw) if fold(w) not in particles]
 enames=[(i,fold(w)) for i,w in enumerate(ew) if fold(w) not in particles]
 if not enames or not subsequence([w for _,w in enames],[w for _,w in bnames]):return base
 mapping={};position=0
 for ei,word in enames:
  while bnames[position][1]!=word:position+=1
  mapping[ei]=bnames[position][0];position+=1
 inserts={};removed=set();run=[]
 for i,w in enumerate(ew):
  if fold(w) in particles:run.append(w.lower());continue
  target=mapping[i]
  if run:
   previous=max((mapping[j] for j in mapping if j<i),default=-1);start=previous+1
   inserts[start]=[w for w in bw[start:target] if fold(w) not in particles]+list(run)
   removed.update(range(start,target))
  run=[]
 if run:
  start=mapping[enames[-1][0]]+1
  inserts[start]=[w for w in bw[start:] if fold(w) not in particles]+list(run)
  removed.update(range(start,len(bw)))
 if not inserts:return base
 out=[]
 for i,w in enumerate(bw):
  out.extend(inserts.get(i,[]))
  if i not in removed:out.append(w)
 out.extend(inserts.get(len(bw),[]))
 return ' '.join(out)

def one_edit(a,b):
 if a==b:return False
 if abs(len(a)-len(b))>1:return False
 if len(a)==len(b):
  indices=[i for i in range(len(a)) if a[i]!=b[i]]
  return len(indices)==1 or len(indices)==2 and indices[1]==indices[0]+1 and a[indices[0]]==b[indices[1]] and a[indices[1]]==b[indices[0]]
 if len(a)>len(b):a,b=b,a
 return any(b[:i]+b[i+1:]==a for i in range(len(b)))

def correct_extended_name(entered,api,known_forms):
 """Suggest only a unique, API-supported typo; don't replace known valid variants."""
 ew=words(entered);particles=set(policy()['particles']);positions=[i for i,w in enumerate(ew) if fold(w) not in particles]
 mapped=[];fixes=[];at=0;exact=0
 for expected in significant(api):
  equal=[j for j in range(at,len(positions)) if fold(ew[positions[j]])==fold(expected)]
  if equal:j=equal[0];exact+=1
  else:
   candidates=[j for j in range(at,len(positions)) if len(fold(ew[positions[j]]))>=4 and len(fold(expected))>=4 and fold(ew[positions[j]]) not in known_forms and one_edit(fold(ew[positions[j]]),fold(expected))]
   if len(candidates)!=1:return entered,[]
   j=candidates[0];fixes.append({'input':ew[positions[j]],'suggestion':expected,'source':'api_unique_typo_candidate'})
  mapped.append((positions[j],expected));at=j+1
 if not fixes or not exact:return entered,[]
 replacements={i:w for i,w in mapped};index=-1
 def replace(match):
  nonlocal index
  index+=1;return replacements.get(index,match.group())
 return WORD.sub(replace,entered),fixes

def collapse_api_spacing(value,api):
 """An exact split of an API word is formatting, never an additional name."""
 matches=list(WORD.finditer(value));targets={re.sub(r"['’ʼ‘-]",'',fold(w)):w for w in words(api)}
 out=[];changes=[];cursor=0;i=0
 while i<len(matches):
  found=None
  for count in range(min(4,len(matches)-i),1,-1):
   selected=matches[i:i+count]
   if any(value[a.end():b.start()].strip() for a,b in zip(selected,selected[1:])):continue
   candidate=''.join(re.sub(r"['’ʼ‘-]",'',fold(m.group())) for m in selected)
   if candidate in targets:found=(count,targets[candidate]);break
  if found:
   count,target=found;end=matches[i+count-1].end();start=matches[i].start()
   out.extend([value[cursor:start],target]);changes.append({'input':value[start:end],'suggestion':target,'source':'api_spacing_evidence'});cursor=end;i+=count
  else:i+=1
 out.append(value[cursor:]);return ''.join(out),changes

def select_name(entered,api,entered_resolved,api_resolved,known_forms=frozenset(),classification=None):
 aligned_entered,_=collapse_api_spacing(entered,api)
 entered_resolved,spacing=collapse_api_spacing(entered_resolved,api_resolved)
 a,b=significant(aligned_entered),significant(api);af,bf=full_words(aligned_entered),full_words(api)
 user_longer=bool(api and len(af)>len(bf));fixes=[]
 if user_longer:entered_resolved,fixes=correct_extended_name(entered_resolved,api_resolved,known_forms)
 api_resolved=restore_particles(restore_particles(api_resolved,entered_resolved),api_resolved) if api else ''
 entered_resolved=restore_particles(entered_resolved,api_resolved) if user_longer else entered_resolved
 ak,bk=[fold(w) for w in a],[fold(w) for w in b]
 # Missing middle names use the complete API result, never a merged/abbreviated name.
 compatible=bool(api and (subsequence(ak,bk) or subsequence(bk,ak)))
 overlap=sum((Counter(ak)&Counter(bk)).values());contradictory=bool(api and not compatible)
 order_changed=bool(api and Counter(ak)==Counter(bk) and ak!=bk)
 major=bool(api and (order_changed or contradictory and (overlap<2 or overlap/max(len(ak),len(bk),1)<0.6)))
 major=major or ak!=bk and classification in {'divergencia_forte','divergencia_relevante','ordem_diferente'}
 source='entered' if not api or user_longer else 'api';proposed=entered_resolved if source=='entered' else api_resolved
 reasons=['Política central: priorizar o nome completo da API; toda partícula que ela retorna é obrigatória no nome impresso.']
 if user_longer:reasons.append('Exceção: o nome digitado contém nomes completos adicionais; preservar a extensão e revisar individualmente.')
 elif not api:reasons.append('Sem nome cadastral da API: conferir o nome declarado; não presumir retorno cadastral.')
 if spacing:reasons.append('Espaço indevido reconhecido por correspondência exata com palavra da API: '+', '.join(f["input"]+' → '+f['suggestion'] for f in spacing)+'. Isso não conta como nome adicional.')
 if fixes:reasons.append('Possível digitação corrigida como sugestão, com apoio na API: '+', '.join(f["input"]+' → '+f['suggestion'] for f in fixes)+'.')
 if major:reasons.append('Divergência maior: revisão individual e notificação ao responsável por e-mail; não aprovar automaticamente.')
 return dict(proposed=proposed,proposed_source=source,entered_resolved=entered_resolved,api_resolved=api_resolved,
  special=bool(user_longer or contradictory or not api),major_divergence=major,notification_required=major,
  policy_version=policy()['version'],reasons=reasons,typo_corrections=fixes,spacing_corrections=spacing,
  extra_entered=list((Counter(ak)-Counter(bk)).elements()),missing_entered=list((Counter(bk)-Counter(ak)).elements()))
