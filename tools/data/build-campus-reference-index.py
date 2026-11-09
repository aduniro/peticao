#!/usr/bin/env python3
"""Deterministic public-reference snapshot; reads only versioned local files, never network."""
import argparse, csv, hashlib, io, json, re
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
ROOT=Path(__file__).resolve().parents[2]
SOURCES=['material_base/validacao_ifes/campi-oficiais.csv','material_base/validacao_ifes/auditoria-campi-2026-11-03.json','material_base/validacao_ifes/relatorio.md','site/src/lib/ifes-domains.json','site/public/data/ifes.json','site/public/data/municipios.json','site/public/data/regiao.json','site/public/data/geo/municipios-centroides.json']
TARGET=ROOT/'site/src/lib/contact-triage/campus-reference-index.json'
key=lambda s:re.sub(r'[^a-z0-9]','',s.casefold())
def build():
 raw={p:(ROOT/p).read_bytes() for p in SOURCES}
 institutions={}
 for x in json.loads(raw['site/public/data/ifes.json']):
  for label in [x['s'],x['n'],*x.get('a',[])]:
   k=key(label)
   assert k not in institutions or institutions[k]['s']==x['s'],('ambiguous institution alias',label)
   institutions[k]=x
 domains=json.loads(raw['site/src/lib/ifes-domains.json'])
 municipalities={x[0]:x for x in json.loads(raw['site/public/data/municipios.json'])}
 records=[]
 reader=csv.DictReader(io.StringIO(raw[SOURCES[0]].decode('utf8')),delimiter=';')
 assert reader.fieldnames==['sigla_instituicao','nome_instituicao','tipo','campus','municipio','uf','ibge','fonte_url']
 for line,r in enumerate(reader,2):
  inst=institutions.get(key(r['sigla_instituicao'])); assert inst, (line,'unknown IFES')
  ibge=int(r['ibge']); mun=municipalities.get(ibge);assert mun and mun[2]==r['uf'],(line,'invalid municipality')
  source=r['fonte_url']; match=re.match(r'https?://[^\s]+',source)
  url=None;category='indirect_inep';annotation=None
  if match:
   token=match.group(); parts=urlsplit(token)
   assert parts.scheme in ['http','https'] and parts.hostname and not parts.username and not parts.password and not parts.port
   url=urlunsplit(parts);annotation=source[len(token):].strip() or None
   allowed=[d['domain'] for d in domains if institutions.get(key(d['acronym']),{}).get('s')==inst['s']]
   official=any(parts.hostname==d or parts.hostname.endswith('.'+d) for d in allowed)
   category='unverified_url'
   if official:category='official_http_reference' if parts.scheme=='http' else 'official_site_reference' if annotation or parts.path in ['', '/'] else 'official_page_reference'
  if not match: assert source=='INEP Censo da Educação Superior (via ifes.json)',(line,'unknown source label')
  records.append({'id':f'csv:{line}','institution':inst['s'],'campusName':r['campus'],'cityIbge':ibge,'sourceRaw':source,'sourceUrl':url,'sourceCategory':category,'sourceAnnotation':annotation})
 notes=[]
 for inst in json.loads(raw[SOURCES[1]]):
  for n in inst.get('faltantes',[]):
   notes.append({'institution':inst['sigla'],'cityIbge':n['ibge'],'statusReported':n.get('status'),'sourceRaw':n.get('fonte'),'operationalStatusVerified':False})
 return {'format':1,'sourceSnapshotDate':'2026-11-03','contentArchived':False,'liveVerified':False,'rowCount':len(records),'urlReferenceCount':sum(x['sourceUrl'] is not None for x in records),'indirectCount':sum(x['sourceCategory']=='indirect_inep' for x in records),'sources':{p:hashlib.sha256(raw[p]).hexdigest() for p in SOURCES},'records':records,'auditNotes':notes}
parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
content=json.dumps(build(),ensure_ascii=False,separators=(',',':'))+'\n'
if args.check:
 assert TARGET.read_text()==content,'Reference index is stale: regenerate and review the public-source diff'
 print('PASS deterministic campus index and all eight source checksums')
else:
 TARGET.write_text(content);print('Wrote',TARGET.relative_to(ROOT))
