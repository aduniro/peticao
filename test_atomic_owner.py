"""Root producer -> real UID999/GID987 reader, private fictitious files only."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import stat
import sqlite3
import tempfile
import types
import unittest
from unittest import mock

import atomic_metadata as atomic
import authority_guard
import recovery
import remote_contract

HERE = Path(__file__).resolve().parent


@unittest.skipUnless(os.geteuid() == 0, "real root producer required; never count skipped as qualification")
class RootOwnership(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="fixture-", dir=HERE)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.target = self.root / "coordinator"
        self.target.mkdir(mode=0o700)
        os.chown(self.target, 999, 987)
        self.operator = self.root / "operator"
        self.operator.mkdir(mode=0o700)
        self.boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        self.floor = {"generation":2,"primary_host":"civo","coordinator_boot_id":self.boot,"operation_id":"a"*32}
        self.guard = self.operator / "epoch.json"
        self.write(self.guard,self.floor,(0,0))
        self.write(self.target/"authority.json",{"role":"standby","generation":1,"armed_boot_id":None})
        self.write(self.target/"generation-floor.json",{"generation":1})
        self.write(self.target/"recovery-origin.json",{"source_host":"sonda-verifica3","generation":1})
        self.proof={"previous_host":"sonda-verifica3","previous_generation":1,"new_generation":2,"method":"coordinator-stopped","verified":True,
                    "coordinator_host":"civo","coordinator_boot_id":self.boot,"authority_operation_id":"a"*32,"epoch_sha256":remote_contract.digest(self.floor)}
        self.proof_path=self.operator/"proof.json";self.write(self.proof_path,self.proof,(0,0))
        # Fixture-only injection; the installed /etc guard and baseline are never used.
        for patch in (mock.patch.object(authority_guard,"GUARD",remote_contract.EpochGuard(self.guard,remote_contract.private_file)),
                      mock.patch.object(authority_guard,"local_node",return_value="civo")):
            patch.start();self.addCleanup(patch.stop)
        self.guard_before=self.guard.read_bytes()

    def write(self,path,value,owner=(999,987)):
        path.write_text(json.dumps(value));os.chown(path,*owner);path.chmod(0o600)

    def meta(self,path):
        info=path.lstat();return info.st_uid,info.st_gid,stat.S_IMODE(info.st_mode)

    def service_reads(self,names):
        # fchdir enters ONLY this fixture before dropping IDs, avoiding any need
        # to grant UID999 traverse rights to Owner workspace ancestors.
        directory=os.open(self.target,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        readfd,writefd=os.pipe();pid=os.fork()
        if pid==0:
            os.close(readfd)
            try:
                os.fchdir(directory);os.close(directory)
                os.setgroups([]);os.setresgid(987,987,987);os.setresuid(999,999,999)
                values={name:json.loads(Path(name).read_text()) for name in names}
                answer={"uid":os.getuid(),"euid":os.geteuid(),"gid":os.getgid(),"groups":os.getgroups(),"read_count":len(values)}
                os.write(writefd,json.dumps(answer).encode())
            except BaseException:
                os._exit(1)
            finally:
                os.close(writefd)
            os._exit(0)
        os.close(writefd);os.close(directory);raw=os.read(readfd,4096);os.close(readfd)
        _,code=os.waitpid(pid,0);self.assertEqual(code,0)
        value=json.loads(raw);self.assertEqual(value,{"uid":999,"euid":999,"gid":987,"groups":[],"read_count":len(names)})

    def verifier(self,*args,**kwargs):
        value={**self.proof,"confirmed":True,"nonce":kwargs["env"]["ADMIN_CLUSTER_FENCE_NONCE"],
               "verified_at":datetime.datetime.now(datetime.timezone.utc).isoformat()}
        return types.SimpleNamespace(stdout=json.dumps(value))

    def promote(self):
        with mock.patch.object(recovery.subprocess,"run",side_effect=self.verifier):
            return recovery.promote(self.target,self.proof_path,["/usr/bin/true"])

    def test_existing_and_new_files_readable_by_actual_service(self):
        for name in atomic.SERVICE_FILES:
            atomic.atomic_json(self.target/name,{"synthetic":True})
            self.assertEqual(self.meta(self.target/name),(999,987,0o600))
        self.service_reads(sorted(atomic.SERVICE_FILES))

    def test_promotion_fixture_all_three_files_preserve_owner(self):
        self.assertTrue(self.promote()["promoted"])
        for name in atomic.SERVICE_FILES:self.assertEqual(self.meta(self.target/name),(999,987,0o600))
        self.service_reads(sorted(atomic.SERVICE_FILES))
        self.assertEqual(json.loads((self.target/"authority.json").read_text())["generation"],2)
        self.assertEqual(self.guard.read_bytes(),self.guard_before)
        self.assertEqual(self.meta(self.guard),(0,0,0o600))

    def test_symlink_hardlink_and_fifo_refused_before_publication(self):
        path=self.target/"promotion.json"
        path.symlink_to(self.guard)
        with self.assertRaises(PermissionError):atomic.atomic_json(path,{})
        path.unlink();os.link(self.target/"authority.json",path)
        with self.assertRaises(PermissionError):atomic.atomic_json(path,{})
        path.unlink();os.mkfifo(path,0o600);os.chown(path,999,987)
        with self.assertRaises(PermissionError):atomic.atomic_json(path,{})
        self.assertEqual(self.guard.read_bytes(),self.guard_before)

    def test_foreign_owner_or_mode_refused_not_repaired(self):
        path=self.target/"authority.json";before=path.read_bytes();os.chown(path,0,0)
        with self.assertRaises(PermissionError):atomic.atomic_json(path,{})
        self.assertEqual(self.meta(path),(0,0,0o600));self.assertEqual(path.read_bytes(),before)
        os.chown(path,999,987);path.chmod(0o640)
        with self.assertRaises(PermissionError):atomic.atomic_json(path,{})
        self.assertEqual(self.meta(path),(999,987,0o640))

    def test_foreign_parent_and_nonallowlisted_service_name_refused(self):
        with self.assertRaises(PermissionError):atomic.atomic_json(self.target/"arbitrary.json",{})
        os.chown(self.target,888,987)
        with self.assertRaises(PermissionError):atomic.atomic_json(self.target/"authority.json",{})

    def test_directory_symlink_refused(self):
        link=self.root/"linked-target";link.symlink_to(self.target)
        with self.assertRaises(OSError):atomic.atomic_json(link/"authority.json",{})

    def test_preimage_change_refused_before_temp_creation(self):
        fd,owner=atomic.directory(self.target,True)
        try:before=atomic.snapshot(fd,"authority.json",owner)
        finally:os.close(fd)
        self.write(self.target/"authority.json",{"changed":True})
        with self.assertRaises(RuntimeError):atomic.atomic_json(self.target/"authority.json",{},before)
        self.assertFalse(list(self.target.glob(".metadata-*")))

    def test_chown_write_or_file_fsync_failure_rolls_back_only_own_temp(self):
        path=self.target/"authority.json";before=path.read_bytes()
        for name in ("fchown","write","fsync"):
            with mock.patch.object(atomic.os,name,side_effect=OSError("synthetic prepublication failure")):
                with self.assertRaises(OSError):atomic.atomic_json(path,{"changed":True})
            self.assertEqual(path.read_bytes(),before);self.assertEqual(self.meta(path),(999,987,0o600))
            self.assertFalse(list(self.target.glob(".metadata-*")))
        self.service_reads(["authority.json"])

    def test_parent_fsync_failure_is_visible_uncertain_never_rolled_back(self):
        original=atomic.os.fsync
        def sync(fd):
            if stat.S_ISDIR(os.fstat(fd).st_mode):raise OSError("synthetic dirsync failure")
            return original(fd)
        with mock.patch.object(atomic.os,"fsync",side_effect=sync):
            with self.assertRaises(atomic.PublicationUncertain):atomic.atomic_json(self.target/"generation-floor.json",{"generation":2})
        self.assertEqual(json.loads((self.target/"generation-floor.json").read_text()),{"generation":2})
        self.service_reads(["generation-floor.json"])

    def test_fsync_after_chown_and_after_replace(self):
        actions=[];chown=atomic.os.fchown;sync=atomic.os.fsync;replace=atomic.os.replace
        def own(fd,*args):actions.append("owner");return chown(fd,*args)
        def fs(fd):actions.append("dirsync" if stat.S_ISDIR(os.fstat(fd).st_mode) else "filesync");return sync(fd)
        def rename(*args,**kwargs):actions.append("replace");return replace(*args,**kwargs)
        with mock.patch.object(atomic.os,"fchown",side_effect=own),mock.patch.object(atomic.os,"fsync",side_effect=fs),mock.patch.object(atomic.os,"replace",side_effect=rename):atomic.atomic_json(self.target/"promotion.json",{})
        self.assertEqual(actions,["owner","filesync","replace","dirsync"])

    def test_rename_applied_but_reply_lost_is_uncertain_not_rolled_back(self):
        original=atomic.os.replace
        def lost(*args,**kwargs):
            original(*args,**kwargs)
            raise OSError("synthetic lost rename reply")
        with mock.patch.object(atomic.os,"replace",side_effect=lost):
            with self.assertRaises(atomic.PublicationUncertain):atomic.atomic_json(self.target/"generation-floor.json",{"generation":2})
        self.assertEqual(json.loads((self.target/"generation-floor.json").read_text())["generation"],2)
        self.service_reads(["generation-floor.json"])

    def test_floor_changed_during_verifier_is_not_decreased(self):
        def changed(*args,**kwargs):
            atomic.atomic_json(self.target/"generation-floor.json",{"generation":3})
            return self.verifier(*args,**kwargs)
        with mock.patch.object(recovery.subprocess,"run",side_effect=changed):
            with self.assertRaises(RuntimeError):recovery.promote(self.target,self.proof_path,["/usr/bin/true"])
        self.assertEqual(json.loads((self.target/"generation-floor.json").read_text())["generation"],3)
        self.assertEqual(json.loads((self.target/"authority.json").read_text())["generation"],1)

    def test_partial_after_floor_never_decreases_floor_or_retries_promotion(self):
        writer=recovery.atomic_json
        def fail_authority(path,*args):
            if Path(path).name=="authority.json":raise OSError("synthetic authority publication failure")
            return writer(path,*args)
        with mock.patch.object(recovery,"atomic_json",side_effect=fail_authority):
            with self.assertRaises(OSError):self.promote()
        self.assertEqual(json.loads((self.target/"generation-floor.json").read_text())["generation"],2)
        self.assertEqual(json.loads((self.target/"authority.json").read_text())["generation"],1)
        with self.assertRaises(ValueError):self.promote()
        self.service_reads(["authority.json","generation-floor.json"])

    def test_partial_after_authority_has_no_replayed_promotion(self):
        writer=recovery.atomic_json
        def fail_receipt(path,*args):
            if Path(path).name=="promotion.json":raise OSError("synthetic receipt failure")
            return writer(path,*args)
        with mock.patch.object(recovery,"atomic_json",side_effect=fail_receipt):
            with self.assertRaises(OSError):self.promote()
        self.assertEqual(json.loads((self.target/"authority.json").read_text())["role"],"primary")
        self.assertFalse((self.target/"promotion.json").exists())
        with self.assertRaises(ValueError):self.promote()
        self.service_reads(["authority.json","generation-floor.json"])

    def test_guard_unchanged_on_success_and_partial_failure(self):
        self.promote();self.assertEqual(self.guard.read_bytes(),self.guard_before)
        self.assertEqual(self.meta(self.guard),(0,0,0o600))

    def test_bad_service_metadata_blocks_before_verifier(self):
        (self.target/"authority.json").chmod(0o644)
        with mock.patch.object(recovery.subprocess,"run") as call:
            with self.assertRaises(PermissionError):recovery.promote(self.target,self.proof_path,["/usr/bin/true"])
        call.assert_not_called()

    def test_existing_lock_wrong_owner_refused(self):
        self.write(self.target/".recovery.lock",{},(0,0))
        with self.assertRaises(PermissionError):self.promote()

    def test_two_operators_not_serialized_by_wildcard_or_indefinite_wait(self):
        with atomic.service_lock(self.target):
            with self.assertRaises(RuntimeError):
                with atomic.service_lock(self.target):pass

    def test_root_private_snapshot_verify_restore_compatibility(self):
        source=self.root/"synthetic-root-source";source.mkdir(mode=0o700)
        self.write(source/"authority.json",{"role":"primary","generation":1,"armed_boot_id":self.boot},(0,0))
        with sqlite3.connect(source/"queue.sqlite") as db:
            db.executescript("CREATE TABLE jobs(id TEXT PRIMARY KEY,state TEXT);CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT,job_id TEXT,kind TEXT,data TEXT);INSERT INTO jobs VALUES('synthetic','completed');")
        (source/"queue.sqlite").chmod(0o600)
        capture=recovery.snapshot(source,self.root/"synthetic-output")
        self.assertTrue(recovery.verify(capture["snapshot"])["verified"])
        target=self.root/"synthetic-restore"
        self.assertEqual(recovery.restore(capture["snapshot"],target)["role"],"standby")
        for name in ("authority.json","generation-floor.json","recovery-origin.json"):
            self.assertEqual(self.meta(target/name),(0,0,0o600))
        with sqlite3.connect(target/"queue.sqlite") as db:
            self.assertEqual(db.execute("SELECT * FROM jobs").fetchall(),[("synthetic","completed")])


if __name__=="__main__":unittest.main()
