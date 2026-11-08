import sys
from pathlib import Path
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vigia_monitor.known_qa import allowed,HELPER,CANDIDATE


def test_reviewed_helper_exact_scope_only():
 assert allowed({'command':f"/bin/bash -lc 'python3 {HELPER} targeted'",'cwd':str(CANDIDATE)})
 for command in [f'python3 {HELPER} --help',f'python3 {HELPER} types; ssh peticao true',f'python3 {HELPER} $(echo tests)',f'python3 {HELPER} tests > /tmp/output','sudo true',f'python3 {HELPER} tests extra']:
  assert not allowed({'command':command,'cwd':str(CANDIDATE)})
 assert not allowed({'command':f'python3 {HELPER} tests','cwd':'/opt/peticao/app'})


def test_changed_helper_is_not_authorized(monkeypatch,tmp_path):
 from vigia_monitor import known_qa
 fake=tmp_path/'verify.py';fake.write_text('print("changed")')
 monkeypatch.setattr(known_qa,'HELPER',fake)
 assert not known_qa.allowed({'command':f'python3 {fake} tests','cwd':str(CANDIDATE)})


@pytest.mark.parametrize('args',['--document-tests','--ai-tests','--mail-tests','--contact-tests','--tests','--contracts mail-recovery mail-preview','--contracts ai-executor','--contracts batch-control'])
def test_reviewed_consolidation_exact_scope(args):
 assert allowed({'command':f"/bin/bash -lc 'python3 tools/admin-qa/consolidation.py {args}'",'cwd':str(CANDIDATE)})


@pytest.mark.parametrize('args',['','--help','--document-tests --ai-tests','--contracts','--contracts missing','--contracts mail-preview mail-preview','--contracts mail-preview; ssh peticao true','--tests > /tmp/out','--tests && git push'])
def test_consolidation_rejects_unreviewed_commands(args):
 assert not allowed({'command':f'python3 tools/admin-qa/consolidation.py {args}','cwd':str(CANDIDATE)})


def test_consolidation_rejects_changes_symlinks_and_other_cwd(monkeypatch,tmp_path):
 import hashlib
 from vigia_monitor import known_qa
 fake=tmp_path/'qa.py';fake.write_text('reviewed')
 monkeypatch.setattr(known_qa,'CONSOLIDATION',fake)
 monkeypatch.setattr(known_qa,'CONSOLIDATION_DIGEST',hashlib.sha256(fake.read_bytes()).hexdigest())
 payload={'command':f'python3 {fake} --document-tests','cwd':str(CANDIDATE)}
 assert allowed(payload)
 assert not allowed(dict(payload,cwd='/opt/peticao/app'))
 fake.write_text('changed');assert not allowed(payload)
 target=tmp_path/'target.py';target.write_text('reviewed');fake.unlink();fake.symlink_to(target)
 assert not allowed(payload)


def test_approval_is_bound_to_managed_work_and_respects_pause(tmp_path):
 import json,time
 from vigia_monitor.store import Store
 from vigia_monitor.supervision import watch,install_plan,Supervisor
 from vigia_monitor.known_qa import approve_known
 s=Store(tmp_path/'monitor.sqlite');s.task('qa',state='running',cwd=str(CANDIDATE));watch(s,'qa')
 install_plan(s,'qa',[{'id':'work','title':'QA','body':'QA fictício','criteria':'Validação','checks':[['true']]}]);Supervisor(s).advance();r=s.claim()
 payload=json.dumps({'command':f'python3 {HELPER} types','cwd':str(CANDIDATE)})
 s.execute('INSERT INTO approvals VALUES(?,?,?,?,?,?,?,?,?)',('a',r['id'],'1','item/commandExecution/requestApproval',payload,'now',time.time()+60,None,0))
 s.task('qa',state='paused');approve_known(s);assert s.rows('SELECT decision FROM approvals')[0]['decision'] is None
 s.task('qa',state='running');approve_known(s);assert s.rows('SELECT decision FROM approvals')[0]['decision']=='accept'
 assert s.rows('SELECT count(*) n FROM events WHERE kind=?',('known_qa_authorized',))[0]['n']==1
