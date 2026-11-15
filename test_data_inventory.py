import hashlib,os
from pathlib import Path
import tempfile,unittest
import data_inventory as d
HERE=Path(__file__).resolve().parent

class InputDataTests(unittest.TestCase):
    def setUp(self):self.tmp=tempfile.TemporaryDirectory(prefix='data-fd-',dir=HERE);self.root=Path(self.tmp.name);self.p=self.root/'a';self.p.write_bytes(b'public fixture');self.p.chmod(0o600);self.row={'sha256':hashlib.sha256(self.p.read_bytes()).hexdigest(),'bytes':14}
    def tearDown(self):self.tmp.cleanup()
    def test_exact_family_and_byte_preimage(self):
        r=d.family(self.root,{'a':self.row},'python312',1,14);self.assertEqual(r['python312/a']['sha256'],self.row['sha256']);self.assertEqual(r['python312/a']['future_Root_mode'],'0o644')
        self.p.write_bytes(b'changed')
        with self.assertRaises(ValueError):d.family(self.root,{'a':self.row},'python312',1,14)
    def test_symlinks_hardlinks_extra_and_escape_refused(self):
        link=self.root/'link';link.symlink_to(self.p)
        with self.assertRaises((OSError,PermissionError)):d.read(link,self.row['sha256'],14)
        with self.assertRaises(ValueError):d.family(self.root,{'a':self.row},'python312',1,14)
        link.unlink();os.link(self.p,link)
        with self.assertRaises(PermissionError):d.read(self.p,self.row['sha256'],14)
        for p in ('../a','/a','x/../a','x//a','x\\a'):
            with self.assertRaises(ValueError):d.relative(p)
    def test_modes_and_output_count_are_not_relaxed(self):
        self.p.chmod(0o644)
        with self.assertRaises(PermissionError):d.read(self.p,self.row['sha256'],14)
        self.p.chmod(0o600)
        with self.assertRaises(ValueError):d.family(self.root,{'a':self.row},'python312',2,14)
        self.root.chmod(0o755)
        with self.assertRaises(PermissionError):d.family(self.root,{'a':self.row},'python312',1,14)

if __name__=='__main__':unittest.main()
