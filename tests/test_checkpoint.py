import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('checkpoint',ROOT/'checkpoint.py')
cp=importlib.util.module_from_spec(spec);spec.loader.exec_module(cp)
RECOVERY_SHA=json.loads((ROOT/'SOURCE-CUSTODY.json').read_text())['sha256']['recovery.py']


def fixture(root):
    root=Path(root);source=root/'source';source.mkdir(mode=0o700)
    worker=root/'worker';worker.mkdir(mode=0o700)
    (source/'authority.json').write_text(json.dumps({'role':'primary','generation':7,'armed_boot_id':'fictional-boot'}))
    (source/'config.json').write_text(json.dumps({'primary':{'hostname':'fictional-primary'}}))
    (source/'version.json').write_text(json.dumps({'infra_commit':'a'*40}))
    with sqlite3.connect(source/'queue.sqlite') as db:
        db.executescript('''PRAGMA journal_mode=WAL;
        CREATE TABLE jobs(id TEXT PRIMARY KEY,payload TEXT,digest TEXT,state TEXT,generation INTEGER,created_at TEXT,updated_at TEXT);
        CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT,job_id TEXT,kind TEXT,data TEXT);
        INSERT INTO jobs VALUES('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{"kind":"fixture-pass"}','fictional','completed',7,'fictional','fictional');
        INSERT INTO events(at,job_id,kind,data) VALUES('fictional','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','completed','{}');''')
    tree=source/'sources'/('b'*40)/'tree';tree.mkdir(parents=True)
    (tree/'run.sh').write_text('#!/bin/sh\nprintf "fictional only\\n"\n');(tree/'run.sh').chmod(0o755)
    (tree/'plain.txt').write_text('public data')
    (tree/'.env.local').write_text('FICTIONAL_PRIVATE=excluded')
    (tree/'.env.example').write_text('MAIL_PROVIDER=disabled')
    (tree/'.ssh').mkdir();(tree/'.ssh/id_ed25519').write_text('fictional excluded')
    (source/'bundles').mkdir();(source/'bundles/reference.txt').write_text('fictional bundle')
    job=worker/'jobs'/('a'*32);(job/'artifacts').mkdir(parents=True)
    (job/'state.json').write_text('{"state":"completed"}')
    (job/'result.json').write_text('{"exit_code":0}')
    (job/'output.log').write_text('fixture complete')
    (job/'artifacts/summary.txt').write_text('retained fixture artifact')
    return source,worker


class CheckpointTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir=ROOT/'test-work');self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.source,self.worker=fixture(self.root)
        self.recovery=cp.load_recovery(ROOT/'legacy/recovery.py',RECOVERY_SHA)

    def capture(self):return cp.capture(self.source,self.worker,self.root/'capture',self.recovery)

    def restore(self,meta,target=None):
        target=target or self.root/'restored'
        with patch.object(cp.os,'chown'):
            result=cp.restore(meta['snapshot'],target,meta['sha256'],meta['facts'],self.recovery,os.getuid(),os.getgid())
        return target,result

    def test_full_queue_schema_sequence_configs_sources_and_artifacts_preserved(self):
        before=cp.database_facts(self.source/'queue.sqlite');meta=self.capture();target,result=self.restore(meta)
        self.assertEqual(before,result['facts'])
        self.assertIn('sqlite_sequence',result['facts']['tables'])
        for name in ['config.json','version.json']:
            self.assertEqual((self.source/name).read_bytes(),(target/name).read_bytes())
        self.assertEqual((target/'recovered-worker/jobs'/('a'*32)/'artifacts/summary.txt').read_text(),'retained fixture artifact')
        self.assertFalse(result['full_disaster_recovery_proven'])
        self.assertFalse(result['services_started']);self.assertFalse(result['cutover'])

    def test_native_archive_kept_and_original_script_execution_restored_privately(self):
        meta=self.capture();target,result=self.restore(meta)
        self.assertTrue(Path(meta['native_snapshot_preserved']).is_file())
        name='coordinator/sources/'+('b'*40)+'/tree/run.sh'
        with tarfile.open(meta['native_snapshot_preserved']) as tf:
            self.assertNotIn('original_mode',json.load(tf.extractfile('manifest.json'))[name])
        with tarfile.open(meta['snapshot']) as tf:
            self.assertEqual(json.load(tf.extractfile('manifest.json'))[name]['original_mode'],0o755)
        script=target/'sources'/('b'*40)/'tree/run.sh'
        self.assertEqual(script.stat().st_mode&0o777,0o700)
        self.assertEqual((script.parent/'plain.txt').stat().st_mode&0o777,0o600)

    def test_standby_preserves_generation_and_discards_only_arm_and_primary_role(self):
        meta=self.capture();target,result=self.restore(meta)
        auth=json.loads((target/'authority.json').read_text())
        self.assertEqual(auth,{'role':'standby','generation':7,'armed_boot_id':None})
        self.assertEqual(json.loads((target/'generation-floor.json').read_text()),{'generation':7})
        self.assertEqual(cp.database_facts(self.source/'queue.sqlite'),meta['facts'])
        self.assertEqual(json.loads((self.source/'authority.json').read_text())['role'],'primary')

    def test_private_files_excluded_but_public_env_example_survives(self):
        meta=self.capture();target,_=self.restore(meta);tree=target/'sources'/('b'*40)/'tree'
        self.assertFalse((tree/'.env.local').exists());self.assertFalse((tree/'.ssh').exists())
        self.assertEqual((tree/'.env.example').read_text(),'MAIL_PROVIDER=disabled')

    def test_queue_or_active_work_refused_without_capture_directory(self):
        for state in ['queued','starting','running','unexpected']:
            with sqlite3.connect(self.source/'queue.sqlite') as db:db.execute('UPDATE jobs SET state=?',(state,))
            with self.assertRaises(ValueError):self.capture()
            self.assertFalse((self.root/'capture').exists())

    def test_existing_restore_target_even_empty_is_never_reused(self):
        meta=self.capture();target=self.root/'occupied';target.mkdir()
        with self.assertRaises(FileExistsError):self.restore(meta,target)
        self.assertEqual(list(target.iterdir()),[])

    def test_checksum_mismatch_fails_before_target_creation(self):
        meta=self.capture();meta['sha256']='0'*64
        with self.assertRaises(ValueError):self.restore(meta)
        self.assertFalse((self.root/'restored').exists())

    def test_unaugmented_native_checkpoint_refused_without_permission_metadata(self):
        meta=self.capture();meta['snapshot']=meta['native_snapshot_preserved'];meta['sha256']=meta['native_sha256']
        with self.assertRaises(ValueError):self.restore(meta)
        self.assertFalse((self.root/'restored').exists())

    def test_recovery_module_change_refused_before_import(self):
        with self.assertRaises(ValueError):cp.load_recovery(ROOT/'legacy/recovery.py','0'*64)

    def test_changed_source_during_capture_is_not_silently_accepted(self):
        original=cp.consistent_snapshot
        def changing(*args,**kwargs):
            result=original(*args,**kwargs)
            (self.source/'config.json').write_text('{"changed":true}')
            return result
        with patch.object(cp,'consistent_snapshot',side_effect=changing):
            with self.assertRaises(ValueError):self.capture()

    def test_open_wal_source_becomes_standalone_backup_without_wal_or_shm(self):
        with sqlite3.connect(self.source/'queue.sqlite') as live:
            live.execute('PRAGMA journal_mode=WAL')
            live.execute('INSERT INTO events(at,kind,data) VALUES("fixture","second","{}")');live.commit()
            self.assertTrue((self.source/'queue.sqlite-wal').exists())
            meta=self.capture();target,result=self.restore(meta)
            self.assertEqual(result['facts']['tables']['events']['rows'],2)
            with tarfile.open(meta['snapshot']) as tf:
                self.assertFalse(any(n.endswith(('queue.sqlite-wal','queue.sqlite-shm')) for n in tf.getnames()))
            self.assertFalse((target/'queue.sqlite-wal').exists())
            self.assertFalse((target/'queue.sqlite-shm').exists())

    def test_metadata_special_permission_bits_refused(self):
        script=self.source/'sources'/('b'*40)/'tree/run.sh';script.chmod(0o4755)
        with self.assertRaises(ValueError):self.capture()

    def test_source_symlink_is_not_backed_up_as_regular_data(self):
        tree=self.source/'sources'/('b'*40)/'tree';(tree/'linked').symlink_to('/etc/passwd')
        with self.assertRaises(ValueError):self.capture()

    def test_linked_source_or_worker_root_refused_before_capture(self):
        linked=self.root/'linked-source';linked.symlink_to(self.source,target_is_directory=True)
        with self.assertRaises(ValueError):cp.capture(linked,self.worker,self.root/'capture',self.recovery)
        linked=self.root/'linked-worker';linked.symlink_to(self.worker,target_is_directory=True)
        with self.assertRaises(ValueError):cp.capture(self.source,linked,self.root/'capture',self.recovery)
        self.assertFalse((self.root/'capture').exists())

    def test_restored_file_tampering_is_detected(self):
        meta=self.capture();target,_=self.restore(meta);(target/'config.json').write_text('{"tampered":true}')
        with self.assertRaises(ValueError):cp.verify_restored(meta['snapshot'],target,meta['facts'],self.recovery)

    def test_restored_table_or_schema_tampering_is_detected(self):
        meta=self.capture();target,_=self.restore(meta)
        with sqlite3.connect(target/'queue.sqlite') as db:db.execute('UPDATE jobs SET state="failed"')
        with self.assertRaises(ValueError):cp.verify_restored(meta['snapshot'],target,meta['facts'],self.recovery)

    def test_unsafe_archive_member_is_rejected_before_restore(self):
        evil=self.root/'evil.tar.gz'
        with tarfile.open(evil,'w:gz') as tf:
            info=tarfile.TarInfo('../escape');info.size=1;tf.addfile(info,io.BytesIO(b'x'))
        with self.assertRaises(ValueError):cp.read_manifest(evil,self.recovery)


if __name__=='__main__':unittest.main()
