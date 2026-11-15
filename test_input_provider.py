"""Fictitious archives only. No app, PG, browser, download or host execution.

The workspace's ancestors include group-writable directories. Tests replace
ONLY the external ancestor TCB with an explicit private fixture anchor; file fd,
owner/mode/hash/stat checks and all archive/extraction guards remain real.
Production defaults retain full root-controlled ancestor traversal.
"""
import hashlib
import io
import os
from pathlib import Path
import stat
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

import input_provider as provider

TMP = Path("/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-20261115/test-state/tmp")


def archive_bytes(rows):
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w:gz") as archive:
        for name, value, category in rows:
            member = tarfile.TarInfo(name); member.mode = 0o755 if name == "node" else 0o644
            if category == "file":
                member.size = len(value)
                archive.addfile(member, io.BytesIO(value))
            else:
                member.type = {"directory": tarfile.DIRTYPE, "symlink": tarfile.SYMTYPE, "hardlink": tarfile.LNKTYPE, "fifo": tarfile.FIFOTYPE}[category]
                if category in {"symlink", "hardlink"}: member.linkname = value
                archive.addfile(member)
    return out.getvalue()


SOURCE = [("AGENTS.md", b"fixture", "file"), ("site/src/app.ts", b"source", "file"),
          ("tools/preview/check.mjs", b"preview", "file"), ("tools/admin-qa/check.py", b"qa", "file")]
DEPS = [("node", b"fake-executable-never-run", "file"), ("package-lock.json", b"{}", "file"),
        ("package.tgz", b"fake-pdfjs", "file"), ("node_modules/pkg/bin.js", b"fixture", "file")]


class InputProviderTests(unittest.TestCase):
    def setUp(self):
        TMP.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="input-provider-", dir=TMP)
        self.root = Path(self.temp.name)
        self.cwd = Path.cwd(); os.chdir(self.root)
        self.owner = os.geteuid()
        def anchor(path, expected_uid):
            if Path(path).parent != self.root:
                raise AssertionError("fixture_input_parent_must_be_private_anchor")
            info = self.root.lstat()
            if not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700:
                raise AssertionError("fixture_anchor_must_be_private")
            return os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        self.anchor = mock.patch.object(provider, "_trusted_input_parent", side_effect=anchor)
        self.anchor.start()

    def tearDown(self):
        self.anchor.stop(); os.chdir(self.cwd); self.temp.cleanup()

    def input(self, rows=SOURCE, name="input.tar.gz"):
        data = archive_bytes(rows)
        path = self.root / name; path.write_bytes(data); path.chmod(0o600)
        return path, hashlib.sha256(data).hexdigest(), len(data)

    def extract(self, rows=SOURCE, dest="output", kind="source"):
        path, sha, size = self.input(rows)
        return provider.extract_input(path, sha, size, dest, kind, self.owner)

    def manifest(self, rows, kind="source"):
        return provider.archive_manifest(io.BytesIO(archive_bytes(rows)), kind)

    def test_same_verified_fd_and_default_root_owner_enforcement(self):
        path, sha, size = self.input()
        with provider.verified_input(path, sha, size, self.owner) as fp:
            original = fp.fileno(); self.assertEqual(fp.read(2), b"\x1f\x8b")
            self.assertEqual(fp.fileno(), original)
            self.assertEqual(os.fstat(original).st_ino, path.stat().st_ino)
        if self.owner != 0:
            with self.assertRaises(PermissionError):
                with provider.verified_input(path, sha, size): pass

    def test_reject_bad_digest_size_owner_and_noncanonical_path(self):
        path, sha, size = self.input()
        for digest, count in (("0" * 64, size), (sha, size + 1), ("A" * 64, size), (sha, True), (sha, 0)):
            with self.subTest(digest=digest, count=count), self.assertRaises(provider.InputRejected):
                with provider.verified_input(path, digest, count, self.owner): pass
        with self.assertRaises(provider.InputRejected):
            with provider.verified_input("input.tar.gz", sha, size, self.owner): pass
        with self.assertRaises(provider.InputRejected):
            with provider.verified_input(path, sha, size, True): pass

    def test_root_ancestor_guard_remains_strict(self):
        self.anchor.stop()
        try:
            insecure = SimpleNamespace(st_uid=0, st_mode=stat.S_IFDIR | 0o777)
            with mock.patch.object(provider.os, "fstat", return_value=insecure):
                with self.assertRaises(PermissionError): provider._trusted_input_parent(self.root / "file", self.owner)
        finally:
            self.anchor.start()

    def test_reject_symlink_hardlink_group_writable_and_nonregular_input(self):
        path, sha, size = self.input()
        link = self.root / "link"; link.symlink_to(path)
        with self.assertRaises(OSError):
            with provider.verified_input(link, sha, size, self.owner): pass
        hard = self.root / "hard"; os.link(path, hard)
        with self.assertRaises(PermissionError):
            with provider.verified_input(path, sha, size, self.owner): pass
        hard.unlink(); path.chmod(0o620)
        with self.assertRaises(PermissionError):
            with provider.verified_input(path, sha, size, self.owner): pass
        fifo = self.root / "fifo"; os.mkfifo(fifo, 0o600)
        with self.assertRaises(PermissionError):
            with provider.verified_input(fifo, sha, size, self.owner): pass

    def test_stat_changes_and_replaced_path_detected_on_exit(self):
        path, sha, size = self.input()
        with self.assertRaises(provider.InputRejected):
            with provider.verified_input(path, sha, size, self.owner) as fp:
                replacement = self.root / "replacement"; replacement.write_bytes(path.read_bytes()); replacement.chmod(0o600)
                os.replace(replacement, path)
                self.assertEqual(fp.read(2), b"\x1f\x8b")
        with self.assertRaises(provider.InputRejected):
            with provider.verified_input(path, sha, size, self.owner): path.chmod(0o640)

    def test_in_place_same_size_mutation_detected(self):
        path, sha, size = self.input()
        with self.assertRaises(provider.InputRejected):
            with provider.verified_input(path, sha, size, self.owner):
                data = bytearray(path.read_bytes()); data[-1] ^= 1; path.write_bytes(data)

    def test_source_inventory_and_manual_extraction(self):
        result = self.extract()
        self.assertEqual(result["members"], 4)
        self.assertIs(result["qualified"], False)
        self.assertIs(result["cache_integrity_verified"], False)
        self.assertEqual((self.root / "output/site/src/app.ts").read_bytes(), b"source")
        self.assertEqual((self.root / "output/tools/preview/check.mjs").read_bytes(), b"preview")
        self.assertEqual((self.root / "output/tools/admin-qa/check.py").read_bytes(), b"qa")
        self.assertEqual(stat.S_IMODE((self.root / "output").stat().st_mode), 0o700)

    def test_deps_actual_roots_and_safe_internal_symlinks(self):
        rows = DEPS + [("node_modules/.bin/pkg", "../pkg/bin.js", "symlink"),
                       ("node_modules/.bin/pkg2", "pkg", "symlink")]
        result = self.extract(rows, kind="deps")
        self.assertEqual((self.root / "output/node_modules/.bin/pkg2").read_bytes(), b"fixture")
        self.assertEqual(os.readlink(self.root / "output/node_modules/.bin/pkg"), "../pkg/bin.js")
        self.assertEqual([entry["final_target"] for entry in result["entries"] if entry["type"] == "symlink"], ["node_modules/pkg/bin.js"] * 2)
        self.assertTrue((self.root / "output/node").stat().st_mode & stat.S_IXUSR)

    def test_hardlink_rejected_before_destination_exists(self):
        rows = DEPS + [("node_modules/esbuild/bin/esbuild", "node_modules/pkg/bin.js", "hardlink")]
        with self.assertRaisesRegex(provider.InputRejected, "hardlinks_forbidden_pending_reviewed_repack"):
            self.extract(rows, kind="deps")
        self.assertFalse((self.root / "output").exists())

    def test_source_forbids_symlinks_and_special_files(self):
        for category, value in (("symlink", "src/app.ts"), ("fifo", "")):
            with self.subTest(category=category), self.assertRaises(provider.InputRejected):
                self.manifest(SOURCE + [("site/extra", value, category)])

    def test_forbidden_paths_and_approved_example(self):
        for name in ("site/.env", "site/.env.local", "site/.env.production", "site/.env.example.extra", "site/.ssh/config", "site/secrets/value", "tools/preview/credentials/value", "site/.git/config", "site/id_ed25519", "other/file", "tools/infra/script", "site/node_modules/pkg/file"):
            with self.subTest(name=name), self.assertRaises(provider.InputRejected):
                self.manifest(SOURCE + [(name, b"fixture", "file")])
        accepted = self.manifest(SOURCE + [("site/.env.example", b"EXAMPLE=fixture", "file")])
        self.assertEqual(accepted["members"], 5)

    def test_duplicates_traversal_aliases_and_parent_collisions(self):
        for name in ("/site/out", "site/../out", "site//out", "site/./out", "site\\out", "site/\nfile", "./site/out"):
            with self.subTest(name=name), self.assertRaises(provider.InputRejected):
                self.manifest(SOURCE + [(name, b"fixture", "file")])
        with self.assertRaisesRegex(provider.InputRejected, "duplicate"):
            self.manifest(SOURCE + [SOURCE[1]])
        with self.assertRaisesRegex(provider.InputRejected, "beneath_file"):
            self.manifest(SOURCE + [("site/file", b"fixture", "file"), ("site/file/child", b"fixture", "file")])

    def test_link_escape_loop_dangling_and_link_parent_rejected(self):
        cases = [
            [("node_modules/.bin/x", "../../../outside", "symlink")],
            [("node_modules/.bin/x", "../../node", "symlink")],
            [("node_modules/a", "b", "symlink"), ("node_modules/b", "a", "symlink")],
            [("node_modules/.bin/x", "../missing", "symlink")],
            [("node_modules/link", "pkg", "symlink"), ("node_modules/link/child", b"fixture", "file")],
        ]
        for extra in cases:
            with self.subTest(extra=extra), self.assertRaises(provider.InputRejected): self.manifest(DEPS + extra, "deps")

    def test_missing_required_roots_and_unknown_kind_rejected(self):
        with self.assertRaises(provider.InputRejected): self.manifest([SOURCE[1]])
        with self.assertRaises(provider.InputRejected): self.manifest(DEPS[1:], "deps")
        with self.assertRaises(provider.InputRejected): self.manifest(SOURCE, "arbitrary")

    def test_member_count_unpacked_bytes_and_single_file_bounds(self):
        with mock.patch.dict(provider.LIMITS, {"source": {"members": 3, "bytes": 1024}}):
            with self.assertRaisesRegex(provider.InputRejected, "count_exceeded"): self.manifest(SOURCE)
        with mock.patch.dict(provider.LIMITS, {"source": {"members": 10, "bytes": 4}}):
            with self.assertRaisesRegex(provider.InputRejected, "bytes_exceeded"): self.manifest(SOURCE)
        with mock.patch.object(provider, "MAX_FILE", 3):
            with self.assertRaises(provider.InputRejected): self.manifest(SOURCE)

    def test_truncated_archive_and_setuid_rejected(self):
        with self.assertRaises(provider.InputRejected): provider.archive_manifest(io.BytesIO(b"not a tar"), "source")
        raw = io.BytesIO()
        with tarfile.open(fileobj=raw, mode="w") as archive:
            member = tarfile.TarInfo("site/file"); member.mode = 0o4755; member.size = 0; archive.addfile(member, io.BytesIO())
        with self.assertRaises(provider.InputRejected): provider.archive_manifest(io.BytesIO(raw.getvalue()), "source")

    def test_oversized_hidden_pax_header_refused_before_payload_allocation(self):
        member = tarfile.TarInfo("header"); member.type = tarfile.XHDTYPE; member.size = 65537
        raw = member.tobuf(format=tarfile.USTAR_FORMAT)
        with self.assertRaisesRegex(provider.InputRejected, "pax_header_too_large"):
            provider.archive_manifest(io.BytesIO(raw), "source")

    def test_sparse_pax_refused_before_sparse_decoder(self):
        raw = io.BytesIO()
        with tarfile.open(fileobj=raw, mode="w", format=tarfile.PAX_FORMAT) as archive:
            member = tarfile.TarInfo("site/sparse"); member.size = 0
            member.pax_headers = {"GNU.sparse.major": "1", "GNU.sparse.minor": "0", "GNU.sparse.realsize": "999999999999"}
            archive.addfile(member, io.BytesIO())
        with self.assertRaisesRegex(provider.InputRejected, "sparse_pax_extensions_forbidden"):
            provider.archive_manifest(io.BytesIO(raw.getvalue()), "source")

    def test_symlink_depth_is_bounded(self):
        rows = DEPS + [("node_modules/link" + str(index), "link" + str(index + 1), "symlink") for index in range(provider.MAX_LINK_DEPTH + 1)]
        rows += [("node_modules/link" + str(provider.MAX_LINK_DEPTH + 1), "pkg/bin.js", "symlink")]
        with self.assertRaisesRegex(provider.InputRejected, "symlink_depth_exceeded"):
            self.manifest(rows, "deps")

    def test_destination_must_be_relative_absent_and_under_private_cwd(self):
        path, sha, size = self.input()
        for dest in (str(self.root / "outside"), "../outside", ".", "nested/../outside"):
            with self.subTest(dest=dest), self.assertRaises(provider.InputRejected):
                provider.extract_input(path, sha, size, dest, "source", self.owner)
        (self.root / "exists").mkdir(); marker = self.root / "exists/marker"; marker.write_text("preserved")
        with self.assertRaises(FileExistsError): provider.extract_input(path, sha, size, "exists", "source", self.owner)
        self.assertEqual(marker.read_text(), "preserved")
        (self.root / "alias").symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(OSError): provider.extract_input(path, sha, size, "alias/output", "source", self.owner)
        self.assertFalse((self.root / "output").exists())

    def test_partial_extraction_preserved_and_never_reinitialized(self):
        path, sha, size = self.input()
        original = provider._member_parent
        calls = []
        def fail_after_one(root_fd, name):
            calls.append(name)
            if len(calls) == 2: raise OSError("fixture_io_failure")
            return original(root_fd, name)
        with mock.patch.object(provider, "_member_parent", side_effect=fail_after_one):
            with self.assertRaises(OSError): provider.extract_input(path, sha, size, "partial", "source", self.owner)
        self.assertEqual((self.root / "partial/AGENTS.md").read_bytes(), b"fixture")
        with self.assertRaises(FileExistsError): provider.extract_input(path, sha, size, "partial", "source", self.owner)
        self.assertEqual((self.root / "partial/AGENTS.md").read_bytes(), b"fixture")


if __name__ == "__main__":
    unittest.main()
