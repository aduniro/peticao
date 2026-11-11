"""Pinned Poppler readers and one reference-page bitmap; no camera/QR decode/network."""
from pathlib import Path
import subprocess,re,hashlib,json,unicodedata
ROOT=Path(__file__).resolve().parent

def verify_tools():
 pins=json.loads((ROOT/'PDF-TOOL-PINS.json').read_text())
 for name,pin in pins.items():
  p=Path(name)
  if p.resolve()!=p or not p.is_file()or p.is_symlink()or hashlib.sha256(p.read_bytes()).hexdigest()!=pin:raise RuntimeError('pinned PDF reader drift')
 return pins

def verify_outputs(info,text,names,list_hash,reference):
 m=re.search(r'^Pages:\s+(\d+)\s*$',info,re.M)
 if not m or not 2<=int(m[1])<=20:raise RuntimeError('bounded generated multipage PDF required')
 normalized=' '.join(text.split());folded=''.join(c for c in unicodedata.normalize('NFD',normalized.upper())if unicodedata.category(c)!='Mn')
 if any(name not in normalized for name in names)or list_hash[:16]not in normalized:raise RuntimeError('signatures or list hash absent')
 if 'NAO ASSINADO'in folded:raise RuntimeError('A1 render target must not carry old test footer')
 if not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}',reference['id'])or reference['url']!='https://documents.example.org/api/documentos/referencia/'+reference['id']:raise RuntimeError('canonical synthetic text reference required')
 pages=[i+1 for i,page in enumerate(text.split('\f'))if reference['id']in page and'Autenticidade:'in page]
 if len(pages)!=1 or pages[0]>int(m[1]):raise RuntimeError('one reference UUID/authenticity page required')
 if not re.search(r'^Title:.*PLV 12/2026.*lote 1\s*$',info,re.M):raise RuntimeError('PDF title mismatch')
 return {'parsed':True,'pages':int(m[1]),'referencePage':pages[0],'allSyntheticNamesPresent':True,'listHashFooterPresent':True,'oldUnsignedFooterAbsent':True,'referenceUuidTextMatched':True,'referenceUrlFromBoundSnapshot':reference['url'],'qrIndependentlyDecoded':False,'qrCameraValidationTested':False,'textSha256':hashlib.sha256(text.encode()).hexdigest()}

def parse_pdf(path,names,list_hash,reference):
 verify_tools()
 if path.resolve()!=path or not path.is_file()or path.is_symlink()or path.stat().st_size>25*1024**2:raise RuntimeError('bounded own PDF required')
 env={'PATH':'/usr/bin:/bin','HOME':str(ROOT/'empty'),'LANG':'C.UTF-8'}
 def call(args):
  p=subprocess.run(args,capture_output=True,text=True,env=env,timeout=20)
  if p.returncode or len(p.stdout.encode())>8*1024**2:raise RuntimeError('bounded Poppler reader failed')
  return p.stdout
 info=call(['/usr/bin/pdfinfo',str(path)]);text=call(['/usr/bin/pdftotext','-layout','-enc','UTF-8',str(path),'-']);proof=verify_outputs(info,text,names,list_hash,reference)
 target=path.parent/'reference-page';call(['/usr/bin/pdftoppm','-f',str(proof['referencePage']),'-l',str(proof['referencePage']),'-singlefile','-png','-r','144',str(path),str(target)])
 image=target.with_suffix('.png')
 if image.resolve()!=image or not image.is_file()or image.is_symlink()or image.stat().st_size>16*1024**2 or not image.read_bytes().startswith(b'\x89PNG\r\n\x1a\n'):raise RuntimeError('reference page bitmap required')
 proof['referenceBitmapSha256']=hashlib.sha256(image.read_bytes()).hexdigest();proof['qrVisualReviewPending']=True;return proof
