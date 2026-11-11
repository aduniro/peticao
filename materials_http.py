"""Protocol assertions for the FUTURE compiled Next application, never a substitute server."""
import hashlib, html, re, uuid

CONTENT1 = {'template':'poster-a4-v1','assetKey':'adunir','title':'Material fictício versão um','body':'Corpo fictício A & B','callToAction':'Ação fictícia','footer':'Rodapé fictício'}
CONTENT2 = {**CONTENT1,'title':'Material fictício versão dois','body':'Conteúdo revisado fictício'}

def content_digest(content):
 import json
 # The application canonical digest has an explicit field order, not sorted keys.
 return hashlib.sha256(json.dumps(content,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

def preview_assert(status, headers, body, version, head):
 if status != 200: raise ValueError('preview status')
 h={k.lower():v for k,v in headers.items()}
 required={'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff','x-frame-options':'SAMEORIGIN','referrer-policy':'no-referrer','x-material-version-id':version['id'],'x-material-version-revision':str(version['revision']),'x-material-content-sha256':version['sha256'],'x-material-observed-head-version-id':head['id'],'x-material-observed-head-revision':str(head['revision']),'x-material-preview-scope':'exact-historical-version'}
 if any(h.get(k)!=v for k,v in required.items()): raise ValueError('preview exact metadata')
 text=body.decode('utf8','strict');styles=re.findall(r'<style>([\s\S]*?)</style>',text)
 if len(styles)!=1:raise ValueError('one renderer style')
 import base64
 style_hash=base64.b64encode(hashlib.sha256(styles[0].encode()).digest()).decode()
 csp=f"default-src 'none'; script-src 'none'; style-src 'sha256-{style_hash}'; img-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"
 if h.get('content-security-policy')!=csp:raise ValueError('exact CSP hash')
 if version['sha256']!=content_digest(version['content']):raise ValueError('canonical content digest')
 for key in ['title','body','callToAction','footer']:
  if html.escape(version['content'][key],quote=True).replace('&#x27;','&#39;') not in text:raise ValueError('requested historical text:'+key)
 if '<script' in text.lower() or re.search(r'\son\w+\s*=',text,re.I):raise ValueError('active HTML')
 return {'versionId':version['id'],'revision':version['revision'],'observedHeadRevision':head['revision'],'bodySha256':hashlib.sha256(body).hexdigest(),'exactCsp':True}

def protocol(call):
 """call(method,path,payload,actor) must address the new real Next listener only.
 Actors are anonymous/editor/reader sessions from actual fixture logins. No SQL-created material.
 """
 records=[]
 def request(method,path,payload=None,actor='editor',status=200):
  code,headers,body,value=call(method,path,payload,actor)
  if code!=status:raise ValueError('HTTP status '+method+' '+path+' '+str(code))
  records.append({'method':method,'path':path,'status':code,'bodySha256':hashlib.sha256(body).hexdigest()})
  return headers,body,value
 request('GET','/api/admin/materiais',actor='anonymous',status=401)
 create={'operation':'create','requestId':str(uuid.uuid4()),'content':CONTENT1}
 _,_,r=request('POST','/api/admin/materiais',create);v1=r['version']
 if r.get('ok')is not True or r.get('replayed')is not False or v1['revision']!=1 or v1['archived']:raise ValueError('real create')
 mid=v1['materialId'];recovery='/api/admin/materiais/pedidos/'+create['requestId']
 _,_,r=request('GET',recovery)
 if r!={'ok':True,'version':v1}:raise ValueError('request recovery')
 revise={'operation':'revise','requestId':str(uuid.uuid4()),'materialId':mid,'expectedRevision':1,'content':CONTENT2}
 _,_,r=request('POST','/api/admin/materiais',revise);v2=r['version']
 if r.get('replayed')is not False or v2['revision']!=2 or v2['materialId']!=mid:raise ValueError('CAS revise')
 _,_,r=request('POST','/api/admin/materiais',create)
 if r.get('replayed')is not True or r['version']!=v1:raise ValueError('old replay not current head')
 _,_,r=request('POST','/api/admin/materiais',{**revise,'requestId':str(uuid.uuid4())},status=409)
 if r!={'ok':False,'error':'conflict'}:raise ValueError('stale CAS rejection')
 _,_,r=request('GET','/api/admin/materiais/'+mid)
 if r['current']!=v2 or r['versions']!=[v2,v1]:raise ValueError('immutable history')
 request('POST','/api/admin/materiais',{'operation':'create','requestId':str(uuid.uuid4()),'content':CONTENT1},actor='reader',status=403)
 request('GET',recovery,actor='reader',status=404)
 archive={'operation':'archive','requestId':str(uuid.uuid4()),'materialId':mid,'expectedRevision':2}
 _,_,r=request('POST','/api/admin/materiais',archive);v3=r['version']
 if v3['revision']!=3 or not v3['archived'] or v3['content']!=v2['content']:raise ValueError('archive history')
 url='/api/admin/materiais/'+mid+'/previa?versionId='+v1['id']+'&revision=1'
 headers,body,_=request('GET',url,actor='reader');proof=preview_assert(200,headers,body,v1,v3)
 request('GET',url+'&revision=1',status=400)
 request('GET',url.replace('revision=1','revision=2'),status=404)
 request('GET',url.replace(v1['id'],str(uuid.uuid4())),status=404)
 _,_,r=request('GET','/api/admin/materiais?archived=1')
 if r.get('versions')!=[v3]:raise ValueError('archived library exact head')
 _,_,r=request('GET',recovery)
 if r.get('version')!=v1:raise ValueError('receipt remains original')
 return {'requests':records,'checks':{'realCreate':True,'realRevision':True,'casConflict':True,'replayHistorical':True,'actorScopedRecovery':True,'readWriteRoles':True,'archivePreservesHistory':True,'exactHistoricalPreview':proof},'expectedCounts':{'campaign_materials':1,'campaign_material_versions':3,'campaign_material_requests':3}}

if __name__=='__main__':raise SystemExit('Preparation only: no approved runtime/fixture launcher exists yet; never execute standalone.')
