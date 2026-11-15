"""Fictitious producer fixtures only; NEVER normalize the real pinned archive.

Only public pin constants/owner seams are changed locally in these tests. The
external ancestor TCB is replaced with a private 0700 fixture anchor because
this source workspace intentionally has group-writable ancestors.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import sys
import tarfile
import tempfile
from unittest import mock
import unittest

import input_provider as provider
import normalize_dependencies as producer

TMP = Path("/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-20261115/test-state/tmp")
TARGET = producer.HARDLINK_TARGET
LINK = producer.HARDLINK_PATH
ROWS = [("node", b"fake-node-never-executed", "file"), ("package-lock.json", b"{}", "file"),
        ("package.tgz", b"fake-pdfjs", "file"), (TARGET, b"fake-esbuild-never-executed", "file"),
        (LINK, TARGET, "hardlink"), ("node_modules/.bin/esbuild", "../esbuild/bin/esbuild", "symlink"),
        ("node_modules/pkg/lib/actual.so", b"fake-so", "file"),
        ("node_modules/pkg/lib/alias.so", "actual.so", "symlink")]


def tar_bytes(rows):
    value = io.BytesIO()
    with tarfile.open(fileobj=value, mode="w:gz", format=tarfile.PAX_FORMAT) as archive:
        for name, content, kind in rows:
            member = tarfile.TarInfo(name)
            member.mode = 0o755 if name in {TARGET, "node"} else 0o644
            member.uid = 123; member.gid = 456; member.uname = "fixture-owner"; member.gname = "fixture-group"; member.mtime = 123456
            if kind == "file":
                member.size = len(content); archive.addfile(member, io.BytesIO(content))
            else:
                member.type = {"hardlink": tarfile.LNKTYPE, "symlink": tarfile.SYMTYPE, "directory": tarfile.DIRTYPE, "fifo": tarfile.FIFOTYPE}[kind]
                if kind in {"hardlink", "symlink"}: member.linkname = content
                archive.addfile(member)
    return value.getvalue()


class NormalizerTests(unittest.TestCase):
    def setUp(self):
        TMP.mkdir(parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(prefix="normalize-fixture-", dir=TMP)
        self.root = Path(self.tmp.name)
        self.input = self.root / "parent.tar.gz"
        self.output = self.root / "normalized.tar.gz"
        self.receipt = self.root / "receipt.json"
        self.owner = os.geteuid()
        def ancestor(path, expected_uid):
            if Path(path).parent != self.root or stat.S_IMODE(self.root.stat().st_mode) != 0o700:
                raise AssertionError("only_private_fixture_anchor_allowed")
            return os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        self.ancestor = mock.patch.object(provider, "_trusted_input_parent", side_effect=ancestor)
        self.ancestor.start()

    def tearDown(self):
        self.ancestor.stop(); self.tmp.cleanup()

    def prepare(self, rows=ROWS):
        raw = tar_bytes(rows); self.input.write_bytes(raw); self.input.chmod(0o600)
        return mock.patch.multiple(producer, PARENT_SHA256=hashlib.sha256(raw).hexdigest(), PARENT_BYTES=len(raw), EXPECTED_SYMLINKS=2)

    def run_producer(self):
        return producer.normalize_dependencies(self.input, self.output, self.receipt, _expected_uid=self.owner)

    def test_real_pins_and_closed_cli_have_no_override(self):
        self.assertEqual(producer.PARENT_SHA256, "3009712141b019777b6395e36a628f4e1c0b8720fb617e4ffe5c814d91670698")
        self.assertEqual(producer.PARENT_BYTES, 207013889)
        self.assertEqual(producer.EXPECTED_SYMLINKS, 22)
        base = ["normalizer", "--input", "/input", "--output", "/output.tar.gz", "--receipt", "/receipt.json"]
        cases = [base + ["--sha256", "a" * 64], base + ["--expected-uid", str(self.owner)],
                 ["normalizer", "--in", "/input", "--output", "/output.tar.gz", "--receipt", "/receipt.json"]]
        for argv in cases:
            with mock.patch.object(sys, "argv", argv), mock.patch("sys.stderr", new=io.StringIO()), mock.patch.object(producer, "normalize_dependencies") as normalize:
                with self.assertRaises(SystemExit): producer.main()
                normalize.assert_not_called()

    def test_materializes_only_allowlisted_member_and_preserves_original(self):
        with self.prepare(), mock.patch.object(os, "link", side_effect=AssertionError("filesystem_hardlink_forbidden")), mock.patch.object(tarfile.TarFile, "extractall", side_effect=AssertionError("extractall_forbidden")), mock.patch.object(tarfile.TarFile, "extract", side_effect=AssertionError("extract_forbidden")):
            original = self.input.read_bytes(); before = provider._signature(self.input.stat())
            record = self.run_producer()
            self.assertEqual(self.input.read_bytes(), original)
            self.assertEqual(provider._signature(self.input.stat()), before)
        with tarfile.open(self.output, "r:gz") as archive:
            members = archive.getmembers()
            self.assertFalse(any(item.islnk() for item in members))
            self.assertEqual(len([item for item in members if item.issym()]), 2)
            materialized = archive.getmember(LINK); target = archive.getmember(TARGET)
            self.assertTrue(materialized.isfile()); self.assertEqual(materialized.size, target.size)
            self.assertEqual(materialized.mode, target.mode)
            self.assertEqual(archive.extractfile(materialized).read(), archive.extractfile(target).read())
        self.assertIs(record["parent_preserved"], True)
        self.assertIs(record["qualified"], False)
        self.assertIs(record["cache_integrity_verified"], False)
        self.assertEqual(json.loads(self.receipt.read_text()), record)
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.receipt.stat().st_mode), 0o600)
        self.assertEqual(record["output_sha256"], hashlib.sha256(self.output.read_bytes()).hexdigest())
        changed = [entry for entry in record["entrymap"] if entry["parent_type"] != entry["output_type"]]
        self.assertEqual([entry["name"] for entry in changed], [LINK])
        self.assertEqual(changed[0]["parent_logical_content_sha256"], changed[0]["output_content_sha256"])

    def test_deterministic_gzip_and_headers_independent_of_output_filename(self):
        with self.prepare():
            first = self.run_producer()
            second_output = self.root / "other.tar.gz"; second_receipt = self.root / "other.json"
            second = producer.normalize_dependencies(self.input, second_output, second_receipt, _expected_uid=self.owner)
        self.assertEqual(first["output_sha256"], second["output_sha256"])
        self.assertEqual(self.output.read_bytes(), second_output.read_bytes())
        self.assertEqual(self.output.read_bytes()[4:8], b"\0" * 4)
        self.assertFalse(self.output.read_bytes()[3] & 8)  # no gzip filename
        with tarfile.open(self.output, "r:gz") as archive:
            for member in archive:
                self.assertEqual((member.uid, member.gid, member.uname, member.gname, member.mtime), (0, 0, "", "", 0))

    def test_output_passes_unmodified_strict_provider(self):
        with self.prepare(): record = self.run_producer()
        with self.output.open("rb") as stream:
            strict = provider.archive_manifest(stream, "deps")
        self.assertEqual(strict["members"], len(ROWS))
        self.assertEqual(strict["unpacked_bytes"], record["strict_manifest"]["unpacked_bytes"])

    def test_default_root_owner_is_not_relaxed_by_fixture_pin(self):
        if self.owner == 0: self.skipTest("fixture runs as root")
        with self.prepare(), self.assertRaises(PermissionError):
            producer.normalize_dependencies(self.input, self.output, self.receipt)
        self.assertFalse(self.output.exists())

    def test_wrong_pin_size_and_unsafe_parent_inode_reject_before_output(self):
        with self.prepare(), mock.patch.object(producer, "PARENT_SHA256", "0" * 64):
            with self.assertRaises(provider.InputRejected): self.run_producer()
        self.assertFalse(self.output.exists())
        with self.prepare(), mock.patch.object(producer, "PARENT_BYTES", self.input.stat().st_size + 1):
            with self.assertRaises(provider.InputRejected): self.run_producer()
        self.assertFalse(self.output.exists())
        with self.prepare():
            self.input.chmod(0o620)
            with self.assertRaises(PermissionError): self.run_producer()
        self.assertFalse(self.output.exists())

    def test_arbitrary_hardlink_or_missing_expected_hardlink_rejected(self):
        cases = [ROWS + [("node_modules/other", TARGET, "hardlink")],
                 [row for row in ROWS if row[0] != LINK],
                 [(name, "node_modules/pkg/lib/actual.so" if name == LINK else content, kind) for name, content, kind in ROWS]]
        for rows in cases:
            with self.subTest(rows=rows), self.prepare(rows), self.assertRaises(producer.NormalizationRejected): self.run_producer()
            self.assertFalse(self.output.exists()); self.assertFalse(self.receipt.exists())

    def test_regular_unique_target_required(self):
        cases = [ROWS + [(TARGET, b"duplicate", "file")],
                 [row for row in ROWS if row[0] != TARGET],
                 [(name, "../pkg/lib/actual.so" if name == TARGET else content, "symlink" if name == TARGET else kind) for name, content, kind in ROWS]]
        for rows in cases:
            with self.subTest(rows=rows), self.prepare(rows), self.assertRaises(producer.NormalizationRejected): self.run_producer()
            self.assertFalse(self.output.exists())

    def test_unsafe_symlink_graph_and_parent_paths_rejected(self):
        cases = [[(name, "../../outside" if name.endswith(".bin/esbuild") else content, kind) for name, content, kind in ROWS],
                 [(name, "alias.so" if name.endswith("alias.so") else content, kind) for name, content, kind in ROWS],
                 [(name, "missing.so" if name.endswith("alias.so") else content, kind) for name, content, kind in ROWS],
                 ROWS + [("node_modules/.bin/esbuild/child", b"bad-parent", "file")]]
        for rows in cases:
            with self.subTest(rows=rows), self.prepare(rows), self.assertRaises((producer.NormalizationRejected, provider.InputRejected)): self.run_producer()
            self.assertFalse(self.output.exists())

    def test_wrong_symlink_count_and_member_prefix_rejected(self):
        with self.prepare(ROWS[:-1]), self.assertRaises(producer.NormalizationRejected): self.run_producer()
        self.assertFalse(self.output.exists())
        for name in ("../outside", "outside/file", "node_modules/.env", "node_modules/.ssh/key"):
            with self.subTest(name=name), self.prepare(ROWS + [(name, b"fixture", "file")]), self.assertRaises(provider.InputRejected): self.run_producer()
            self.assertFalse(self.output.exists())

    def test_materialization_respects_output_budget(self):
        total = sum(len(content) for _, content, kind in ROWS if kind == "file")
        with self.prepare(), mock.patch.dict(provider.LIMITS, {"deps": {"members": 100, "bytes": total}}):
            with self.assertRaisesRegex(producer.NormalizationRejected, "materialized_output_budget_exceeded"): self.run_producer()
        self.assertFalse(self.output.exists())

    def test_existing_outputs_never_overwritten(self):
        self.output.write_bytes(b"preserved")
        with self.prepare(), self.assertRaises(FileExistsError): self.run_producer()
        self.assertEqual(self.output.read_bytes(), b"preserved"); self.assertFalse(self.receipt.exists())
        self.output.unlink(); self.receipt.write_bytes(b"preserved")
        with self.prepare(), self.assertRaises(FileExistsError): self.run_producer()
        self.assertEqual(self.receipt.read_bytes(), b"preserved")
        self.assertTrue(self.output.exists())  # preserved normalized output; no reinitialization

    def test_partial_output_preserved_after_io_failure(self):
        def fail(source, output, inventory):
            output.write(b"partial"); output.flush(); raise OSError("fixture_io_error")
        with self.prepare(), mock.patch.object(producer, "_produce", side_effect=fail), self.assertRaises(OSError): self.run_producer()
        self.assertEqual(self.output.read_bytes(), b"partial"); self.assertFalse(self.receipt.exists())
        with self.prepare(), self.assertRaises(FileExistsError): self.run_producer()
        self.assertEqual(self.output.read_bytes(), b"partial")

    def test_no_receipt_when_strict_provider_rejects_output(self):
        with self.prepare(), mock.patch.object(provider, "archive_manifest", side_effect=provider.InputRejected("fixture_rejection")), self.assertRaises(provider.InputRejected): self.run_producer()
        self.assertTrue(self.output.exists()); self.assertFalse(self.receipt.exists())

    def test_no_receipt_if_original_changes_after_output_is_produced(self):
        original_produce = producer._produce
        def mutate(source, output, inventory):
            original_produce(source, output, inventory)
            self.input.chmod(0o640)
        with self.prepare(), mock.patch.object(producer, "_produce", side_effect=mutate), self.assertRaises(provider.InputRejected): self.run_producer()
        self.assertTrue(self.output.exists()); self.assertFalse(self.receipt.exists())

    def test_output_path_replacement_detected_before_receipt(self):
        original_validate = producer._validate_output
        def replace(output, inventory):
            result = original_validate(output, inventory)
            other = self.root / "replacement"; other.write_bytes(b"replacement"); other.chmod(0o600)
            os.replace(other, self.output)
            return result
        with self.prepare(), mock.patch.object(producer, "_validate_output", side_effect=replace), self.assertRaises(producer.NormalizationRejected): self.run_producer()
        self.assertFalse(self.receipt.exists())

    def test_absolute_distinct_paths_and_typed_suffixes_required(self):
        with self.prepare():
            for output, receipt in (("relative.tar.gz", self.receipt), (self.output, self.output), (self.root / "bad.zip", self.receipt), (self.output, self.root / "bad.txt")):
                with self.subTest(output=output, receipt=receipt), self.assertRaises(producer.NormalizationRejected):
                    producer.normalize_dependencies(self.input, output, receipt, _expected_uid=self.owner)
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
