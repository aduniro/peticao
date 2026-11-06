#!/usr/bin/env python3
"""Package a consistent recovery snapshot even if recovery continues after an API error."""
import os,sys,time
from pathlib import Path
from cycle_worker import backup_file,package
os.umask(0o077)
job=Path(sys.argv[1])
if job.parent!=Path('/root/peticao-recovery/complementos'):raise RuntimeError('Unexpected path')
target=job/('recuperacao-conferida-'+str(time.time_ns())+'.sqlite')
backup_file(job/'recuperacao.sqlite',target)
files=[p for p in (job/'resultados').iterdir() if p.is_file()]
files.extend([target,job/'estado-geral.json'])
package(job,files,job/'resultado-completo.tar.gz')
print('PACOTE_CONSISTENTE')
