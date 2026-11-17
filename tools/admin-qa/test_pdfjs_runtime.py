import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from pdfjs_runtime import runtime_manifest


class RuntimeIntegrity(unittest.TestCase):
    def test_missing_runtime_and_pinned_files(self):
        with tempfile.TemporaryDirectory(prefix="peticao-runtime-qa-") as tmp:
            root = Path(tmp)
            scripts = root / "site/scripts"
            scripts.mkdir(parents=True)
            data = b"FICTITIOUS RUNTIME"
            entry = {"path": "pdf.mjs", "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
            lock = {"version": "qa", "archiveIntegrity": "FICTITIOUS", "files": {"package/test": entry}}
            (scripts / "pdfjs-assets.lock.json").write_text(json.dumps(lock))
            self.assertEqual(runtime_manifest(root), {})
            with self.assertRaises(AssertionError):
                runtime_manifest(root, required=True)
            target = root / "site/public/vendor/pdfjs/qa"
            target.mkdir(parents=True)
            asset = target / "pdf.mjs"
            asset.write_bytes(data)
            version = target / "assets-version.json"
            version.write_text(json.dumps({"version": "qa", "archiveIntegrity": "FICTITIOUS", "assets": 1}))
            self.assertEqual(len(runtime_manifest(root, required=True)), 2)
            asset.write_bytes(b"CHANGED")
            with self.assertRaises(AssertionError):
                runtime_manifest(root, required=True)
            asset.unlink()
            elsewhere = root / "other.mjs"
            elsewhere.write_bytes(data)
            asset.symlink_to(elsewhere)
            with self.assertRaises(AssertionError):
                runtime_manifest(root, required=True)
            asset.unlink()
            asset.write_bytes(data)
            version.write_text(json.dumps({"version": "wrong", "archiveIntegrity": "FICTITIOUS", "assets": 1}))
            with self.assertRaises(AssertionError):
                runtime_manifest(root, required=True)


if __name__ == "__main__":
    unittest.main()
