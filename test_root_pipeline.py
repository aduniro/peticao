"""Real private FS/stream/rename, modeled Root authority only. No SSH/candidates."""
import hashlib,io,json,os,tempfile,unittest
from pathlib import Path
from unittest import mock
import root_entry as e
import materializer as m
from test_materializer import package,archive
HERE=Path(__file__).resolve().parent

class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='root-pipeline-',dir=HERE);self.root=Path(self.tmp.name);self.runtime=self.root/'runtime';self.runtime.mkdir(mode=0o700);self.opt=self.root/'opt';self.opt.mkdir(mode=0o755);self.prefix=self.opt/'tools';self.intent=self.opt/'.intent'
        self.bodies,self.files=package();self.bodies['driver-policy.json']=json.dumps({'tools_root':m.PREFIX,'execution_enabled':True,'qualified':False,'operationalReady':False,'qualification_release_event':11}).encode();self.files['driver-policy.json'].update(sha256=hashlib.sha256(self.bodies['driver-policy.json']).hexdigest(),bytes=len(self.bodies['driver-policy.json']))
        self.payload=archive(self.bodies,self.files).getvalue();self.plan={'operation_id':'a'*32,'execution_notice':10,'source_notice':9,'qualification_release_event':11,'payload_bytes':len(self.payload),'payload_sha256':hashlib.sha256(self.payload).hexdigest(),'deadline_unix':__import__('time').time()+300,'files':self.files,'unpacked_bytes':sum(x['bytes']for x in self.files.values())}
        self.patches=[mock.patch.object(e,'PREFIX',self.prefix),mock.patch.object(e,'INTENT',self.intent),mock.patch.object(e,'RUNTIME',self.runtime),mock.patch.object(e,'guard',return_value=None),mock.patch.object(e,'header',side_effect=lambda value,**kw:(m.validate_files(value['files'],value['unpacked_bytes'])and value))]
        for p in self.patches:p.start()
    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        self.tmp.cleanup()
    def wire(self,payload=True):
        raw=json.dumps(self.plan,sort_keys=True,separators=(',',':')).encode();return io.BytesIO(len(raw).to_bytes(8,'big')+raw+(self.payload if payload else b''))
    def test_complete_real_spool_extract_noreplace_publication_and_new_receipt(self):
        result=e.install(self.wire());self.assertEqual(result['state'],'SEALED_PUBLIC_TOOLCHAIN_CANDIDATE_PUBLISHED');self.assertFalse(result['candidate_programs_executed']);self.assertTrue(self.prefix.exists());self.assertTrue(self.intent.exists())
        op=self.runtime/('civo-toolchain-install-'+'a'*32);self.assertTrue((op/'receipt.json').exists());self.assertTrue((op/'payload.tar.gz').exists());self.assertFalse((op/'tree').exists())
        with self.assertRaises(FileExistsError):e.install(self.wire())
    def test_truncated_or_bad_digest_preserves_global_intent_and_partial(self):
        wire=self.wire().getvalue()[:-3]
        with self.assertRaises(EOFError):e.install(io.BytesIO(wire))
        self.assertTrue(self.intent.exists());self.assertFalse(self.prefix.exists())
        op=self.runtime/('civo-toolchain-install-'+'a'*32);self.assertTrue((op/'payload.tar.gz').exists())
        with self.assertRaises(FileExistsError):e.install(self.wire())
    def test_lost_receipt_after_visible_publication_cannot_repeat_and_is_observe_only(self):
        record=e.record
        def fail_receipt(path,value):
            if Path(path).name=='receipt.json':raise OSError('synthetic directory durability failure')
            return record(path,value)
        with mock.patch.object(e,'record',side_effect=fail_receipt),self.assertRaises(OSError):e.install(self.wire())
        self.assertTrue(self.prefix.exists())
        with self.assertRaises(FileExistsError):e.install(self.wire())
        # Owner principal is modeled for these fixture records only; no wire UID.
        with mock.patch.object(e,'read_record',side_effect=lambda path:json.loads(Path(path).read_text())),mock.patch.object(e,'writer_alive',return_value=False):
            result=e.observe(self.wire(payload=False));self.assertEqual(result['state'],'PARTIAL_OR_VISIBLE_WITHOUT_RECEIPT_RECONCILIATION_REQUIRED');self.assertTrue(result['no_retry'])
    def test_unplanned_empty_directory_rejected_during_public_tree_recheck(self):
        e.install(self.wire());(self.prefix/'unplanned').mkdir(mode=0o755);tree=m.Tree(self.prefix)
        try:
            with self.assertRaises(ValueError):tree.verify(self.files)
        finally:tree.close()

    def test_missing_required_empty_config_directory_rejected(self):
        e.install(self.wire());(self.prefix/'empty-config').rmdir();tree=m.Tree(self.prefix)
        try:
            with self.assertRaises(ValueError):tree.verify(self.files)
        finally:tree.close()

if __name__=='__main__':unittest.main()
