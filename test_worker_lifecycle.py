import json
from pathlib import Path
import tempfile
from unittest.mock import patch, Mock
import unittest
import worker_lifecycle as worker


class WorkerAttestation(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);(self.root/'control').mkdir()
        self.patch=patch.object(worker,'ROOT',self.root);self.patch.start();self.addCleanup(self.patch.stop)
        self.identity={'instance_id':'own','resource_ids':['own']}
        self.state={'mode':'setup-only','development_jobs_enabled':False,'setup_complete':True,'admission_closed':True}
        self.save()
    def save(self):
        (self.root/'control/identity.json').write_text(json.dumps(self.identity))
        (self.root/'control/state.json').write_text(json.dumps(self.state))
    def test_does_not_claim_empty_development_queue(self):
        self.state['development_jobs_enabled']=True;self.save()
        with self.assertRaises(ValueError):worker.handle({'action':'snapshot','instance_id':'own'})
    def test_incomplete_setup_cannot_be_exported_as_quiescent(self):
        self.state['setup_complete']=False;self.save()
        with self.assertRaises(ValueError):worker.handle({'action':'snapshot','instance_id':'own'})
    def test_missing_data_volume_cannot_produce_complete_backup_proof(self):
        self.identity.update(volume_id='owned-volume',volume_fs_uuid='expected');self.save()
        with patch.object(worker.subprocess,'run',return_value=Mock(returncode=0,stdout='wrong\n')):
            with self.assertRaises(ValueError):worker.handle({'action':'snapshot','instance_id':'own'})
    def test_other_worker_identity_is_rejected(self):
        with self.assertRaises(ValueError):worker.handle({'action':'snapshot','instance_id':'other'})


if __name__=='__main__':unittest.main()
