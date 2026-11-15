import hashlib
import json
import multiprocessing
import os
import pickle
from pathlib import Path
import stat
import tempfile
import traceback
import unittest
from unittest import mock

import launch_tokens as t

HERE = Path(__file__).parent


def fixture_root(path):
    """Local fixture seam, not production's root/service ancestor guarantee."""
    p=Path(path);s=p.lstat()
    if not stat.S_ISDIR(s.st_mode) or s.st_uid!=os.geteuid() or stat.S_IMODE(s.st_mode)!=0o700:
        raise PermissionError('fixture_private_root_required')
    return p


def contender(root, allowed, manifest, reply):
    try:
        with t.TokenStore(root,validator=fixture_root,allowed_root=allowed) as store:
            store.prepare(manifest)
        reply.put('prepared')
    except FileExistsError:
        reply.put('existing')


def crash_during_factory(root, allowed, manifest):
    with t.TokenStore(root,validator=fixture_root,allowed_root=allowed,
                      factory=lambda:os._exit(41)) as store:
        store.prepare(manifest)


class CustodyTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='token-fixture-',dir=HERE)
        self.base=Path(self.tmp.name);self.root=self.base/'tokens';self.root.mkdir(mode=0o700)
        self.manifest={'job_id':'a'*32,'generation':1,'worker_id':'civo','coordinator_boot_id':'boot-1'}
        self.store=self.open_store()
        self.path=self.root/(self.manifest['job_id']+'.json')

    def open_store(self,**kw):
        return t.TokenStore(self.root,validator=fixture_root,allowed_root=self.base,**kw)

    def tearDown(self):
        self.store.close();self.tmp.cleanup()

    def test_prepare_is_durable_private_and_loads_same_secret(self):
        first=self.store.prepare(self.manifest)
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode),0o600)
        self.assertEqual(self.path.stat().st_nlink,1)
        self.store.close();self.store=self.open_store()
        self.assertEqual(first.sha256(),self.store.load(self.manifest).sha256())
        metadata=self.store.metadata(self.manifest)
        self.assertEqual(metadata['state'],'prepared')
        self.assertNotIn('token',metadata)
        self.assertEqual(metadata['token_sha256'],first.sha256())

    def test_prepare_never_overwrites_even_completed_envelope(self):
        first=self.store.prepare(self.manifest);before=self.path.read_bytes()
        with self.assertRaises(FileExistsError):self.store.prepare(self.manifest)
        self.assertEqual(self.path.read_bytes(),before)
        self.assertEqual(self.store.load(self.manifest).sha256(),first.sha256())

    def test_missing_load_does_not_generate(self):
        self.store.factory=lambda:self.fail('no generation on read')
        with self.assertRaises(FileNotFoundError):self.store.load(self.manifest)
        self.assertFalse(self.path.exists())

    def test_restrictive_umask_cannot_make_prepared_custody_unreadable(self):
        previous=os.umask(0o777)
        try:secret=self.store.prepare(self.manifest)
        finally:os.umask(previous)
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode),0o600)
        self.assertEqual(secret.sha256(),self.store.load(self.manifest).sha256())

    def test_incomplete_intent_never_regenerates(self):
        self.path.touch(mode=0o600)
        self.store.factory=lambda:self.fail('no replacement token')
        with self.assertRaises(t.CustodyUncertain):self.store.load(self.manifest)
        with self.assertRaises(FileExistsError):self.store.prepare(self.manifest)
        self.assertEqual(self.path.stat().st_size,0)

    def test_sync_failure_during_recovery_yields_no_secret_or_regeneration(self):
        self.store.prepare(self.manifest)
        before=self.path.read_bytes()
        for fail_call in (1,2):
            calls=[]
            real_fsync=os.fsync
            def fail(fd):
                calls.append(fd)
                if len(calls)==fail_call:raise OSError('fixture failed sync')
                return real_fsync(fd)
            with self.subTest(fail_call=fail_call),mock.patch.object(t.os,'fsync',side_effect=fail):
                with self.assertRaises(t.CustodyUncertain):self.store.load(self.manifest)
            with self.assertRaises(FileExistsError):self.store.prepare(self.manifest)
            self.assertEqual(self.path.read_bytes(),before)

    def test_recovery_syncs_complete_file_and_parent_before_return(self):
        self.store.prepare(self.manifest)
        calls=[];real_fsync=os.fsync
        def record(fd):
            calls.append((fd,stat.S_ISREG(os.fstat(fd).st_mode)))
            return real_fsync(fd)
        with mock.patch.object(t.os,'fsync',side_effect=record):self.store.load(self.manifest)
        self.assertEqual([regular for _,regular in calls],[True,False])
        self.assertEqual(calls[-1][0],self.store.fd)

    def test_crash_after_durable_intent_remains_uncertain(self):
        p=multiprocessing.Process(target=crash_during_factory,args=(self.root,self.base,self.manifest));p.start();p.join(10)
        self.assertEqual(p.exitcode,41);self.assertEqual(self.path.stat().st_size,0)
        with self.assertRaises(t.CustodyUncertain):self.store.load(self.manifest)
        with self.assertRaises(FileExistsError):self.store.prepare(self.manifest)

    def test_concurrent_prepare_only_one_winner(self):
        replies=multiprocessing.Queue()
        processes=[multiprocessing.Process(target=contender,args=(self.root,self.base,self.manifest,replies)) for _ in range(2)]
        for p in processes:p.start()
        for p in processes:p.join(10);self.assertEqual(p.exitcode,0)
        self.assertEqual(sorted([replies.get(timeout=2),replies.get(timeout=2)]),['existing','prepared'])
        self.assertEqual(len(list(self.root.iterdir())),1)
        self.assertEqual(self.store.metadata(self.manifest)['state'],'prepared')

    def test_changed_boot_or_profile_or_generation_cannot_load_old_secret(self):
        self.store.prepare(self.manifest)
        for changed in ({**self.manifest,'generation':2},{**self.manifest,'coordinator_boot_id':'boot-2'},{**self.manifest,'worker_id':'akamai'}):
            with self.subTest(changed=changed),self.assertRaises(t.CustodyUncertain):self.store.load(changed)

    def test_job_identity_blocks_path_injection_and_bool_generation(self):
        for changed in ({**self.manifest,'job_id':'../../escape'},{**self.manifest,'generation':True},{**self.manifest,'generation':0}):
            with self.assertRaises(ValueError):self.store.prepare(changed)
        self.assertFalse(list(self.root.iterdir()))

    def test_manifest_hash_matches_existing_contract_canonical_encoding(self):
        raw=json.dumps(self.manifest,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
        self.assertEqual(t.reference(self.manifest)['manifest_sha256'],hashlib.sha256(raw).hexdigest())

    def test_oversized_or_nonfinite_manifest_refused_before_effect(self):
        for changed in ({**self.manifest,'extra':'x'*65537},{**self.manifest,'extra':float('nan')}):
            with self.assertRaises(ValueError):self.store.prepare(changed)
        self.assertFalse(list(self.root.iterdir()))

    def test_link_hardlink_fifo_and_permissions_are_uncertain(self):
        secret=self.store.prepare(self.manifest)
        original=self.path.read_bytes();self.path.unlink()
        other=self.base/'other';other.write_bytes(original);other.chmod(0o600)
        self.path.symlink_to(other)
        with self.assertRaises(t.CustodyUncertain):self.store.load(self.manifest)
        self.path.unlink();os.link(other,self.path)
        with self.assertRaises(t.CustodyUncertain):self.store.load(self.manifest)
        self.path.unlink();os.mkfifo(self.path,0o600)
        with self.assertRaises(t.CustodyUncertain):self.store.load(self.manifest)
        self.path.unlink();self.path.write_bytes(original);self.path.chmod(0o644)
        with self.assertRaises(t.CustodyUncertain):self.store.load(self.manifest)
        self.assertNotIn(secret.value_for_dispatch(),repr(secret))

    def test_corrupt_duplicate_or_extra_json_fields_refused(self):
        self.store.prepare(self.manifest);original=self.path.read_bytes();value=json.loads(original)
        examples=[b'{',b'[]',original[:-2]+b',"version":1}',json.dumps({**value,'extra':'forbidden'}).encode(),json.dumps({**value,'generation':True}).encode(),json.dumps({**value,'token':'invalid'}).encode(),b'x'*4097]
        for raw in examples:
            self.path.write_bytes(raw)
            with self.subTest(size=len(raw)),self.assertRaises(t.CustodyUncertain):self.store.load(self.manifest)

    def test_exception_and_repr_do_not_emit_secret_or_parser_excerpt(self):
        secret=self.store.prepare(self.manifest)
        self.path.write_text('{"token":"'+secret.value_for_dispatch())
        try:self.store.load(self.manifest)
        except t.CustodyUncertain:
            message=traceback.format_exc()
        else:self.fail('corrupt envelope accepted')
        self.assertNotIn(secret.value_for_dispatch(),message)
        self.assertNotIn('JSONDecodeError',message)
        self.assertEqual(repr(secret),'<LaunchSecret redacted>')
        self.assertEqual(str(secret),'<LaunchSecret redacted>')
        with self.assertRaises(TypeError):json.dumps(secret)
        with self.assertRaises(TypeError):pickle.dumps(secret)

    def test_replaced_root_never_uses_stale_fd(self):
        self.root.rename(self.base/'retained');self.root.mkdir(mode=0o700)
        with self.assertRaises(PermissionError):self.store.prepare(self.manifest)
        self.assertFalse(list(self.root.iterdir()))

    def test_closed_store_cannot_prepare_or_load(self):
        self.store.close()
        with self.assertRaises(PermissionError):self.store.prepare(self.manifest)
        with self.assertRaises(PermissionError):self.store.load(self.manifest)

    def test_no_implicit_root_creation_or_scope_escape(self):
        with self.assertRaises(PermissionError):t.TokenStore('/tmp/foreign')
        with self.assertRaises(PermissionError):t.TokenStore(self.base/'tokens/../outside',allowed_root=self.base)
        with self.assertRaises(FileNotFoundError):t.TokenStore(self.base/'absent',validator=fixture_root,allowed_root=self.base)

    def test_default_validator_refuses_public_or_linked_leaf(self):
        self.root.chmod(0o755)
        with self.assertRaises(PermissionError):t.private_root(self.root)
        self.root.chmod(0o700)
        link=self.base/'link';link.symlink_to(self.root,target_is_directory=True)
        with self.assertRaises(PermissionError):t.private_root(link)


if __name__=='__main__':unittest.main()
