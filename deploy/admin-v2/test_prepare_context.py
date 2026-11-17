import importlib.util
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

from prepare_context import prepare


class PrepareContextTests(unittest.TestCase):
    def bundle(self, directory, *, name="runtime/.next/BUILD_ID", body=b"fixture", digest=None, commit="a" * 40):
        archive = Path(directory) / "runtime.tar"
        manifest = {"source_commit": commit, "files": {".next/BUILD_ID": {
            "bytes": len(body), "sha256": digest or hashlib.sha256(body).hexdigest()}}}
        with tarfile.open(archive, "w") as stream:
            for path, data in [("release-manifest.json", json.dumps(manifest).encode()), (name, body)]:
                member = tarfile.TarInfo(path)
                member.size = len(data)
                stream.addfile(member, io.BytesIO(data))
        with archive.open("rb") as stream:
            return archive, hashlib.file_digest(stream, "sha256").hexdigest()

    def test_verified_context_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as folder:
            archive, digest = self.bundle(folder)
            destination = Path(folder) / "context"
            receipt = prepare(archive, digest, "a" * 40, destination)
            self.assertEqual(receipt["verified_files"], 1)
            self.assertEqual((destination / "runtime/.next/BUILD_ID").read_bytes(), b"fixture")
            with self.assertRaises(FileExistsError):
                prepare(archive, digest, "a" * 40, destination)

    def test_archive_hash_and_commit_before_creating_context(self):
        with tempfile.TemporaryDirectory() as folder:
            archive, digest = self.bundle(folder)
            destination = Path(folder) / "context"
            for expected, commit in [("0" * 64, "a" * 40), (digest, "b" * 40)]:
                with self.assertRaises(ValueError):
                    prepare(archive, expected, commit, destination)
                self.assertFalse(destination.exists())

    def test_traversal_and_environment_file_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            for name in ["runtime/../../escaped", "runtime/.env.local"]:
                archive, digest = self.bundle(folder, name=name)
                destination = Path(folder) / "context"
                with self.assertRaises(ValueError):
                    prepare(archive, digest, "a" * 40, destination)
                self.assertFalse(destination.exists())

    def test_member_content_is_hashed(self):
        with tempfile.TemporaryDirectory() as folder:
            archive, digest = self.bundle(folder, digest="0" * 64)
            with self.assertRaisesRegex(ValueError, "runtime_file_hash_mismatch"):
                prepare(archive, digest, "a" * 40, Path(folder) / "context")


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("prepare_context", HERE / "prepare_context.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
COMMIT = "a" * 40


class RuntimeProfiles(unittest.TestCase):
    def setUp(self):
        scratch = HERE.parents[1] / ".cache" / "runtime-profile-tests"
        scratch.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=scratch)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / "runtime.tar"
        payload = b"synthetic QA runtime; no operational data\n"
        manifest = {"source_commit": COMMIT, "files": {"entry.js": {
            "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}}}
        with tarfile.open(self.archive, "w") as bundle:
            for name, data in [("release-manifest.json", json.dumps(manifest).encode()),
                               ("runtime/entry.js", payload)]:
                member = tarfile.TarInfo(name)
                member.size = len(data)
                member.mode = 0o644
                bundle.addfile(member, io.BytesIO(data))
        self.digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()

    def prepare(self, **kwargs):
        return MODULE.prepare(self.archive, self.digest, COMMIT, self.root / "context", **kwargs)

    def test_default_preserves_node20_and_payload_provenance(self):
        receipt = self.prepare()
        dockerfile = (self.root / "context/Dockerfile").read_text()
        self.assertTrue(dockerfile.startswith((HERE / "Dockerfile").read_text()))
        self.assertIn("node:20.19.2-bookworm-slim@sha256:", dockerfile)
        self.assertEqual(receipt["runtime_profile"], "node20")
        self.assertEqual(receipt["source_commit"], COMMIT)
        self.assertEqual(receipt["runtime_sha256"], self.digest)
        self.assertFalse(receipt["deployed"])

    def test_node22_is_explicit_pinned_and_keeps_same_payload(self):
        receipt = self.prepare(profile="node22")
        dockerfile = (self.root / "context/Dockerfile").read_text()
        self.assertIn("node:22.23.5-bookworm-slim@sha256:47725aca", dockerfile)
        self.assertIn('USER node', dockerfile)
        self.assertIn('"127.0.0.1"', dockerfile)
        self.assertEqual(receipt["runtime_profile"], "node22")
        self.assertEqual(receipt["dockerfile_sha256"],
                         hashlib.sha256((HERE / "Dockerfile.node22").read_bytes()).hexdigest())
        self.assertEqual(receipt["source_commit"], COMMIT)
        self.assertEqual((self.root / "context/runtime/entry.js").read_bytes(),
                         b"synthetic QA runtime; no operational data\n")

    def test_arbitrary_profile_path_rejected_before_writes(self):
        with self.assertRaisesRegex(ValueError, "unsupported_runtime_profile"):
            self.prepare(profile="../../Dockerfile")
        self.assertFalse((self.root / "context").exists())

    def test_wrong_source_is_rejected_under_node22(self):
        with self.assertRaisesRegex(ValueError, "runtime_source_commit_mismatch"):
            MODULE.prepare(self.archive, self.digest, "b" * 40,
                           self.root / "context", profile="node22")
        self.assertFalse((self.root / "context").exists())

    def test_digest_mismatch_never_creates_context(self):
        with self.assertRaisesRegex(ValueError, "archive_hash_mismatch"):
            MODULE.prepare(self.archive, "0" * 64, COMMIT,
                           self.root / "context", profile="node22")
        self.assertFalse((self.root / "context").exists())



if __name__ == "__main__":
    unittest.main()
