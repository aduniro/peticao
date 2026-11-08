import json,unittest,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class IsolationTests(unittest.TestCase):
    def test_networks_and_local_ports(self):
        c=json.loads((ROOT/"compose.json").read_text())
        self.assertTrue(all(n["internal"] for n in c["networks"].values()))
        self.assertNotEqual(c["services"]["app-a"]["networks"],c["services"]["app-b"]["networks"])
        self.assertEqual(c["services"]["app-a"]["ports"],["127.0.0.1:3040:8080"])
        self.assertEqual(c["services"]["app-b"]["ports"],["127.0.0.1:3041:8080"])
        for key,service in c["services"].items():
            if key.startswith("db-"):self.assertNotIn("ports",service)
    def test_only_fictitious_configuration_and_no_production_mounts(self):
        c=json.loads((ROOT/"compose.json").read_text())
        for key in ["app-a","app-b"]:
            service=c["services"][key];env=service["environment"]
            self.assertEqual(env["MAIL_PROVIDERS"],"dev")
            self.assertTrue(env["HASH_PEPPER"].startswith("QA-LAB-"))
            self.assertTrue(env["CPF_CACHE_ENCRYPTION_KEY"].startswith("QA-LAB-"))
            self.assertEqual(env["CPF_FORCE_MOCK"],"1")
            for mount in service["volumes"]:
                self.assertTrue(mount.startswith(str(ROOT)+"/"))
                self.assertNotIn("backups",mount)
                self.assertNotIn("secrets",mount)
    def test_sources_preserve_backup_and_candidate_bytes(self):
        original=json.loads((ROOT/"SOURCE-MANIFEST.json").read_text())["files"]
        for name,data in original.items():
            self.assertEqual(hashlib.sha256((ROOT/"app"/name).read_bytes()).hexdigest(),data["sha256"],name)
        candidate=json.loads((ROOT/"provenance.json").read_text())["candidate_effective_files"]
        for name,data in candidate.items():
            self.assertEqual(hashlib.sha256((ROOT/"formularios/app"/name).read_bytes()).hexdigest(),data["sha256"],name)
        for folder in [ROOT/"app",ROOT/"formularios/app"]:
            self.assertFalse(any(p.is_file() and p.name.startswith(".env") for p in folder.rglob("*")))
if __name__=="__main__":unittest.main()
