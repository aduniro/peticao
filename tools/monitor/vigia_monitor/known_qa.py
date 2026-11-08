"""Use existing authorization only for the fixed, reviewed local QA helper."""
import hashlib
import json
from pathlib import Path
import shlex

HELPER=Path('/mnt/dev/peticao/tools/monitor/verify_admin_candidate.py')
DIGEST='251fae6b0854b8eaf5ab613dbc085ebe7873d7207781988af70dcf56b4b5fdcf'
CANDIDATE=Path('/mnt/dev/peticao/.cache/admin-integration/candidate-stage02-domains')


def allowed(payload):
 command=payload.get('command');cwd=payload.get('cwd')
 if not isinstance(command,str) or cwd!=str(CANDIDATE):return False
 if any(c in command for c in [';','&','|','$','`','\n','\r','>','<']):return False
 try:
  args=shlex.split(command)
  if len(args)==3 and args[0] in ('/bin/bash','/usr/bin/bash','bash') and args[1] in ('-lc','-c'):args=shlex.split(args[2])
  return len(args)==3 and args[0] in ('python3','/usr/bin/python3') and args[1]==str(HELPER) and args[2] in ('targeted','tests','schema','types','build') and not HELPER.is_symlink() and hashlib.sha256(HELPER.read_bytes()).hexdigest()==DIGEST
 except (OSError,ValueError):return False


def approve_known(store):
 for row in store.rows("SELECT a.* FROM approvals a JOIN requests r ON r.id=a.request_id JOIN workflow_steps w ON w.work_request=r.id JOIN supervision s ON s.task_id=w.task_id JOIN tasks t ON t.id=w.task_id WHERE a.answered=0 AND a.decision IS NULL AND a.method='item/commandExecution/requestApproval' AND r.state='running' AND w.state='working' AND s.enabled=1 AND t.state='running'"):
  try:
   if not allowed(json.loads(row['payload'])):continue
   store.decide(row['id'],'accept')
   store.event('known_qa_authorized','Helper QA local já autorizado: pedido específico liberado',data={'approval':row['id'],'request':row['request_id'],'helper_sha256':DIGEST})
  except (ValueError,TypeError):continue
