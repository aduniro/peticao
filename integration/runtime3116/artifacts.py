"""Bounded artifact transfer with an exclusive durable receive intent.

No network, job execution or database writes. Inputs must come from a fenced
workload; this module independently checks regular files, identities and hashes.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import tarfile
import tempfile

MAX_BYTES = 512 * 1024 * 1024
MAX_FILES = 10000
MAX_INDEX = 2 * 1024 * 1024


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def safe_name(name):
    if not isinstance(name, str) or not name or "\\" in name or "\x00" in name:
        raise ValueError("unsafe_artifact_name")
    p = PurePosixPath(name)
    if p.is_absolute() or str(p) != name or any(x in {".", ".."} for x in name.split("/")):
        raise ValueError("unsafe_artifact_name")
    if name != "result.json" and not name.startswith("artifacts/"):
        raise ValueError("artifact_path_not_allowed")
    return name


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def durable_json(path, value):
    raw = (canonical(value) + "\n").encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(raw); f.flush(); os.fsync(f.fileno())
    finally:
        sync_dir(Path(path).parent)


def private_root(path):
    p = Path(path).absolute()
    for ancestor in [*reversed(p.parents), p]:
        if stat.S_ISLNK(ancestor.lstat().st_mode):
            raise ValueError("artifact_root_symlink")
    info = p.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise PermissionError("owned_private_artifact_root_required")
    return p


def private_parents(root,relative):
    current=Path(root)
    for part in PurePosixPath(relative).parts:
        current=current/part
        try:current.mkdir(mode=0o700)
        except FileExistsError:pass
        info=current.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid!=os.geteuid() or stat.S_IMODE(info.st_mode)!=0o700:
            raise PermissionError("private_staging_directory_required")
    return current


def identity(value):
    import re
    if not isinstance(value, dict) or set(value) != {"job_id", "generation", "manifest_sha256", "receipt_sha256", "invocation_id", "worker_boot_id"}:
        raise ValueError("exact_artifact_identity_required")
    for key, size in (("job_id",32),("manifest_sha256",64),("receipt_sha256",64),("invocation_id",32)):
        if not isinstance(value[key],str) or not re.fullmatch("[a-f0-9]{%d}" % size,value[key]):
            raise ValueError("invalid_artifact_identity")
    if type(value["generation"]) is not int or value["generation"] < 1 or not isinstance(value["worker_boot_id"],str) or not re.fullmatch(r"[a-zA-Z0-9-]{1,80}",value["worker_boot_id"]):
        raise ValueError("invalid_artifact_generation_or_boot")
    return dict(value)


def file_bytes(path, budget):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd,"rb") as f:
        before = os.fstat(f.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > budget:
            raise ValueError("regular_singlelink_bounded_artifact_required")
        raw = f.read(budget+1)
        after = os.fstat(f.fileno())
    fields = ("st_dev","st_ino","st_size","st_mtime_ns","st_ctime_ns")
    if len(raw) > budget or len(raw) != before.st_size or any(getattr(before,k) != getattr(after,k) for k in fields):
        raise ValueError("artifact_changed_during_read")
    return raw


def pack(root, expected_identity):
    """Call only after cgroup quiescence. Root may belong to a DynamicUser."""
    expected_identity = identity(expected_identity)
    root = Path(root).absolute()
    for p in [*reversed(root.parents),root]:
        if p.is_symlink(): raise ValueError("artifact_source_symlink")
    if not root.is_dir(): raise ValueError("artifact_source_directory_required")
    entries = {}; total = 0
    # The runner's fixed protocol exports only result.json and artifacts/.
    names = [root/"result.json"]
    tree = root/"artifacts"
    if tree.exists() or tree.is_symlink():
        if tree.is_symlink() or not tree.is_dir(): raise ValueError("artifact_tree_directory_required")
        for directory, dirs, files in os.walk(tree,followlinks=False):
            for name in dirs:
                p = Path(directory)/name
                if p.is_symlink(): raise ValueError("artifact_directory_link_forbidden")
            names.extend(Path(directory)/name for name in files)
    for path in sorted(names):
        name = safe_name(path.relative_to(root).as_posix())
        if len(entries) >= MAX_FILES: raise ValueError("artifact_file_budget")
        raw = file_bytes(path,MAX_BYTES-total);total += len(raw);entries[name] = raw
    # Validate the result before exporting arbitrary bytes as a completed job.
    if len(entries["result.json"])>MAX_INDEX:raise ValueError("result_json_budget")
    result = json.loads(entries["result.json"])
    if not isinstance(result,dict): raise ValueError("object_result_required")
    index = {"identity":expected_identity,"files":[{"name":k,"bytes":len(v),"sha256":sha(v)} for k,v in entries.items()]}
    index_raw = canonical(index).encode()
    if len(index_raw) > MAX_INDEX: raise ValueError("artifact_index_budget")
    target = io.BytesIO()
    with tarfile.open(fileobj=target,mode="w",format=tarfile.USTAR_FORMAT) as archive:
        for name,raw in [("index.json",index_raw),*entries.items()]:
            item=tarfile.TarInfo(name);item.size=len(raw);item.mode=0o600;item.mtime=0
            archive.addfile(item,io.BytesIO(raw))
    payload = target.getvalue()
    if len(payload)>MAX_BYTES:raise ValueError("artifact_wire_budget")
    return payload


def inspect(payload, expected_identity):
    expected_identity=identity(expected_identity)
    if not isinstance(payload,bytes) or len(payload)>MAX_BYTES:raise ValueError("artifact_wire_budget")
    entries={};total=0
    with tarfile.open(fileobj=io.BytesIO(payload),mode="r:") as archive:
        for item in archive:
            if not item.isreg() or item.pax_headers or item.name in entries or item.size<0 or item.size>MAX_BYTES-total:
                raise ValueError("regular_unique_bounded_tar_members_required")
            if item.name!="index.json":safe_name(item.name)
            if len(entries)>MAX_FILES:raise ValueError("artifact_member_budget")
            f=archive.extractfile(item)
            raw=f.read(MAX_BYTES-total+1)
            if len(raw)!=item.size:raise ValueError("artifact_member_size_mismatch")
            entries[item.name]=raw;total+=len(raw)
    index_raw=entries.pop("index.json",None)
    if index_raw is None or len(index_raw)>MAX_INDEX:raise ValueError("bounded_artifact_index_required")
    index=json.loads(index_raw)
    if not isinstance(index,dict) or set(index)!={"identity","files"} or identity(index.get("identity"))!=expected_identity:
        raise PermissionError("artifact_bundle_identity_mismatch")
    expected=[{"name":k,"bytes":len(v),"sha256":sha(v)} for k,v in entries.items()]
    if index.get("files")!=expected or "result.json" not in entries:raise ValueError("artifact_index_content_mismatch")
    if any(set(row)!={"name","bytes","sha256"} or type(row["bytes"]) is not int for row in index["files"]):raise ValueError("typed_artifact_index_required")
    if len(entries["result.json"])>MAX_INDEX:raise ValueError("result_json_budget")
    result=json.loads(entries["result.json"])
    if not isinstance(result,dict):raise ValueError("object_result_required")
    return index,entries,result


class ArtifactStore:
    def __init__(self, root):self.root=private_root(root)

    def receive(self,payload,expected_identity):
        index,entries,result=inspect(payload,expected_identity)
        job=expected_identity["job_id"];wire_sha=sha(payload)
        # Persist intent before any extraction/publication. A lost local result
        # requires observe(), never another receive or a destructive overwrite.
        intent=self.root/(job+".receive-intent.json")
        durable_json(intent,{"identity":expected_identity,"wire_sha256":wire_sha})
        dest=self.root/job
        if os.path.lexists(dest):raise FileExistsError("artifact_destination_exists")
        stage=Path(tempfile.mkdtemp(prefix=".receive-"+job+"-",dir=self.root))
        for name,raw in entries.items():
            path=stage/name;private_parents(stage,str(PurePosixPath(name).parent))
            fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            with os.fdopen(fd,"wb") as f:f.write(raw);f.flush();os.fsync(f.fileno())
        receipt={"identity":expected_identity,"wire_sha256":wire_sha,"index_sha256":sha(canonical(index).encode()),"files":index["files"]}
        durable_json(stage/"receipt.json",receipt)
        for directory,_,_ in os.walk(stage,topdown=False):sync_dir(directory)
        os.rename(stage,dest);sync_dir(self.root)
        return receipt

    def observe(self,expected_identity):
        expected_identity=identity(expected_identity);job=expected_identity["job_id"];dest=self.root/job
        if dest.is_symlink():raise ValueError("artifact_destination_link")
        if not dest.exists():return {"state":"uncertain" if (self.root/(job+".receive-intent.json")).exists() else "absent"}
        if dest.is_symlink() or not dest.is_dir():raise ValueError("artifact_destination_not_directory")
        receipt=json.loads(file_bytes(dest/"receipt.json",MAX_INDEX))
        intent=json.loads(file_bytes(self.root/(job+".receive-intent.json"),MAX_INDEX))
        if identity(receipt.get("identity"))!=expected_identity or identity(intent.get("identity"))!=expected_identity or receipt.get("wire_sha256")!=intent.get("wire_sha256"):
            raise PermissionError("artifact_custody_identity_mismatch")
        rows=receipt.get("files")
        if not isinstance(rows,list) or len(rows)>MAX_FILES:raise ValueError("bounded_receipt_rows_required")
        found=set()
        for row in rows:
            name=safe_name(row["name"])
            if name in found:raise ValueError("duplicate_receipt_file")
            found.add(name)
            path=dest/name
            for parent in path.parents:
                if parent==dest:break
                if parent.is_symlink():raise ValueError("custody_parent_link")
            raw=file_bytes(path,MAX_BYTES)
            if len(raw)!=row["bytes"] or sha(raw)!=row["sha256"]:raise ValueError("artifact_custody_changed")
        actual={str(p.relative_to(dest)) for p in dest.rglob("*") if p.is_file() or p.is_symlink()}
        if actual!=found|{"receipt.json"}:raise ValueError("unexpected_custody_file")
        index={"identity":expected_identity,"files":rows}
        if receipt.get("index_sha256")!=sha(canonical(index).encode()):raise ValueError("artifact_index_receipt_mismatch")
        return {"state":"verified",**receipt,"result":json.loads(file_bytes(dest/"result.json",MAX_INDEX))}
