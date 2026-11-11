from pathlib import Path
import hashlib
import io
import json
import tarfile
import tempfile
import unittest
import runtime_extract as m

class ExtractionBoundary(unittest.TestCase):
    def build(self, root, member_name='runtime/package.json', member_type=tarfile.REGTYPE,
              duplicate=False, content=b'fixture', expected=b'fixture'):
        manifest = {'schema_version':1, 'runtime_format':'next-start-v1',
                    'source_commit':'f55595cd348c23ffe559dba2de9150259db9f1e7',
                    'release_id':'r0002-portable-f55595c-20261111',
                    'files':{'package.json':{'bytes':len(expected),'sha256':hashlib.sha256(expected).hexdigest()}}}
        data = json.dumps(manifest).encode(); mp=root/'manifest.json';mp.write_bytes(data)
        archive = root/'runtime.tar'
        with tarfile.open(archive,'w') as tar:
            info=tarfile.TarInfo('release-manifest.json');info.size=len(data);tar.addfile(info,io.BytesIO(data))
            info=tarfile.TarInfo(member_name);info.type=member_type
            if member_type==tarfile.REGTYPE:info.size=len(content)
            else:info.linkname='package.json'
            tar.addfile(info,io.BytesIO(content) if member_type==tarfile.REGTYPE else None)
            if duplicate:tar.addfile(info,io.BytesIO(content))
        return archive,mp,root/'run',m.digest(archive),m.digest(mp)
    def extract(self, args):return m.extract_verified(*args[:3],archive_sha=args[3],manifest_sha=args[4],count=1)
    def test_valid_fixture_and_reject_overlay(self):
        with tempfile.TemporaryDirectory() as tmp:
            args=self.build(Path(tmp));proof=self.extract(args)
            self.assertEqual(proof['verifiedFiles'],1)
            self.assertFalse(proof['runtimeStarted'])
            with self.assertRaisesRegex(ValueError,'run_exists'):self.extract(args)
    def test_traversal_absolute_and_malformed_names(self):
        for name in ['../outside','/outside','runtime/../outside','runtime//package.json','runtime/./package.json','runtime\\package.json']:
            with self.subTest(name=name),tempfile.TemporaryDirectory() as tmp:
                args=self.build(Path(tmp),member_name=name)
                with self.assertRaises(ValueError):self.extract(args)
                self.assertFalse(args[2].exists())
    def test_symlink_hardlink_fifo_and_device_rejected(self):
        for kind in [tarfile.SYMTYPE,tarfile.LNKTYPE,tarfile.FIFOTYPE,tarfile.CHRTYPE]:
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as tmp:
                args=self.build(Path(tmp),member_type=kind)
                with self.assertRaisesRegex(ValueError,'nonregular'):self.extract(args)
                self.assertFalse(args[2].exists())
    def test_archive_and_manifest_digests_fail_closed(self):
        for idx in [3,4]:
            with tempfile.TemporaryDirectory() as tmp:
                args=list(self.build(Path(tmp)));args[idx]='0'*64
                with self.assertRaisesRegex(ValueError,'digest_mismatch'):self.extract(args)
                self.assertFalse(args[2].exists())
    def test_corrupt_member_rejected_before_directory_created(self):
        with tempfile.TemporaryDirectory() as tmp:
            args=self.build(Path(tmp),content=b'changed')
            with self.assertRaisesRegex(ValueError,'content_mismatch'):self.extract(args)
            self.assertFalse(args[2].exists())
    def test_duplicate_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            args=self.build(Path(tmp),duplicate=True)
            with self.assertRaisesRegex(ValueError,'member_count'):self.extract(args)
    def test_post_extraction_extra_symlink_and_hash_change_rejected(self):
        for mutation in ['extra','symlink','change']:
            with self.subTest(mutation=mutation),tempfile.TemporaryDirectory() as tmp:
                args=self.build(Path(tmp));self.extract(args);runtime=args[2]/'runtime'
                if mutation=='extra':(runtime/'extra').write_text('unexpected')
                elif mutation=='symlink':(runtime/'link').symlink_to(runtime/'package.json')
                else:(runtime/'package.json').write_text('changed')
                with self.assertRaises(ValueError):m.verify_runtime(runtime,json.loads(args[1].read_text()),count=1)
    def test_sensitive_names_rejected(self):
        for name in ['.env.local','secrets/token','credentials/foo','identity.pfx']:
            with self.assertRaisesRegex(ValueError,'sensitive'):m.safe_name(name)

if __name__=='__main__':unittest.main()
