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


if __name__ == "__main__":
    unittest.main()
