"""Fixed local text checks of fictitious own confirmation; never asserts external identity."""
from pathlib import Path
import json,hashlib,subprocess,re
ROOT=Path(__file__).resolve().parent

def verify_tools():
 pins=json.loads((ROOT/'PDF-TOOL-PINS.json').read_text())
 for name,pin in pins.items():
  p=Path(name)
  if p.resolve()!=p or not p.is_file()or p.is_symlink()or hashlib.sha256(p.read_bytes()).hexdigest()!=pin:raise RuntimeError('PDF tool drift')
 return pins

def verify_text(info,own_text,original_text,source_text,seed):
 match=re.search(r'^Pages:\s+(\d+)\s*$',info,re.M)
 if not match or int(match[1])!=seed['originalPages']+1:raise RuntimeError('one new confirmation page required')
 if own_text!=original_text:raise RuntimeError('source page text changed')
 normalized=' '.join(source_text.split());joined=''.join(source_text.split())
 if seed['signerName']not in normalized or seed['receiptId']not in normalized or seed['originalSha256']not in joined or 'Confirmação do responsável'not in normalized:raise RuntimeError('confirmation page missing binding')
 return {'pages':int(match[1]),'originalTextPreserved':True,'receiptSignerAndSourceHashPresent':True,'identityExternallyVerified':False,'icpOrGovbrValidated':False}

def parse_pdf(own,original,seed):
 verify_tools();env={'PATH':'/usr/bin:/bin','HOME':str(ROOT/'empty'),'LANG':'C.UTF-8'}
 def call(args):
  p=subprocess.run(args,capture_output=True,text=True,timeout=20,env=env)
  if p.returncode or len(p.stdout.encode())>8*1024**2:raise RuntimeError('bounded PDF parse failed')
  return p.stdout
 for p in [own,original]:
  if p.resolve()!=p or not p.is_file()or p.is_symlink()or p.stat().st_size>25*1024**2:raise RuntimeError('bounded own PDF inputs')
 pages=str(seed['originalPages']);info=call(['/usr/bin/pdfinfo',str(own)])
 def text(p,first,last):return call(['/usr/bin/pdftotext','-layout','-enc','UTF-8','-f',str(first),'-l',str(last),str(p),'-'])
 return verify_text(info,text(own,1,pages),text(original,1,pages),text(own,int(pages)+1,int(pages)+1),seed)
