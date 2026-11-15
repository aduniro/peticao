"""Actual inotify on LOCAL project fixtures only; no host tmp, mounts or SSH."""
import fcntl
import hashlib
import os
from pathlib import Path
import stat
import tempfile
import types
import unittest
from unittest import mock

import storage_probe as probe

HERE = Path(__file__).resolve().parent
BOOT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
UNITS = ["admin-dev-" + str(i)*32 + "-g1.service" for i in (1,2,3)]
VERSION = b"systemd 255 (255.4-1ubuntu8.18)\n+SYNTHETIC_LOCAL_TEST\n"


def evidence():
    return probe.version_evidence(VERSION, hashlib.sha256(VERSION).hexdigest(), 255)


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=HERE, prefix="fixture-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.roots = (self.root / "tmp", self.root / "var-tmp")
        for root in self.roots:
            root.mkdir(mode=0o700)

    def audit(self):
        return probe.TmpAudit(BOOT, UNITS, evidence(), roots=self.roots)

    def test_only_reviewed_exact_version_and_format(self):
        self.assertEqual(evidence()["major"],255)
        for raw, sha, major in ((VERSION,"0"*64,255),(VERSION,hashlib.sha256(VERSION).hexdigest(),256),(b"invalid", "0"*64,255)):
            with self.assertRaises(PermissionError):probe.version_evidence(raw,sha,major)
        with self.assertRaises(PermissionError):probe.prefixes(BOOT,UNITS,{"verified":False})

    def test_boot_and_exact_three_units_no_truncation_or_wildcards(self):
        values=probe.prefixes(BOOT,UNITS,evidence())
        self.assertEqual(values[0],("systemd-private-"+BOOT.replace("-","")+"-"+UNITS[0]+"-").encode())
        for units in ([UNITS[0]]*3,["*",UNITS[1],UNITS[2]],UNITS[:2]):
            with self.assertRaises(ValueError):probe.prefixes(BOOT,units,evidence())
        with self.assertRaises(ValueError):probe.prefixes("not-real-boot",UNITS,evidence())

    def test_empty_window_has_only_own_unit_absence_evidence(self):
        with self.audit() as audit:
            self.assertEqual(audit.proof(),{"roots":2,"matching_events":0,"matching_existing":0,"overflow":False,"watch_lost":False,"parents_unchanged":True,"scope":"local_test_roots","manager_namespace_verified":False})
            self.assertTrue(fcntl.fcntl(audit.fd,fcntl.F_GETFD)&fcntl.FD_CLOEXEC)
            self.assertTrue(fcntl.fcntl(audit.fd,fcntl.F_GETFL)&os.O_NONBLOCK)

    def test_create_then_delete_before_sampling_is_still_detected(self):
        with self.audit() as audit:
            path=self.roots[0]/(audit.prefixes[0].decode()+"ABC123")
            path.mkdir();path.rmdir()
            with self.assertRaises(RuntimeError):audit.proof()
            self.assertGreaterEqual(audit.matching_events,2)
        # Everything created in this test is under the project's fixture root.

    def test_create_delete_during_final_scan_is_drained_before_success(self):
        with self.audit() as audit:
            scan=audit._existing;created=False
            def racing(root):
                nonlocal created
                value=scan(root)
                if not created:
                    created=True
                    path=root/(audit.prefixes[0].decode()+"RACE12")
                    path.mkdir();path.rmdir()
                return value
            with mock.patch.object(audit,"_existing",side_effect=racing):
                with self.assertRaises(RuntimeError):audit.proof()
            self.assertGreaterEqual(audit.matching_events,2)

    def test_host_audit_refuses_different_manager_namespace_before_watch(self):
        one=types.SimpleNamespace(st_dev=1,st_ino=100)
        other=types.SimpleNamespace(st_dev=1,st_ino=101)
        with mock.patch.object(probe.os,"geteuid",return_value=0),mock.patch.object(probe.os,"stat",side_effect=[one,other]),mock.patch.object(probe.ctypes,"CDLL") as library:
            with self.assertRaises(PermissionError):probe.TmpAudit(BOOT,UNITS,evidence())
        library.assert_not_called()

    def test_same_mount_namespace_with_different_chroot_is_not_host_evidence(self):
        ns=types.SimpleNamespace(st_dev=1,st_ino=100)
        root=types.SimpleNamespace(st_dev=7,st_ino=10)
        manager_root=types.SimpleNamespace(st_dev=7,st_ino=11)
        def stats(path):
            if path in {"/proc/self/ns/mnt","/proc/1/ns/mnt"}:return ns
            return root if path=="/" else manager_root
        with mock.patch.object(probe.os,"geteuid",return_value=0),mock.patch.object(probe.os,"stat",side_effect=stats),mock.patch.object(probe.ctypes,"CDLL") as library:
            with self.assertRaises(PermissionError):probe.TmpAudit(BOOT,UNITS,evidence())
        library.assert_not_called()

    def test_existing_own_prefix_cannot_be_adopted_as_clean_window(self):
        name=probe.prefixes(BOOT,UNITS,evidence())[1].decode()+"DEF456"
        (self.roots[1]/name).mkdir()
        with self.audit() as audit:
            with self.assertRaises(RuntimeError):audit.proof()

    def test_unrelated_names_never_open_or_export_file_contents(self):
        with self.audit() as audit:
            (self.roots[0]/"unrelated-file").write_text("synthetic private marker never read")
            with mock.patch.object(Path,"read_text",side_effect=AssertionError("no file contents")),mock.patch.object(Path,"read_bytes",side_effect=AssertionError("no file contents")):
                self.assertEqual(audit.proof()["matching_events"],0)

    def test_unexpected_naming_with_own_unit_also_fails(self):
        with self.audit() as audit:
            (self.roots[0]/("changed-format-"+UNITS[2])).mkdir()
            with self.assertRaises(RuntimeError):audit.proof()

    def test_overflow_does_not_become_absence(self):
        with self.audit() as audit:
            audit.consume(probe.EVENT.pack(-1,probe.OVERFLOW,0,0))
            with self.assertRaises(RuntimeError):audit.proof()
            self.assertTrue(audit.overflow)

    def test_watch_loss_or_unknown_descriptor_fails_closed(self):
        for mask,wd in ((probe.IGNORED,1),(probe.UNMOUNT,1),(probe.CREATE,987654)):
            with self.audit() as audit:
                audit.consume(probe.EVENT.pack(wd,mask,0,0))
                with self.assertRaises(RuntimeError):audit.proof()

    def test_truncated_event_or_name_is_not_ignored(self):
        for raw in (b"x",probe.EVENT.pack(1,probe.CREATE,0,100)+b"short"):
            with self.audit() as audit:
                with self.assertRaises(RuntimeError):audit.consume(raw)
                self.assertTrue(audit.watch_lost)

    def test_parent_replacement_invalidates_negative_evidence(self):
        with self.audit() as audit:
            self.roots[0].rename(self.root/"old-tmp")
            self.roots[0].mkdir()
            with self.assertRaises(RuntimeError):audit.proof()

    def test_link_roots_refused(self):
        link=self.root/"linked";link.symlink_to(self.roots[0])
        with self.assertRaises(PermissionError):probe.TmpAudit(BOOT,UNITS,evidence(),roots=(link,self.roots[1]))

    def test_cannot_report_after_monitor_closed(self):
        audit=self.audit();audit.close()
        with self.assertRaises(RuntimeError):audit.proof()


class BackingTests(unittest.TestCase):
    def setUp(self):
        self.name="peticao-dev-job-"+"1"*32+"-g1"
        self.parent=probe.PROJECT/"qualification-attempt3/jobs"/self.name
        self.proof={"source":str(self.parent/"work"),"target":"/var/lib/private/"+self.name,"mount_id":77,"device":7,"inode":19,
                    "manifest_sha256":"a"*64,"receipt_sha256":"b"*64,"worker_boot_id":BOOT}
        self.child={"cwd_device":7,"cwd_inode":19,"direct_runtime_access_denied":True}

    def validate(self,proof=None,child=None):
        return probe.backing_evidence(self.proof if proof is None else proof,"a"*64,"b"*64,BOOT,self.child if child is None else child,self.parent)

    def stats(self,path,*args,**kwargs):
        if path==self.parent:return types.SimpleNamespace(st_mode=stat.S_IFDIR|0o700,st_uid=0,st_gid=0,st_dev=7,st_ino=20)
        # Leaf may legitimately show dynamic UID or an idmapped UID. Identity
        # proof uses dev/inode, not equality of dynamic IDs across mount views.
        return types.SimpleNamespace(st_mode=stat.S_IFDIR|0o700,st_uid=65534,st_gid=65534,st_dev=7,st_ino=19)

    def test_exact_binding_and_child_cwd_match_without_uid_assumption(self):
        with mock.patch.object(Path,"lstat",autospec=True,side_effect=self.stats),mock.patch.object(Path,"stat",autospec=True,side_effect=self.stats):
            self.assertTrue(self.validate()["project_backing"])

    def test_foreign_manifest_or_receipt_fails_before_fs_access(self):
        for key in ("manifest_sha256","receipt_sha256","worker_boot_id"):
            value=dict(self.proof);value[key]="foreign"
            with self.assertRaises(PermissionError):self.validate(value)

    def test_paths_outside_project_or_wrong_target_refused(self):
        for change in ({"source":"/var/lib/private/not-project"},{"target":"/var/lib/private/foreign"},{"mount_id":0},{"device":True}):
            value={**self.proof,**change}
            with self.assertRaises((ValueError,PermissionError)):self.validate(value)

    def test_child_cwd_or_direct_access_mismatch_refused(self):
        with mock.patch.object(Path,"lstat",autospec=True,side_effect=self.stats),mock.patch.object(Path,"stat",autospec=True,side_effect=self.stats):
            for value in ({**self.child,"cwd_inode":20},{**self.child,"direct_runtime_access_denied":False}):
                with self.assertRaises(PermissionError):self.validate(child=value)


if __name__=="__main__":unittest.main()
