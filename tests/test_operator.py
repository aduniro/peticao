import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('standby_operator', ROOT/'operator.py')
op = importlib.util.module_from_spec(spec)
spec.loader.exec_module(op)


def packet():
    files = {p.name:p.read_bytes() for p in (ROOT/'runtime').glob('*.py')}
    files['standby.service'] = (ROOT/'standby.service').read_bytes()
    return {'commit':'a'*40, 'runtime':{k:base64.b64encode(v).decode() for k,v in files.items() if k!='standby.service'},
            'unit':base64.b64encode(files['standby.service']).decode(),
            'hashes':{k:hashlib.sha256(v).hexdigest() for k,v in files.items()}}


class OperatorTests(unittest.TestCase):
    def setUp(self):
        t = tempfile.TemporaryDirectory(dir=ROOT/'test-work')
        self.addCleanup(t.cleanup)
        self.root=Path(t.name)
        for key,relative in [('CODE','opt/code'),('QUEUE','srv/queue'),('UNIT','etc/unit.service'),('STATE','var/state')]:
            p=self.root/relative;p.parent.mkdir(parents=True,exist_ok=True)
            q=patch.object(op,key,p);q.start();self.addCleanup(q.stop)
        self.created=False;self.commands=[]
        self.person={'uid':999,'gid':998,'shell':'/usr/sbin/nologin','home':'/nonexistent'}
        for q in [patch.object(op,'identity',side_effect=lambda:self.person if self.created else None),
                  patch.object(op,'unit_state',return_value={'LoadState':'not-found','ActiveState':'inactive'}),
                  patch.object(op,'inspect',side_effect=self.inspect),
                  patch.object(op.os,'chown',return_value=None),
                  patch.object(op.os,'geteuid',return_value=0),
                  patch.object(op.socket,'gethostname',return_value='peticao-civo'),
                  patch.object(op,'ROOT_UID',os.getuid()),
                  patch.object(op,'run',side_effect=self.run_command)]:
            q.start();self.addCleanup(q.stop)
        # Fixture paths deliberately live under /tmp; production preflight is
        # tested separately and is never run against the live host by this suite.
        self.real_preflight=op.preflight
        q=patch.object(op,'preflight',side_effect=self.preflight);q.start();self.addCleanup(q.stop)

    def inspect(self):
        return {'hostname':'peticao-civo','root':True,'available_bytes':30*2**30,
                'paths_present':{str(p):p.exists() or p.is_symlink() for p in [op.CODE,op.QUEUE,op.UNIT,op.STATE]},
                'identity':op.identity(),'unit':op.unit_state()}

    def preflight(self,p):
        op.decode(p)
        d=self.inspect()
        if any(d['paths_present'].values()) or d['identity']:
            raise FileExistsError('fixture occupied')
        return d

    def run_command(self,argv,**kwargs):
        self.commands.append(argv)
        if argv[0]=='useradd':self.created=True
        class Result:
            returncode=0
            stdout='imports_ok\n'
        return Result()

    def apply(self):
        return op.apply(packet(),{'lease':'fixture-own-lease','fence':400,'operator':'infra'})

    def test_staging_never_creates_queue_or_starts_enables_reloads_services(self):
        r=self.apply()
        self.assertEqual(r['phase'],'code_staged_inactive')
        self.assertFalse(op.QUEUE.exists())
        self.assertEqual(set(p.name for p in op.CODE.iterdir()),op.MODULES)
        self.assertFalse(any(c[0]=='systemctl' for c in self.commands))
        self.assertTrue(self.person['shell'].endswith('nologin'))

    def test_existing_code_or_queue_not_overwritten(self):
        for p in [op.CODE,op.QUEUE]:
            p.mkdir()
            with self.assertRaises(FileExistsError):self.apply()
            p.rmdir()
        self.assertEqual(self.commands,[])

    def test_changed_packet_rejected_before_account_creation(self):
        p=packet();p['hashes']['coordinator.py']='0'*64
        with self.assertRaises(ValueError):op.apply(p,{'lease':'fixture','fence':400})
        self.assertFalse(self.created)

    def test_unknown_module_rejected(self):
        p=packet();p['runtime']['foreign.py']=''
        with self.assertRaises(ValueError):op.decode(p)

    def test_rollback_only_removes_owned_files_and_retains_locked_identity(self):
        self.apply();r=op.rollback()
        self.assertFalse(op.CODE.exists());self.assertFalse(op.UNIT.exists())
        self.assertTrue(r['identity_retained_nologin'])
        self.assertTrue(self.created)
        self.assertFalse(any(c[0]=='userdel' for c in self.commands))

    def test_rollback_refuses_changed_file_or_unowned_content(self):
        self.apply();foreign=op.CODE/'foreign';foreign.write_text('keep')
        with self.assertRaises(ValueError):op.rollback()
        self.assertTrue(foreign.exists());self.assertTrue(op.UNIT.exists())
        foreign.unlink();target=op.CODE/'coordinator.py';target.write_text('changed')
        with self.assertRaises(ValueError):op.rollback()
        self.assertTrue(target.exists())

    def test_symlink_file_cannot_be_verified(self):
        self.apply();p=op.CODE/'coordinator.py';other=self.root/'other';p.rename(other);p.symlink_to(other)
        with self.assertRaises(ValueError):op.verify()

    def test_active_or_initialized_staging_cannot_be_rolled_back(self):
        self.apply();op.QUEUE.mkdir()
        with self.assertRaises(ValueError):op.rollback()
        self.assertTrue(op.CODE.exists())

    def test_production_preflight_rejects_untrusted_fixture_ancestor(self):
        with self.assertRaises(ValueError):self.real_preflight(packet())

    def test_missing_execution_audit_metadata_is_rejected(self):
        with self.assertRaises(ValueError):op.apply(packet(),{})
        self.assertEqual(self.commands,[])


if __name__=='__main__':unittest.main()
