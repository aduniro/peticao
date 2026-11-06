"""Read-only source snapshot. Executed over SSH stdin, never reads app.env or data."""
import datetime,hashlib,io,json,os,pathlib,sys,tarfile
ROOTS={'production':pathlib.Path('/opt/peticao/app'),'stage':pathlib.Path('/home/adunir/peticao-stage/site')}
root=ROOTS[sys.argv[1]]
SKIP={'.git','.next','.next-dev','node_modules','.pgdata','secrets','preview-state','.cache','outbox'}
SUFFIXES={'.ts','.tsx','.js','.mjs','.cjs','.mts','.cts','.py','.css','.json','.geojson','.md','.sh','.ttf','.otf','.woff','.woff2','.png','.jpg','.jpeg','.webp','.gif','.ico','.svg','.webmanifest'}
items=[];total=0
for base,dirs,files in os.walk(root):
 rel=pathlib.Path(base).relative_to(root)
 dirs[:]=[d for d in dirs if d not in SKIP and not d.startswith('.') and not (rel==pathlib.Path('.') and d in {'data','geo-data'})]
 for name in files:
  path=pathlib.Path(base)/name
  if name.startswith('.') or path.is_symlink() or path.suffix.lower() not in SUFFIXES:continue
  data=path.read_bytes();total+=len(data)
  if len(data)>32*1024*1024 or total>256*1024*1024:raise RuntimeError('SOURCE_LIMIT')
  items.append((str(path.relative_to(root)),data))
items.sort();manifest={'schema':'peticao-source-v1','root':str(root),'captured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'runtime_excluded':True,'included_suffixes':sorted(SUFFIXES),'files':{name:{'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)} for name,raw in items}}
with tarfile.open(fileobj=sys.stdout.buffer,mode='w|gz') as archive:
 for name,raw in items+[('SOURCE-MANIFEST.json',json.dumps(manifest,ensure_ascii=False,sort_keys=True,indent=2).encode())]:
  info=tarfile.TarInfo(name);info.size=len(raw);info.mode=0o644;archive.addfile(info,io.BytesIO(raw))
