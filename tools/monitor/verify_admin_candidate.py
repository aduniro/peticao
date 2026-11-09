#!/usr/bin/env python3
"""Fixed local QA entry point. No production configuration or transport is loaded."""
import argparse
import os
from pathlib import Path
import socket
import subprocess

ROOT=Path('/mnt/apps/peticao-final/peticao/.cache/admin-integration')


def main():
 parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['targeted','tests','schema','types','build']);args=parser.parse_args()
 candidate=Path.cwd().resolve();site=candidate/'site'
 if candidate.parent!=ROOT or not candidate.name.startswith('candidate-stage02') or not (site/'package.json').is_file():raise SystemExit('Somente candidato isolado stage02')
 if any((site/name).exists() for name in ['.env','.env.local','.env.production','.env.production.local']):raise SystemExit('QA exige candidato sem arquivos de ambiente')
 env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','LANG','LC_ALL']}
 scratch=Path.home()/'.cache/peticao-admin-supervised-qa';scratch.mkdir(mode=0o700,exist_ok=True)
 empty=scratch/'config-empty';empty.mkdir(mode=0o700,exist_ok=True)
 if any(empty.iterdir()):raise SystemExit('Diretório de configuração QA deve estar vazio')
 env.update(NODE_ENV='test',TMPDIR='/mnt/apps/peticao-final/.qa-tmp',DEV_DB_PORT='54349',DEV_DB_DIR=str(scratch/'postgres'),DATABASE_URL='postgres://peticao:peticao@127.0.0.1:54349/peticao',MAIL_PROVIDER='dev',MAIL_PROVIDERS='dev',PREVIEW_MODE='1',HASH_PEPPER='QA-ONLY-SUPERVISED-PEPPER',DATA_ENCRYPTION_KEY='QA-ONLY-SUPERVISED-KEY',CPF_CACHE_ENCRYPTION_KEY='QA-ONLY-SUPERVISED-CACHE-KEY',SECRETS_DIR=str(empty),PETICAO_CONFIG_DIR=str(empty),CREDENTIALS_DIRECTORY=str(empty),MAIL_ARCHIVE_RETENTION='30')
 if args.mode=='types':command=['npm','run','typecheck']
 else:
  with socket.socket() as sock:
   if sock.connect_ex(('127.0.0.1',54349))==0:raise SystemExit('Porta QA já ocupada; não assumir processo alheio')
  if args.mode=='build':
   env['NODE_ENV']='production';command=['npm','run','build']
  elif args.mode=='schema':command=['node','scripts/with-db.mjs','./node_modules/.bin/tsx','../deploy/test/admin-schema-upgrade.mjs']
  else:
   names=['admin-settings-domains.test.ts','admin-referrals.test.ts','institutional.test.ts']
   files=[str(site/'src/lib'/name) for name in names] if args.mode=='targeted' else sorted(str(p) for folder in ['src/lib','src/i18n'] for p in (site/folder).glob('*.test.ts'))
   command=['node','scripts/with-db.mjs','node','--import','tsx','--test','--test-concurrency=1',*files]
 return subprocess.run(command,cwd=site,env=env).returncode


if __name__=='__main__':raise SystemExit(main())
