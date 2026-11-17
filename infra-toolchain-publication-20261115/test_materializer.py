import hashlib,io,json,os,stat,tarfile,tempfile,unittest
from pathlib import Path
from unittest import mock
import materializer as m
import root_entry as entry
HERE=Path(__file__).resolve().parent


def package():
    bodies={n:('synthetic '+n).encode()for n in m.HELPERS|m.QA|m.INPUTS|{'driver.py','driver-policy.json','catalog.candidates.json','node20'}}
    for root in sorted(m.ROOTS):bodies[root+'/a']=b'public data'
    files={n:{'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'mode':0o755 if n=='node20' else 0o644}for n,raw in bodies.items()}
    return bodies,files


def archive(bodies,files,change=None):
    out=io.BytesIO()
    with tarfile.open(fileobj=out,mode='w:gz',format=tarfile.GNU_FORMAT)as tf:
        for name,raw in bodies.items():
            t=tarfile.TarInfo(name);t.uid=t.gid=0;t.mode=files[name]['mode'];t.size=len(raw)
            if change:t=change(t)
            tf.addfile(t,io.BytesIO(raw)if t.type in{tarfile.REGTYPE,tarfile.AREGTYPE}else None)
    out.seek(0);return out


class MaterializerTests(unittest.TestCase):
    def setUp(self):self.tmp=tempfile.TemporaryDirectory(prefix='installer-fixture-',dir=HERE);self.root=Path(self.tmp.name);self.stage=self.root/'stage';self.stage.mkdir(mode=0o755);self.bodies,self.files=package()
    def tearDown(self):self.tmp.cleanup()
    def test_real_extraction_hashes_modes_emptyconfig_and_atomic_publication(self):
        m.validate_files(self.files,sum(r['bytes']for r in self.files.values()));tree=m.Tree(self.stage)
        try:
            old=os.umask(0o077)
            try:m.extract(archive(self.bodies,self.files),tree,self.files)
            finally:os.umask(old)
            self.assertTrue((self.stage/'empty-config').is_dir());self.assertEqual((self.stage/'node20').stat().st_mode&0o777,0o755)
            destination=self.root/'published';m.rename_noreplace(self.stage,destination);tree.path=str(destination);self.assertTrue(tree.verify(self.files))
            self.assertFalse(self.stage.exists())
        finally:tree.close()
    def test_all_five_provenance_inputs_required_before_effect(self):
        for name in sorted(m.INPUTS):
            files=dict(self.files);files.pop(name)
            with self.assertRaises(ValueError):m.validate_files(files,sum(r['bytes']for r in files.values()))
        self.assertEqual(list(self.stage.iterdir()),[])
    def test_existing_empty_destination_is_never_replaced(self):
        dest=self.root/'existing';dest.mkdir();identity=dest.stat().st_ino
        with self.assertRaises(OSError):m.rename_noreplace(self.stage,dest)
        self.assertEqual(dest.stat().st_ino,identity);self.assertTrue(self.stage.exists())
    def test_tar_links_traversal_and_duplicate_members_refused_before_any_write(self):
        tree=m.Tree(self.stage)
        try:
            for transform in [lambda t:(setattr(t,'type',tarfile.SYMTYPE)or setattr(t,'linkname','/tmp/a')or t),lambda t:(setattr(t,'name','../evil')or t),lambda t:(setattr(t,'name','node20')or t)]:
                with self.assertRaises((ValueError,PermissionError)):m.extract(archive(self.bodies,self.files,transform),tree,self.files)
                self.assertEqual(list(self.stage.iterdir()),[])
        finally:tree.close()
    def test_corrupt_content_preserves_partial_and_prevents_receipt_or_replay(self):
        tree=m.Tree(self.stage)
        try:
            row={'sha256':'f'*64,'bytes':4,'mode':0o644}
            with self.assertRaises(ValueError):tree.create_file('python312/a',row,io.BytesIO(b'data'))
            self.assertEqual((self.stage/'python312/a').read_bytes(),b'data')
            with self.assertRaises(FileExistsError):tree.create_file('python312/a',row,io.BytesIO(b'data'))
        finally:tree.close()
    def test_nested_directory_replacement_rejected_before_writing_new_bytes(self):
        tree=m.Tree(self.stage)
        try:
            fd=tree.directory('python312/bin',create=True);os.close(fd)
            previous=self.stage/'python312/bin';previous.rename(self.stage/'python312/old-bin');previous.mkdir(mode=0o755)
            with self.assertRaises(PermissionError):tree.create_file('python312/bin/python3.12',{'sha256':hashlib.sha256(b'x').hexdigest(),'bytes':1,'mode':0o755},io.BytesIO(b'x'))
            self.assertEqual(list(previous.iterdir()),[])
        finally:tree.close()
    def test_tree_root_replacement_is_refused(self):
        tree=m.Tree(self.stage)
        try:
            self.stage.rename(self.root/'old-stage');self.stage.mkdir(mode=0o755)
            with self.assertRaises(PermissionError):tree.directory('a',create=True)
            self.assertEqual(list(self.stage.iterdir()),[])
        finally:tree.close()
    def test_exact_plan_refuses_bad_paths_modes_and_file_directory_collision(self):
        total=sum(r['bytes']for r in self.files.values())
        for name,row in [('../x',{'sha256':'a'*64,'bytes':0,'mode':0o644}),('extra.sh',{'sha256':'a'*64,'bytes':0,'mode':0o644}),('node20/a',{'sha256':'a'*64,'bytes':0,'mode':0o644})]:
            with self.subTest(name=name),self.assertRaises(ValueError):m.validate_files({**self.files,name:row},total)
        for mode in (0o4755,True,0o777):
            files={**self.files,'node20':{**self.files['node20'],'mode':mode}}
            with self.assertRaises(ValueError):m.validate_files(files,total)
    def test_root_entry_rejects_actual_nonroot_before_reading_or_writing(self):
        if os.geteuid()==0:self.skipTest('operator test must not impersonate Root')
        unread=mock.Mock()
        with self.assertRaises(PermissionError):entry.install(unread)
        unread.read.assert_not_called()

if __name__=='__main__':unittest.main()
