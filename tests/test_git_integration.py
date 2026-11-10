"""Real Git in temporary fictitious repositories; evidence files are synthetic QA fixtures."""
import copy
from dataclasses import replace
import hashlib
import json
from pathlib import Path
import tempfile
import time
import unittest
import uuid

from git_transport import RepositoryPolicy, TransportError, digest, export_bundle, import_bundle, git, machine_id_sha256, ready_proof, tree_manifest
from integration import prepare, promote, load_prepared
from protocol import validate_config, validate_job, NODE_VERSION, NODE_SHA256, NEXT_VERSION, CHECKS, ENV
from admin_exec.queue import Queue

HERE=Path(__file__).resolve().parents[1]

class GitIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix="admin-v2-git-fixture-")
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.repos=self.root/"repos";self.repos.mkdir()
        self.source=self.repos/"source";self.source.mkdir()
        git(self.source,"init","-b","main")
        self.write(self.source,"README.md","Fictitious source\n")
        self.write(self.source,"site/package-lock.json",'{"fixture":true}\n')
        self.write(self.source,"tools/admin-qa/mail-delivery-compiled-local.py","# Never executed fixture wrapper\n")
        self.write(self.source,"tools/admin-qa/mail-history-compiled-local.py","# Never executed history fixture\n")
        git(self.source,"add","--all");git(self.source,"commit","-m","Fictitious base")
        self.base=self.head(self.source)
        self.target=self.repos/"integrator"
        git(self.repos,"clone","--no-local","--no-hardlinks",str(self.source),str(self.target))
        self.ref="integration/admin-v2-fixture"
        git(self.target,"update-ref","refs/heads/"+self.ref,self.base)
        self.config=json.loads((HERE/"config.json").read_text())
        self.config.update(execution_enabled=True,state_path=str(self.root/"queue.sqlite"),artifact_root=str(self.root/"artifacts"))
        for key in ["local","santiago"]:
            self.config["hosts"][key].update(repository_root=str(self.repos),machine_id_sha256=machine_id_sha256())
        self.config["hosts"]["santiago"]["enabled"]=True
        for kind,wrapper in self.config["wrappers"].items():wrapper["sha256"]=hashlib.sha256((self.source/wrapper["relative_path"]).read_bytes()).hexdigest()
        self.config=validate_config(self.config)
        self.policy=RepositoryPolicy.from_config(self.config,"santiago")
        now=time.time()
        self.handshake={"schema_version":1,"handshake_id":str(uuid.uuid4()),"worker_id":"santiago","role":"integrator","repository_root":str(self.repos),"machine_id_sha256":machine_id_sha256(),"issued_at":now,"expires_at":now+1200,"config_sha256":digest(self.config),"capability_sha256":"a"*64,"node_version":NODE_VERSION,"node_sha256":NODE_SHA256,"next_version":NEXT_VERSION}
        self.ready=ready_proof(self.handshake,self.config)
        git(self.source,"checkout","-b","worker/admin-v2-author")
        self.write(self.source,"feature.txt","Fictitious feature\n");git(self.source,"add","--all");git(self.source,"commit","-m","Fictitious feature")
        self.candidate=self.head(self.source)

    @staticmethod
    def write(repo,path,content):
        destination=repo/path;destination.parent.mkdir(parents=True,exist_ok=True);destination.write_text(content)
    @staticmethod
    def head(repo):return git(repo,"rev-parse","HEAD").decode().strip()
    def sync(self):
        bundle=export_bundle(self.policy,self.source,self.base,self.candidate,execute=True,ready=self.ready)
        return import_bundle(self.policy,self.target,bundle["bundle"],bundle["bundle_sha256"],self.base,self.candidate,"worker/admin-v2-received",execute=True,ready=self.ready)
    def prepared(self):
        self.sync();return prepare(self.policy,self.config,self.target,self.ref,self.base,self.candidate,execute=True,ready=self.ready)
    def completed_queue(self,prepared,*,coverage=None,wrong_manifest=False):
        record=load_prepared(self.policy,prepared);merged=record["merged_commit"]
        job={"schema_version":1,"job_id":str(uuid.uuid4()),"intent_id":str(uuid.uuid4()),"kind":"qualification_delivery","target_worker":"santiago","source":{"commit":merged,"ref":record["temporary_ref"],"repository_path":str(self.target),"bundle_sha256":"b"*64,"source_manifest_sha256":"c"*64 if wrong_manifest else record["source_manifest_sha256"],"wrapper_sha256":self.config["wrappers"]["qualification_delivery"]["sha256"]},"runtime":{"node_version":NODE_VERSION,"node_sha256":NODE_SHA256,"next_version":NEXT_VERSION,"package_lock_sha256":tree_manifest(self.target,merged,self.policy)["site/package-lock.json"]["sha256"],"assets_manifest_sha256":"d"*64,"assets_count":202},"integration":{"ref":self.ref,"expected_base":self.base},"env":dict(ENV),"resources":{"cpu_cores":1,"memory_mib":1024,"timeout_seconds":60},"safety":{"production":False,"external_messages":False,"automatic_retry":False}}
        queue=Queue(self.config["state_path"],self.config)
        spec=validate_job(job,self.config);queue.enqueue(spec);queue.register_ready(self.handshake)
        claim=queue.claim(job["job_id"],"santiago",1)["job"]
        running=queue.start(job["job_id"],claim["claim_id"],claim["generation"],claim["version"],{"host":"santiago","pid":123,"session_id":str(uuid.uuid4())})["job"]
        name=f'{job["job_id"]}/generation-{running["generation"]}/execution.json'
        path=Path(self.config["artifact_root"])/name;path.parent.mkdir(parents=True)
        execution={"commit":merged,"buildCommit":merged,"exit":0,"runtimeAssets":202,"sourceStable":True,"runtimeAssetsStable":True,"commitStable":True,"completeBuildSourceMapEqual":True,"portsClosed":{"11111":True}}
        path.write_text(json.dumps(execution));payload=path.read_bytes()
        result={"schema_version":1,"job_id":job["job_id"],"claim_id":running["claim_id"],"generation":running["generation"],"worker_id":"santiago","commit":merged,"build_commit":merged,"source_manifest_sha256":job["source"]["source_manifest_sha256"],"wrapper_sha256":job["source"]["wrapper_sha256"],"assets_manifest_sha256":job["runtime"]["assets_manifest_sha256"],"package_lock_sha256":job["runtime"]["package_lock_sha256"],"node_sha256":NODE_SHA256,"exit_code":0,"checks":{key:True for key in CHECKS},"coverage":coverage if coverage is not None else self.config["required_checks"][job["kind"]],"artifacts":[{"path":name,"sha256":hashlib.sha256(payload).hexdigest(),"bytes":len(payload)}],"execution_artifact":name}
        queue.finish(job["job_id"],running["claim_id"],running["generation"],running["version"],result)
        return queue,job["job_id"],path

    def test_bidirectional_commit_bundle_does_not_copy_dirty_or_ignored_files(self):
        self.write(self.source,".gitignore","ignored.secret\n");git(self.source,"add",".gitignore");git(self.source,"commit","-m","Ignore fixture runtime")
        self.candidate=self.head(self.source)
        self.write(self.source,"ignored.secret","MUST-NOT-COPY")
        report=self.sync()
        self.assertEqual(report["commit"],self.candidate)
        self.assertEqual(self.head(self.target),self.base)
        self.assertFalse((self.target/"ignored.secret").exists())
        self.assertEqual(git(self.target,"rev-parse","refs/heads/worker/admin-v2-received").decode().strip(),self.candidate)
        # Reverse direction is the same local bundle protocol, not a source push.
        reverse=export_bundle(self.policy,self.target,self.base,self.candidate,execute=True,ready=self.ready)
        received=import_bundle(self.policy,self.source,reverse["bundle"],reverse["bundle_sha256"],self.base,self.candidate,"worker/admin-v2-returned",execute=True,ready=self.ready)
        self.assertEqual(received["commit"],self.candidate)
        self.write(self.source,"uncommitted.txt","dirty")
        with self.assertRaisesRegex(TransportError,"dirty_repository"):export_bundle(self.policy,self.source,self.base,self.candidate)

    def test_import_never_advances_a_checked_out_worker_ref(self):
        bundle=export_bundle(self.policy,self.source,self.base,self.candidate,execute=True,ready=self.ready)
        with self.assertRaisesRegex(TransportError,"staging_ref_checked_out"):
            import_bundle(self.policy,self.source,bundle["bundle"],bundle["bundle_sha256"],self.base,self.candidate,"worker/admin-v2-author",expected_old=self.candidate,execute=True,ready=self.ready)
        self.assertEqual(self.head(self.source),self.candidate)

    def test_default_dry_run_disabled_and_physical_gate(self):
        report=export_bundle(self.policy,self.source,self.base,self.candidate)
        self.assertTrue(report["dry_run"]);self.assertFalse((self.repos/".bundles").exists())
        disabled=copy.deepcopy(self.config);disabled["execution_enabled"]=False
        with self.assertRaisesRegex(TransportError,"execution_disabled"):export_bundle(RepositoryPolicy.from_config(disabled,"santiago"),self.source,self.base,self.candidate,execute=True,ready=self.ready)
        with self.assertRaisesRegex(TransportError,"not_ready"):export_bundle(self.policy,self.source,self.base,self.candidate,execute=True)

    def test_physical_identity_and_main_refs_cannot_be_bypassed(self):
        wrong=replace(self.ready,machine_id_sha256="f"*64)
        with self.assertRaisesRegex(TransportError,"physical_machine_mismatch"):export_bundle(self.policy,self.source,self.base,self.candidate,execute=True,ready=wrong)
        self.sync()
        for ref in ["main","master","prod","live","integration/admin-v2-../main"]:
            with self.assertRaises(TransportError):prepare(self.policy,self.config,self.target,ref,self.base,self.candidate,execute=True,ready=self.ready)
        no_op=prepare(self.policy,self.config,self.target,self.ref,self.base,self.base,execute=True,ready=self.ready)
        self.assertEqual(no_op["state"],"noop")

    def test_quarantine_rejects_forbidden_bundle_before_destination_objects(self):
        self.write(self.source,"secrets/fixture.txt","NO REAL SECRET")
        git(self.source,"add","--all");git(self.source,"commit","-m","Untrusted fixture bundle")
        candidate=self.head(self.source);blob=git(self.source,"rev-parse",candidate+":secrets/fixture.txt").decode().strip()
        directory=self.repos/".bundles";directory.mkdir();path=directory/"untrusted.bundle"
        git(self.source,"bundle","create",str(path),"refs/heads/worker/admin-v2-author","^"+self.base)
        with self.assertRaisesRegex(TransportError,"forbidden_tracked_path"):
            import_bundle(self.policy,self.target,path,hashlib.sha256(path.read_bytes()).hexdigest(),self.base,candidate,"worker/admin-v2-untrusted",execute=True,ready=self.ready)
        with self.assertRaises(TransportError):git(self.target,"cat-file","-e",blob)

    def test_real_cas_rejects_ref_changed_after_evidence_read_starts(self):
        prepared=self.prepared();queue,job_id,_=self.completed_queue(prepared)
        owner=self
        class ConcurrentReceipt:
            def completed_receipt(self,identifier):
                receipt=queue.completed_receipt(identifier)
                git(owner.target,"update-ref","refs/heads/"+owner.ref,owner.candidate,owner.base)
                return receipt
        with self.assertRaisesRegex(TransportError,"git_update-ref_failed"):
            promote(self.policy,self.config,prepared,ConcurrentReceipt(),job_id,execute=True,ready=self.ready)
        self.assertEqual(git(self.target,"rev-parse","refs/heads/"+self.ref).decode().strip(),self.candidate)

    def test_wrong_manifest_rejected_even_when_queue_receipt_and_artifacts_are_self_consistent(self):
        prepared=self.prepared();queue,job_id,_=self.completed_queue(prepared,wrong_manifest=True)
        with self.assertRaisesRegex(TransportError,"source_manifest_mismatch"):promote(self.policy,self.config,prepared,queue,job_id,execute=True,ready=self.ready)
        self.assertEqual(git(self.target,"rev-parse","refs/heads/"+self.ref).decode().strip(),self.base)

    def test_forbidden_transient_history_and_executable_git_drivers_rejected(self):
        self.write(self.source,"secrets/token.txt","FORBIDDEN FIXTURE");git(self.source,"add","--all");git(self.source,"commit","-m","Forbidden fixture")
        git(self.source,"rm","secrets/token.txt");git(self.source,"commit","-m","Remove forbidden fixture")
        with self.assertRaisesRegex(TransportError,"forbidden_tracked"):export_bundle(self.policy,self.source,self.base,self.head(self.source))
        git(self.target,"config","filter.fake.smudge","touch /tmp/SHOULD-NOT-EXECUTE")
        with self.assertRaisesRegex(TransportError,"unsafe_local_git_config"):prepare(self.policy,self.config,self.target,self.ref,self.base,self.base)

    def test_clean_merge_requires_exact_complete_evidence_then_cas_only_integration(self):
        prepared=self.prepared();record=load_prepared(self.policy,prepared)
        self.assertEqual(record["state"],"prepared");self.assertEqual(git(self.target,"rev-parse","refs/heads/"+self.ref).decode().strip(),self.base)
        queue,job_id,_=self.completed_queue(prepared)
        planned=promote(self.policy,self.config,prepared,queue,job_id)
        self.assertTrue(planned["eligible"]);self.assertFalse(planned["integration_ref_advanced"])
        applied=promote(self.policy,self.config,prepared,queue,job_id,execute=True,ready=self.ready)
        self.assertTrue(applied["integration_ref_advanced"])
        self.assertEqual(self.head(self.target),self.base)
        self.assertEqual(git(self.target,"rev-parse","refs/heads/main").decode().strip(),self.base)
        self.assertEqual(git(self.target,"rev-parse","refs/heads/"+self.ref).decode().strip(),record["merged_commit"])

    def test_modified_artifact_missing_coverage_wrong_tree_and_cas_do_not_promote(self):
        prepared=self.prepared();queue,job_id,path=self.completed_queue(prepared)
        path.write_text("tampered")
        with self.assertRaises(Exception):promote(self.policy,self.config,prepared,queue,job_id,execute=True,ready=self.ready)
        self.assertEqual(git(self.target,"rev-parse","refs/heads/"+self.ref).decode().strip(),self.base)
        with self.assertRaises(Exception):self.completed_queue(prepared,coverage=["http"])

    def test_conflict_is_recorded_not_resolved_or_promoted(self):
        self.write(self.source,"README.md","Worker conflict\n");git(self.source,"add","--all");git(self.source,"commit","-m","Worker conflict");self.candidate=self.head(self.source)
        self.write(self.target,"README.md","Integrator conflict\n");git(self.target,"add","--all");git(self.target,"commit","-m","Integrator conflict");new_base=self.head(self.target)
        git(self.target,"update-ref","refs/heads/"+self.ref,new_base,self.base)
        self.sync()
        prepared=prepare(self.policy,self.config,self.target,self.ref,new_base,self.candidate,execute=True,ready=self.ready)
        report=load_prepared(self.policy,prepared)
        self.assertEqual(report["state"],"conflict");self.assertIn("README.md",report["conflicts"]);self.assertFalse(report["auto_resolved"]);self.assertEqual({s["stage"] for s in report["conflict_stages"]},{1,2,3})
        self.assertEqual(git(self.target,"rev-parse","refs/heads/"+self.ref).decode().strip(),new_base)

if __name__=="__main__":unittest.main()
