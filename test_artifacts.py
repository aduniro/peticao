import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest import mock

import artifacts as a


class ArtifactsTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='artifact-',dir=Path(__file__).parent)
        self.root=Path(self.tmp.name);self.source=self.root/'source';self.source.mkdir(mode=0o700)
        (self.source/'result.json').write_text('{"status":"fixture"}')
        (self.source/'artifacts').mkdir(mode=0o700);(self.source/'artifacts/evidence.txt').write_text('fixture evidence')
        self.identity={'job_id':'a'*32,'generation':1,'manifest_sha256':'b'*64,'receipt_sha256':'c'*64,'invocation_id':'d'*32,'worker_boot_id':'boot-1'}
        self.dest=self.root/'destination';self.dest.mkdir(mode=0o700);self.store=a.ArtifactStore(self.dest)

    def tearDown(self):self.tmp.cleanup()

    def payload(self):return a.pack(self.source,self.identity)

    def archive(self,rows):
        out=io.BytesIO()
        with tarfile.open(fileobj=out,mode='w') as tar:
            for item,raw in rows:tar.addfile(item,io.BytesIO(raw) if raw is not None else None)
        return out.getvalue()

    def test_roundtrip_and_full_custody(self):
        payload=self.payload();receipt=self.store.receive(payload,self.identity);observed=self.store.observe(self.identity)
        self.assertEqual(observed['state'],'verified');self.assertEqual(receipt['wire_sha256'],a.sha(payload))
        self.assertEqual(observed['result'],{'status':'fixture'})

    def test_duplicate_receive_never_overwrites(self):
        payload=self.payload();self.store.receive(payload,self.identity)
        before=(self.dest/self.identity['job_id']/'result.json').read_bytes()
        with self.assertRaises(FileExistsError):self.store.receive(payload,self.identity)
        self.assertEqual((self.dest/self.identity['job_id']/'result.json').read_bytes(),before)

    def test_wrong_identity_never_creates_intent(self):
        payload=self.payload()
        with self.assertRaises(PermissionError):self.store.receive(payload,{**self.identity,'generation':2})
        self.assertEqual(list(self.dest.iterdir()),[])

    def test_changed_contents_detected_at_observation(self):
        self.store.receive(self.payload(),self.identity)
        (self.dest/self.identity['job_id']/'artifacts/evidence.txt').write_text('tampered')
        with self.assertRaises(ValueError):self.store.observe(self.identity)

    def test_unexpected_file_refused(self):
        self.store.receive(self.payload(),self.identity);(self.dest/self.identity['job_id']/'unexpected').write_text('extra')
        with self.assertRaises(ValueError):self.store.observe(self.identity)

    def test_intent_without_published_directory_is_uncertain(self):
        a.durable_json(self.dest/(self.identity['job_id']+'.receive-intent.json'),{'identity':self.identity,'wire_sha256':'e'*64})
        self.assertEqual(self.store.observe(self.identity)['state'],'uncertain')
        with self.assertRaises(FileExistsError):self.store.receive(self.payload(),self.identity)

    def test_crash_during_rename_preserves_intent_and_stage(self):
        with mock.patch.object(a.os,'rename',side_effect=OSError('fixture interrupted publication')):
            with self.assertRaises(OSError):self.store.receive(self.payload(),self.identity)
        self.assertEqual(self.store.observe(self.identity)['state'],'uncertain')
        self.assertTrue(list(self.dest.glob('.receive-*')))

    def test_symlink_hardlink_fifo_inputs_refused(self):
        for kind in ('symlink','hardlink','fifo'):
            path=self.source/'artifacts/bad'
            if kind=='symlink':path.symlink_to(self.source/'result.json')
            elif kind=='hardlink':os.link(self.source/'result.json',path)
            else:os.mkfifo(path)
            with self.assertRaises((ValueError,OSError)):self.payload()
            path.unlink()

    def test_directory_link_refused(self):
        (self.source/'artifacts/sub').symlink_to(self.root,target_is_directory=True)
        with self.assertRaises(ValueError):self.payload()

    def test_no_paths_outside_protocol(self):
        for name in ('../x','/tmp/x','artifacts/../x','artifacts//x','artifacts/./x','artifacts/x/','x','artifacts\\x'):
            with self.assertRaises(ValueError):a.safe_name(name)

    def test_archive_links_devices_and_duplicates_refused(self):
        for kind in (tarfile.SYMTYPE,tarfile.LNKTYPE,tarfile.CHRTYPE,tarfile.DIRTYPE):
            item=tarfile.TarInfo('artifacts/bad');item.type=kind;item.linkname='../../outside'
            with self.assertRaises(ValueError):a.inspect(self.archive([(item,None)]),self.identity)
        item=tarfile.TarInfo('result.json');item.size=2
        with self.assertRaises(ValueError):a.inspect(self.archive([(item,b'{}'),(item,b'{}')]),self.identity)

    def test_archive_traversal_refused(self):
        item=tarfile.TarInfo('../outside');item.size=1
        with self.assertRaises(ValueError):a.inspect(self.archive([(item,b'x')]),self.identity)
        self.assertFalse((self.root/'outside').exists())

    def test_budget_refusal(self):
        with mock.patch.object(a,'MAX_BYTES',10):
            with self.assertRaises(ValueError):self.payload()

    def test_all_published_permissions_private(self):
        (self.source/'artifacts/a').mkdir();(self.source/'artifacts/a/b').mkdir();(self.source/'artifacts/a/b/file').write_text('nested')
        self.store.receive(self.payload(),self.identity)
        for path in (self.dest/self.identity['job_id']).rglob('*'):
            self.assertEqual(path.stat().st_mode&0o777,0o700 if path.is_dir() else 0o600)

    def test_receiver_root_link_and_public_mode_refused(self):
        link=self.root/'linked';link.symlink_to(self.dest,target_is_directory=True)
        with self.assertRaises(ValueError):a.ArtifactStore(link)
        self.dest.chmod(0o755)
        with self.assertRaises(PermissionError):a.ArtifactStore(self.dest)

    def test_invalid_generation_type_refused(self):
        with self.assertRaises(ValueError):a.pack(self.source,{**self.identity,'generation':True})


if __name__=='__main__':unittest.main()
