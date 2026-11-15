"""Fixed-action worker RPC and durable unit/result bindings.

The transport authenticates the controller. Adapter implementations are trusted
code, never request parameters. No start is retried after an uncertain response.
"""
from __future__ import annotations

import base64
import fcntl
import contextlib
import hashlib
import json
import os
import stat
from pathlib import Path
import tempfile

import artifacts
import remote_contract as contract
import log_redaction


def exact(value, fields):
    if not isinstance(value,dict) or set(value)!=set(fields):raise ValueError("exact_rpc_fields_required")


def trusted_executable(path):
    p=Path(path).absolute()
    for ancestor in [*reversed(p.parents),p]:
        info=ancestor.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022:raise PermissionError("root_executable_chain_required")
    if not p.is_file() or not p.stat().st_mode&0o111:raise PermissionError("root_executable_required")
    return p


class WorkerRPC:
    def __init__(self,journal,adapter,profiles,export_root,admission,program_validator=contract.root_control_file):
        self.journal,self.adapter=journal,adapter
        self.profiles={k:dict(v) for k,v in profiles.items()}
        self.exports=artifacts.private_root(export_root)
        self.program_validator=program_validator
        self.admission=admission
        with contract.transaction(journal.path) as db:
            if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='unit_bindings'").fetchone():
                raise ValueError("explicit_worker_runtime_initialization_required")

    @staticmethod
    def install_schema(journal):
        with contract.transaction(journal.path,True) as db:
            journal._epoch(db)
            db.execute("""CREATE TABLE unit_bindings(job_id TEXT PRIMARY KEY REFERENCES receipts(job_id),
              receipt_sha256 TEXT NOT NULL,invocation_id TEXT NOT NULL,cgroup_path TEXT NOT NULL,
              first_observation TEXT NOT NULL,stop_proof TEXT,bundle_sha256 TEXT,finalized_result TEXT)""")

    def descriptor(self,manifest):
        contract.validate_manifest(manifest,self.journal.profiles)
        value=self.profiles.get(manifest["profile"])
        if not value or value.get("name")!=manifest["profile"] or contract.digest(value)!=manifest["profile_sha256"]:
            raise PermissionError("qualified_profile_descriptor_required")
        for field in ("source_sha256","dependencies_sha256","artifact_policy_sha256"):
            if value.get(field)!=manifest[field]:raise PermissionError("profile_input_digest_mismatch")
        program=self.program_validator(value["program"])
        if hashlib.sha256(program.read_bytes()).hexdigest()!=value["program_sha256"]:
            raise PermissionError("qualified_program_changed")
        interpreter=trusted_executable(value["python_path"])
        if hashlib.sha256(interpreter.read_bytes()).hexdigest()!=value["python_sha256"]:raise PermissionError("qualified_interpreter_changed")
        return dict(value)

    def stored(self,job_id):
        contract.hex_value(job_id,32)
        with contract.transaction(self.journal.path) as db:
            row=db.execute("SELECT * FROM receipts WHERE job_id=?",(job_id,)).fetchone()
            binding=db.execute("SELECT * FROM unit_bindings WHERE job_id=?",(job_id,)).fetchone()
            if not row:raise ValueError("unknown_worker_receipt")
            return dict(row),dict(binding) if binding else None

    def bind(self,manifest,receipt,observed):
        self.validate_observation(manifest,receipt,observed)
        with contract.transaction(self.journal.path,True) as db:
            self.journal._epoch(db);self.journal._manifest(manifest)
            old=db.execute("SELECT * FROM unit_bindings WHERE job_id=?",(manifest["job_id"],)).fetchone()
            if old:
                if old["receipt_sha256"]!=contract.digest(receipt) or old["invocation_id"]!=observed["invocation_id"]:
                    raise PermissionError("unit_identity_changed")
                return dict(old)
            db.execute("INSERT INTO unit_bindings VALUES(?,?,?,?,?,NULL,NULL,NULL)",
                       (manifest["job_id"],contract.digest(receipt),observed["invocation_id"],observed["cgroup_path"],contract.canonical(observed)))
            return dict(db.execute("SELECT * FROM unit_bindings WHERE job_id=?",(manifest["job_id"],)).fetchone())

    def validate_observation(self,manifest,receipt,value):
        required={"unit","invocation_id","worker_boot_id","manifest_sha256","receipt_sha256","main_pid","cgroup_empty","cgroup_path","exit_code","exited"}
        if not isinstance(value,dict) or set(value)!=required:raise ValueError("exact_unit_observation_required")
        if (value["unit"]!=receipt["unit"] or value["worker_boot_id"]!=receipt["boot_id"]
                or value["manifest_sha256"]!=contract.digest(manifest) or value["receipt_sha256"]!=contract.digest(receipt)
                or value["worker_boot_id"]!=self.journal.boot_id()):raise PermissionError("unit_observation_identity_mismatch")
        contract.hex_value(value["invocation_id"],32)
        if type(value["main_pid"]) is not int or value["main_pid"]<0 or type(value["cgroup_empty"]) is not bool or type(value["exited"]) is not bool:
            raise ValueError("typed_unit_process_observation_required")
        if not isinstance(value["cgroup_path"],str) or (value["cgroup_path"] and not value["cgroup_path"].startswith("/system.slice/admin-dev-")) or ".." in value["cgroup_path"].split("/"):
            raise ValueError("own_cgroup_path_required")
        if value["exit_code"] is not None and (type(value["exit_code"]) is not int or not 0<=value["exit_code"]<=255):
            raise ValueError("bounded_exit_code_required")

    def start(self,request):
        exact(request,("action","manifest","token","receipt_sha256"))
        manifest=request["manifest"];descriptor=self.descriptor(manifest)
        def launch(m,r):
            observed=self.adapter.start(m,r,descriptor)
            self.bind(m,r,observed)
            return observed["invocation_id"]
        started=self.journal.start_once(manifest,request["token"],request["receipt_sha256"],launch)
        return {"started":started,"observation":self.observe(manifest["job_id"])}

    def observe(self,job_id):
        row,binding=self.stored(job_id)
        result=self.journal.observe(job_id)
        if not result["boot_matches"]:
            return {**result,"unit":None,"reconciliation_required":True}
        manifest=json.loads(row["manifest_json"]);receipt=json.loads(row["receipt_json"])
        descriptor=self.descriptor(manifest)
        unit=None if binding and binding["stop_proof"] else self.adapter.observe(manifest,receipt,descriptor)
        if unit is not None:self.validate_observation(manifest,receipt,unit)
        if binding and unit and binding["invocation_id"]!=unit["invocation_id"]:
            raise PermissionError("observed_unit_recreated")
        return {**result,"unit":unit,"stop_proof":json.loads(binding["stop_proof"]) if binding and binding["stop_proof"] else None,
                "bundle_sha256":binding["bundle_sha256"] if binding else None}

    def stop(self,job_id,cancel=False):
        row,binding=self.stored(job_id);manifest=json.loads(row["manifest_json"]);receipt=json.loads(row["receipt_json"])
        self.journal._manifest(manifest)
        if receipt["boot_id"]!=self.journal.boot_id():raise PermissionError("reboot_requires_reconciliation")
        descriptor=self.descriptor(manifest)
        if binding and binding["stop_proof"]:
            proof=json.loads(binding["stop_proof"])
            if proof["canceled"]!=cancel:raise PermissionError("different_stop_intent_requires_reconciliation")
            return proof
        current=self.adapter.observe(manifest,receipt,descriptor)
        if current is None:
            if row["state"] in {"prepared","canceled_before_start"} and cancel:
                state=self.journal.cancel_intent(manifest) if row["state"]=="prepared" else "canceled_before_start"
                return {"state":state,"no_unit_created":True,"receipt_sha256":contract.digest(receipt),"worker_boot_id":receipt["boot_id"]}
            if not (binding and cancel):raise RuntimeError("unit_absent_without_stop_proof_uncertain")
        else:
            binding=self.bind(manifest,receipt,current)
        if not cancel and (not current["exited"] or current["main_pid"]!=0 or not current["cgroup_empty"]):
            raise RuntimeError("workload_not_finished")
        # Stop only the bound invocation. Adapter must re-observe before stop
        # and return a fresh process/cgroup proof, not echo request booleans.
        stopped=self.adapter.stop(manifest,receipt,descriptor,binding)
        exact(stopped,("unit","invocation_id","worker_boot_id","main_pid","cgroup_empty","unit_stopped","exit_code"))
        if (stopped["unit"]!=receipt["unit"] or stopped["invocation_id"]!=binding["invocation_id"] or stopped["worker_boot_id"]!=receipt["boot_id"]
                or type(stopped["main_pid"]) is not int or stopped["main_pid"]!=0 or stopped["cgroup_empty"] is not True or stopped["unit_stopped"] is not True):
            raise PermissionError("bound_unit_stop_not_proven")
        if stopped["exit_code"] is None:
            if not cancel:raise ValueError("observed_stop_exit_required")
        elif type(stopped["exit_code"]) is not int or not 0<=stopped["exit_code"]<=255:raise ValueError("observed_stop_exit_required")
        proof={**stopped,"canceled":cancel,"receipt_sha256":contract.digest(receipt)}
        with contract.transaction(self.journal.path,True) as db:
            self.journal._epoch(db);self.journal._manifest(manifest)
            db.execute("UPDATE unit_bindings SET stop_proof=? WHERE job_id=? AND stop_proof IS NULL",(contract.canonical(proof),job_id))
        return proof

    def finalize(self,job_id,cancel=False):
        row,binding=self.stored(job_id);manifest=json.loads(row["manifest_json"]);receipt=json.loads(row["receipt_json"])
        self.journal._manifest(manifest)
        if binding and binding["bundle_sha256"]:
            sealed=json.loads(binding["finalized_result"])
            return {"already_finalized":True,"bundle_sha256":binding["bundle_sha256"],"late_cancel":cancel and sealed["outcome"]!="canceled"}
        requested_cancel=cancel
        if binding and binding["stop_proof"]:
            # Preserve the first durable stop/finalization intent. A late
            # cancellation cannot rewrite a finished workload's evidence.
            cancel=json.loads(binding["stop_proof"])["canceled"]
        stopped=self.stop(job_id,cancel)
        if stopped.get("state")=="canceled_before_start":return stopped
        descriptor=self.descriptor(manifest)
        source=self.adapter.output_root(manifest,receipt,descriptor)
        report=None;raw_report=None
        try:
            raw_report=artifacts.file_bytes(Path(source)/"result.json",1024*1024)
        except FileNotFoundError:
            pass
        if raw_report is not None:
            try:report=json.loads(raw_report)
            except (json.JSONDecodeError,UnicodeDecodeError):pass
        valid=(isinstance(report,dict) and type(report.get("protocol")) is int and report["protocol"]==1 and report.get("profile")==manifest["profile"]
               and type(report.get("exit_code")) is int and report["exit_code"]==stopped["exit_code"])
        outcome="canceled" if cancel else "completed" if stopped["exit_code"]==0 and valid else "failed"
        identity={"job_id":job_id,"generation":manifest["generation"],"manifest_sha256":contract.digest(manifest),
                  "receipt_sha256":contract.digest(receipt),"invocation_id":stopped["invocation_id"],"worker_boot_id":receipt["boot_id"]}
        result={"protocol":1,"identity":identity,"profile":manifest["profile"],"outcome":outcome,"exit_code":stopped["exit_code"],
                "unit_stop":stopped,"runner_report":report,"runner_report_valid":valid,"runner_report_sha256":artifacts.sha(raw_report) if raw_report is not None else None}
        # Exclusive intent survives a crash in export. Never silently rebuild
        # a potentially published payload under the same job/receipt.
        artifacts.durable_json(self.exports/(job_id+".export-intent.json"),{"identity":identity,"result_sha256":contract.digest(result)})
        stage=Path(tempfile.mkdtemp(prefix=".export-"+job_id+"-",dir=self.exports))
        original=Path(source)/"artifacts"
        if original.exists() or original.is_symlink():
            if original.is_symlink() or not original.is_dir():raise ValueError("artifact_source_tree_link_or_type")
            total=0;count=0
            for directory,dirs,files in os.walk(original,followlinks=False):
                for name in dirs:
                    if (Path(directory)/name).is_symlink():raise ValueError("artifact_source_directory_link")
                for name in files:
                    path=Path(directory)/name;relative=artifacts.safe_name("artifacts/"+path.relative_to(original).as_posix())
                    count+=1
                    if count>artifacts.MAX_FILES:raise ValueError("artifact_file_budget")
                    raw=artifacts.file_bytes(path,artifacts.MAX_BYTES-total);total+=len(raw)
                    target=stage/relative;artifacts.private_parents(stage,str(Path(relative).parent))
                    fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                    with os.fdopen(fd,"wb") as f:f.write(raw);f.flush();os.fsync(f.fileno())
        artifacts.durable_json(stage/"result.json",result)
        payload=artifacts.pack(stage,identity)
        path=self.exports/(job_id+".tar")
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,"wb") as f:f.write(payload);f.flush();os.fsync(f.fileno())
        artifacts.sync_dir(self.exports)
        payload_sha=artifacts.sha(payload)
        with contract.transaction(self.journal.path,True) as db:
            self.journal._epoch(db);self.journal._manifest(manifest)
            db.execute("UPDATE unit_bindings SET bundle_sha256=?,finalized_result=? WHERE job_id=? AND bundle_sha256 IS NULL",(payload_sha,contract.canonical(result),job_id))
            db.execute("UPDATE receipts SET state=?,updated_at=? WHERE job_id=?",(outcome,contract.now(),job_id))
        return {"bundle_sha256":payload_sha,"result":result,"late_cancel":requested_cancel and not cancel}

    def bundle(self,job_id):
        row,binding=self.stored(job_id)
        if not binding or not binding["bundle_sha256"] or not binding["stop_proof"]:raise RuntimeError("verified_finalized_bundle_required")
        payload=artifacts.file_bytes(self.exports/(job_id+".tar"),artifacts.MAX_BYTES)
        if artifacts.sha(payload)!=binding["bundle_sha256"]:raise ValueError("finalized_bundle_changed")
        return {"bundle_sha256":binding["bundle_sha256"],"bundle_base64":base64.b64encode(payload).decode()}

    def logs(self,job_id,offset):
        if type(offset) is not int or not 0<=offset<=10*1024*1024:raise ValueError("bounded_log_offset_required")
        row,_=self.stored(job_id);manifest=json.loads(row["manifest_json"]);receipt=json.loads(row["receipt_json"])
        source=Path(self.adapter.output_root(manifest,receipt,self.descriptor(manifest)))
        try:fd=os.open(source/"output.log",os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        except FileNotFoundError:return {"id":job_id,"offset":offset,"output":"","available":False}
        with os.fdopen(fd,"rb") as f:
            info=os.fstat(f.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_size>10*1024*1024:raise ValueError("bounded_regular_job_log_required")
            raw=f.read(log_redaction.MAX_LOG+1)
        return {"id":job_id,**log_redaction.slice_log(raw,offset),"available":True}

    @contextlib.contextmanager
    def job_lock(self,job_id):
        contract.hex_value(job_id,32)
        path=self.exports/(job_id+".mutation.lock")
        fd=os.open(path,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
        try:
            info=os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.geteuid() or info.st_nlink!=1 or stat.S_IMODE(info.st_mode)!=0o600:raise PermissionError("private_job_mutex_required")
            try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:raise RuntimeError("worker_job_mutation_busy_observe_only") from None
            yield
        finally:os.close(fd)

    def rpc(self,request):
        if not isinstance(request,dict):raise ValueError("rpc_object_required")
        action=request.get("action")
        if action in {"prepare","start","cancel","finalize"}:
            if action=="prepare":exact(request,("action","manifest","token_sha256"))
            elif action=="start":exact(request,("action","manifest","token","receipt_sha256"))
            else:exact(request,("action","id"))
            manifest=request["manifest"] if action in {"prepare","start"} else json.loads(self.stored(request["id"])[0]["manifest_json"])
            contract.validate_manifest(manifest,self.journal.profiles)
            with self.admission.mutation(manifest),self.job_lock(manifest["job_id"]):
                return self._rpc(request)
        return self._rpc(request)

    def _rpc(self,request):
        if not isinstance(request,dict):raise ValueError("rpc_object_required")
        action=request.get("action")
        if action=="prepare":
            exact(request,("action","manifest","token_sha256"));m=request["manifest"];d=self.descriptor(m)
            # Preparing never starts a unit. Foreign fixed-name state is refused.
            self.adapter.preflight(m,d)
            return self.journal.prepare(m,request["token_sha256"])
        if action=="start":return self.start(request)
        if action=="logs":
            exact(request,("action","id","offset"));return self.logs(request["id"],request["offset"])
        if action in {"observe","finalize","cancel","bundle"}:
            exact(request,("action","id"));job=request["id"]
            if action=="observe":return self.observe(job)
            if action=="bundle":return self.bundle(job)
            return self.finalize(job,cancel=action=="cancel")
        raise ValueError("unsupported_worker_action")
