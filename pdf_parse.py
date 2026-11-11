"""Fixed local Poppler readers. No PDF generation, app, network or arbitrary shell."""
from pathlib import Path
import subprocess,re,hashlib,json,os
ROOT=Path(__file__).resolve().parent

def verify_tools():
 pins=json.loads((ROOT/'PDF-TOOL-PINS.json').read_text())
 for name,pin in pins.items():
  p=Path(name)
  if p.resolve()!=p or not p.is_file()or p.is_symlink()or hashlib.sha256(p.read_bytes()).hexdigest()!=pin:raise RuntimeError('pinned PDF reader drift')
 return pins

def verify_outputs(info,text,names,expected_list_hash):
 m=re.search(r'^Pages:\s+(\d+)\s*$',info,re.M)
 if not m or not 2<=int(m[1])<=20:raise RuntimeError('expected bounded multipage generated petition')
 normalized=' '.join(text.split())
 if any(name not in normalized for name in names):raise RuntimeError('generated PDF missing fictitious signer name')
 if expected_list_hash[:16]not in normalized or 'NAO ASSINADO (teste)'not in normalized:raise RuntimeError('generated PDF list hash or baseline SIGNERnone footer missing')
 if not re.search(r'^Title:.*PLV 12/2026.*lote 1\s*$',info,re.M):raise RuntimeError('generated PDF title mismatch')
 return {'parsed':True,'pages':int(m[1]),'allSyntheticNamesPresent':True,'listHashFooterPresent':True,'baselineUnsignedFooterPresent':True,'textSha256':hashlib.sha256(text.encode()).hexdigest()}

def parse_pdf(path,names,list_hash):
 verify_tools()
 if path.resolve()!=path or not path.is_file()or path.is_symlink()or path.stat().st_size>25*1024**2:raise RuntimeError('own bounded PDF required')
 env={'PATH':'/usr/bin:/bin','HOME':str(ROOT/'empty'),'LANG':'C.UTF-8'}
 def call(args):
  p=subprocess.run(args,capture_output=True,text=True,env=env,timeout=20)
  if p.returncode or len(p.stdout.encode())>8*1024**2:raise RuntimeError('bounded PDF parser failed')
  return p.stdout
 info=call(['/usr/bin/pdfinfo',str(path)]);text=call(['/usr/bin/pdftotext','-layout','-enc','UTF-8','-nopgbrk',str(path),'-'])
 return verify_outputs(info,text,names,list_hash)
