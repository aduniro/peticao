"""Use existing authorization only for the fixed, reviewed local QA helper."""
import hashlib
import json
from pathlib import Path
import shlex

HELPER=Path('/mnt/apps/peticao-final/peticao/tools/monitor/verify_admin_candidate.py')
DIGEST='251fae6b0854b8eaf5ab613dbc085ebe7873d7207781988af70dcf56b4b5fdcf'
CANDIDATE=Path('/mnt/apps/peticao-final/peticao/.cache/admin-integration/candidate-stage02-domains')
CONSOLIDATION=CANDIDATE/'tools/admin-qa/consolidation.py'
CONSOLIDATION_DIGEST='4fd45c10b3b83ebcf8caf134c28b5f37c47e5e466d7cba90af71940bc4fe5574'
TEST_FLAGS={'--tests','--contact-tests','--mail-tests','--ai-tests','--document-tests'}
CONTRACTS={'referrals','referrals-browser','content-retention','whatsapp-senders','contact-history','contact-drafts','mail-recovery','mail-preview','ai-executor','actions-ui','batch-control','batch-reservation','batch-reconciliation'}


def allowed(payload):
 command=payload.get('command');cwd=payload.get('cwd')
 if not isinstance(command,str) or cwd!=str(CANDIDATE):return False
 if any(c in command for c in [';','&','|','$','`','\n','\r','>','<']):return False
 try:
  args=shlex.split(command)
  if len(args)==3 and args[0] in ('/bin/bash','/usr/bin/bash','bash') and args[1] in ('-lc','-c'):args=shlex.split(args[2])
  if len(args)<3 or args[0] not in ('python3','/usr/bin/python3'):return False
  if args[1]==str(HELPER):
   return len(args)==3 and args[2] in ('targeted','tests','schema','types','build') and not HELPER.is_symlink() and hashlib.sha256(HELPER.read_bytes()).hexdigest()==DIGEST
  if args[1] not in ('tools/admin-qa/consolidation.py',str(CONSOLIDATION)):return False
  if CONSOLIDATION.is_symlink() or hashlib.sha256(CONSOLIDATION.read_bytes()).hexdigest()!=CONSOLIDATION_DIGEST:return False
  return (len(args)==3 and args[2] in TEST_FLAGS) or (len(args)>=4 and args[2]=='--contracts' and len(set(args[3:]))==len(args[3:]) and set(args[3:])<=CONTRACTS)
 except (OSError,ValueError):return False


def approve_known(store):
 for row in store.rows("SELECT a.* FROM approvals a JOIN requests r ON r.id=a.request_id JOIN workflow_steps w ON w.work_request=r.id JOIN supervision s ON s.task_id=w.task_id JOIN tasks t ON t.id=w.task_id WHERE a.answered=0 AND a.decision IS NULL AND a.method='item/commandExecution/requestApproval' AND r.state='running' AND w.state='working' AND s.enabled=1 AND t.state='running'"):
  try:
   if not allowed(json.loads(row['payload'])):continue
   store.decide(row['id'],'accept')
   store.event('known_qa_authorized','Helper QA local já autorizado: pedido específico liberado',data={'approval':row['id'],'request':row['request_id'],'helper_sha256':DIGEST,'consolidation_sha256':CONSOLIDATION_DIGEST})
  except (ValueError,TypeError):continue
