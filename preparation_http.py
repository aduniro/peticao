"""Real runtime PDF preparation through fixed native form endpoint; no approval/send."""
from html.parser import HTMLParser
import hashlib,json,re,urllib.parse

def require(ok,message):
 if not ok:raise RuntimeError('R12 assertion: '+message)
class PortalParser(HTMLParser):
 def __init__(self):super().__init__();self.forms=[];self.links=[];self.text=[];self.current=None;self.button=None
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='form':self.current={'action':a.get('action'),'method':a.get('method'),'buttons':[]};self.forms.append(self.current)
  if tag=='button'and self.current is not None:self.button={'disabled':'disabled'in a,'text':''};self.current['buttons'].append(self.button)
  if tag=='a'and'href'in a:self.links.append(a['href'])
 def handle_endtag(self,tag):
  if tag=='button':self.button=None
  if tag=='form':self.current=None
 def handle_data(self,text):
  self.text.append(text)
  if self.button is not None:self.button['text']+=text

def inspect_portal(body,created):
 p=PortalParser();p.feed(body.decode());forms=[f for f in p.forms if f['action']=='/api/admin/lotes/criar?portal=presidente'];require(len(forms)==1,'one real native final creation form');require(forms[0]['method'].lower()=='post','native POST method');buttons=[b for b in forms[0]['buttons']if b['text']=='Fechar lote final agora'];require(len(buttons)==1 and buttons[0]['disabled']is created,'creation button state');text=' '.join(' '.join(p.text).split())
 if created:require('Lote 1' in text and 'final'in text and 'PDF pronto'in text and '/api/admin/lotes/1/pdf'in p.links,'prepared document review and download SSR')
 else:require('Nenhum lote ainda.'in text,'no initial prepared document')
 return {'nativeFormVerified':True,'finalButtonDisabled':created,'renderedServerHtmlOnly':True,'browserInteractionTested':False}

def verify_prepared(seed,snapshot):
 require(seed['readyPdfSeeded']is False and seed['cryptographicClassificationSeeded']is False and seed['emptyDocumentTables']=={'batches':0,'versions':0,'preparations':0},'no prebuilt PDF or batch seed')
 require(snapshot['batches']==1 and snapshot['kind']=='final'and snapshot['status']=='prepared'and snapshot['signatureKind']=='none','actual final prepared baseline state')
 require(snapshot['listHash']==seed['listHash']and snapshot['counts']['signatures']==3 and snapshot['counts']['batch_preparations']==1 and snapshot['counts']['batch_document_versions']==1,'all three confirmed signatures reserved once with exact list hash')
 require(snapshot['historyAuthorId']==1 and snapshot['historyRecordedBy']==1 and snapshot['historyVariant']=='original'and snapshot['exactHistoryBytes']is True,'history publication and author')
 require(all(snapshot['counts'][n]==0 for n in ['mail_messages','mail_message_attempts','mail_outbox','batch_sends']),'preparation emits no mail or send')
 return True

def exercise(run,request,check,fixture,seed):
 from pdf_parse import parse_pdf
 check('creation without session refused','POST','/api/admin/lotes/criar?portal=presidente',401,'')
 _,headers=check('owner HTTP login','POST','/api/admin/login',303,urllib.parse.urlencode({'email':'owner@fixture.invalid','password':'Fixture-Only-92837465'}));cookie=headers.get('set-cookie','').split(';')[0]
 require(cookie.startswith('adm=')and all(v in headers.get('set-cookie','')for v in ['Secure','HttpOnly','SameSite=strict']),'unchanged secure session');(run/'private-markers.json').write_text(json.dumps([cookie,cookie[4:]]));(run/'private-markers.json').chmod(0o600)
 check('creation without stepup refused','POST','/api/admin/lotes/criar?portal=presidente',403,'',cookie)
 require(fixture('inspect')['batches']==0,'denied create produced no batch');fixture('stepup-fixture')
 body,_=check('initial president portal','GET','/admin/presidente',200,cookie=cookie);before_ui=inspect_portal(body,False)
 _,h=check('native form creates real final PDF','POST','/api/admin/lotes/criar?portal=presidente',303,'',cookie);url=urllib.parse.urlsplit(h.get('location',''));query=urllib.parse.parse_qs(url.query);require(url.path=='/admin/presidente'and query.get('lote')==['1']and query.get('msg')==['Lote final 1 criado.'],'explicit creation303 result')
 prepared=fixture('inspect');verify_prepared(seed,prepared)
 body,_=check('prepared president portal review','GET','/admin/presidente?lote=1',200,cookie=cookie);after_ui=inspect_portal(body,True)
 pdf,headers=check('download real generated PDF','GET','/api/admin/lotes/1/pdf',200,cookie=cookie);require(pdf.startswith(b'%PDF-')and pdf==(run/'downloads/database.pdf').read_bytes()and hashlib.sha256(pdf).hexdigest()==prepared['pdfSha256'],'download exact generated DB bytes')
 require(headers.get('content-type')=='application/pdf'and headers.get('content-disposition')=='attachment; filename="lote-1.pdf"'and headers.get('cache-control')=='private, no-store'and headers.get('x-content-type-options')=='nosniff','generated PDF download headers');(run/'downloads/generated.pdf').write_bytes(pdf)
 body,_=check('real preparation history metadata','GET','/api/admin/lotes/1/versoes',200,cookie=cookie);listing=json.loads(body);require(listing.get('ok')and len(listing.get('versions',[]))==1,'exactly one real history publication');v=listing['versions'][0];require(v['id']==prepared['historyVersionId']and v['source']=='prepared'and v['variant']=='original'and v['sha256']==prepared['pdfSha256']and v['author_id']==1 and v['ordinal']==1,'real history metadata binding')
 version,_=check('download real published history version','GET','/api/admin/lotes/1/versoes/'+v['id'],200,cookie=cookie);require(version==pdf,'history download exact generated original')
 parsed=parse_pdf(run/'downloads/generated.pdf',seed['expectedNames'],seed['listHash'])
 _,h=check('same logical final creation repeated','POST','/api/admin/lotes/criar?portal=presidente',303,'',cookie);query=urllib.parse.parse_qs(urllib.parse.urlsplit(h.get('location','')).query);require(query.get('msg')==['Nada a fechar (já existe lote final ou não há assinaturas).'],'second logical final refuses duplicate')
 final=fixture('inspect');verify_prepared(seed,final);require(final==prepared,'second creation changed document history or frozen state');require(not list((run/'mail-outbox').iterdir()),'no dev mail files')
 return {'complete':True,'realPdfGeneratedByRuntime':True,'noPdfOrBatchSeeded':True,'preparedState':prepared,'sameFinalRequestDidNotDuplicate':True,'pdfParse':parsed,'serverRenderedPortalBefore':before_ui,'serverRenderedPortalAfter':after_ui,'browserInteractionTested':False,'approvalOrSendAttempted':False,'realSignatureUsed':False,'remaining':['native creation button browser interaction','A1 and govbr real certificates and validators','destination SP compatibility and complete rollback']}
