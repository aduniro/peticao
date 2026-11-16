"""Local Git bundle transport. No SSH, push, shell, worktree copying or deployment.

Execution is opt-in, requires a live physical-host READY proof and disabled-by-default
configuration. The caller validates the READY record through the coordinator queue.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Mapping
import fnmatch
import hashlib
import json
import math
import os
import re
import subprocess
import tempfile
import time
import uuid

GIT = "/usr/bin/git"
SHA = re.compile(r"[0-9a-f]{40}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
SAFE_CONFIG = re.compile(r"(?:core\.(?:repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode)|extensions\.objectformat|user\.(?:name|email)|remote\.[a-z0-9_-]+\.(?:url|fetch)|branch\.[a-zA-Z0-9._/-]+\.(?:remote|merge))\Z")
FORBIDDEN_SEGMENTS = {"node_modules", ".next", ".cache", "__pycache__", ".venv", "venv", "secrets", "preview-state", "_externos", "coverage"}


class TransportError(ValueError):
    pass


def file_sha256(path: Path) -> str:
    value=hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b""): value.update(chunk)
    return value.hexdigest()

def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def machine_id_sha256() -> str:
    """Do not expose the machine-id itself in reports."""
    return hashlib.sha256(Path("/etc/machine-id").read_bytes().strip()).hexdigest()


def commit_id(value: str) -> str:
    if not isinstance(value, str) or not SHA.fullmatch(value):
        raise TransportError("invalid_commit")
    return value


def branch_ref(value: str, *, integration_only: bool = False) -> str:
    from protocol import validate_branch, ValidationError
    try:
        validate_branch(value,integration_only)
    except ValidationError as error:
        raise TransportError(str(error)) from None
    return "refs/heads/" + value


@dataclass(frozen=True)
class ReadyProof:
    worker_id: str
    repository_root: str
    machine_id_sha256: str
    expires_at: float
    digest: str
    config_sha256: str


@dataclass(frozen=True)
class RepositoryPolicy:
    host_id: str
    role: str
    root: Path
    enabled: bool = False
    machine_sha256: str | None = None
    protected_paths: tuple[str, ...] = ()
    config_sha256: str | None = None

    @classmethod
    def from_config(cls, config: Mapping[str, Any], host_id: str) -> "RepositoryPolicy":
        from protocol import validate_config
        config = validate_config(dict(config))
        host = config["hosts"][host_id]
        root = host.get("repository_root")
        if not isinstance(root, str) or not Path(root).is_absolute():
            raise TransportError("repository_root_required")
        return cls(host_id, host["role"], Path(root).resolve(), config.get("execution_enabled") is True and host.get("enabled") is True, host.get("machine_id_sha256"), tuple(config.get("protected_paths", ())), digest(config))

    def repository(self, raw: str | Path) -> Path:
        path = Path(raw)
        if not path.is_absolute() or any(ord(ch) < 32 for ch in str(path)):
            raise TransportError("absolute_repository_required")
        path = path.resolve(strict=True)
        if path == self.root or not path.is_relative_to(self.root):
            raise TransportError("repository_outside_root")
        for protected in self.protected_paths:
            if protected.startswith("/") and (path == Path(protected).resolve() or path.is_relative_to(Path(protected).resolve())):
                raise TransportError("protected_repository")
        if self.role == "production_read_only":
            raise TransportError("production_repository_forbidden")
        return path

    def permit(self, ready: ReadyProof | None) -> None:
        if not self.enabled or ready is None or self.role not in {"integrator", "coordinator", "worker"}:
            raise TransportError("execution_disabled_or_not_ready")
        if ready.worker_id != self.host_id or Path(ready.repository_root).resolve() != self.root or type(ready.expires_at) not in {int,float} or not math.isfinite(ready.expires_at) or ready.expires_at <= time.time() or not SHA256.fullmatch(ready.digest):
            raise TransportError("ready_context_mismatch")
        if not self.config_sha256 or ready.config_sha256 != self.config_sha256:
            raise TransportError("ready_configuration_mismatch")
        if not self.machine_sha256 or self.machine_sha256 != ready.machine_id_sha256 or ready.machine_id_sha256 != machine_id_sha256():
            raise TransportError("physical_machine_mismatch")


def ready_proof(record: dict[str, Any], config: dict[str, Any]) -> ReadyProof:
    """Validate the coordinator-recorded Santiago handshake before using its metadata."""
    from protocol import validate_config, validate_ready
    config = validate_config(config)
    checked = validate_ready(record,config,time.time())
    return ReadyProof(checked["worker_id"],checked["repository_root"],checked["machine_id_sha256"],checked["expires_at"],digest(checked),checked["config_sha256"])

def git(repo: Path, *args: str, timeout: int = 60) -> bytes:
    """All callers provide fixed subcommands/argv; there is deliberately no shell API."""
    env = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_TERMINAL_PROMPT": "0", "GIT_ALLOW_PROTOCOL": "file", "GIT_OPTIONAL_LOCKS": "0", "GIT_AUTHOR_NAME": "Admin-v2 isolated integrator", "GIT_AUTHOR_EMAIL": "integrator@example.test", "GIT_COMMITTER_NAME": "Admin-v2 isolated integrator", "GIT_COMMITTER_EMAIL": "integrator@example.test"}
    command = [GIT, "--no-pager", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-c", "core.attributesFile=/dev/null", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "rerere.enabled=false", "-c", "rerere.autoupdate=false", "-c", "protocol.file.allow=always", "-c", "protocol.ext.allow=never", "-c", "fetch.recurseSubmodules=false", "-c", "submodule.recurse=false", "-C", str(repo), *args]
    result = subprocess.run(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)
    if result.returncode:
        # Never echo URLs, credential-bearing config, file contents or arbitrary stderr.
        raise TransportError(f"git_{args[0]}_failed:{result.returncode}")
    if len(result.stdout) > 64 * 1024 * 1024:
        raise TransportError("git_output_budget_exceeded")
    return result.stdout


def inspect_repository(policy: RepositoryPolicy, raw: str | Path) -> Path:
    repo = policy.repository(raw)
    config = git(repo, "config", "--local", "--no-includes", "--null", "--list")
    for entry in config.split(b"\0"):
        if not entry:
            continue
        key = entry.split(b"\n", 1)[0].decode("utf-8", "strict")
        if not SAFE_CONFIG.fullmatch(key):
            raise TransportError("unsafe_local_git_config")
    actual_git = Path(git(repo, "rev-parse", "--absolute-git-dir").decode().strip()).resolve()
    if not actual_git.is_relative_to(policy.root):
        raise TransportError("git_directory_outside_root")
    common=Path(git(repo,"rev-parse","--git-common-dir").decode().strip())
    if not common.is_absolute(): common=repo/common
    common=common.resolve()
    if not common.is_relative_to(policy.root) or (common/"objects").is_symlink():
        raise TransportError("shared_object_directory_forbidden")
    if (common / "objects/info/alternates").exists() or (common / "info/attributes").exists():
        raise TransportError("shared_objects_or_local_attributes_forbidden")
    if any(p.is_file() and p.stat().st_nlink>1 for p in (common / "objects").rglob("*")):
        raise TransportError("independent_objects_required")
    if git(repo, "rev-parse", "--is-bare-repository").strip() != b"false":
        raise TransportError("independent_working_clone_required")
    if Path(git(repo, "rev-parse", "--show-toplevel").decode().strip()).resolve() != repo:
        raise TransportError("repository_redirected")
    if git(repo, "status", "--porcelain=v1", "-z", "--untracked-files=all"):
        raise TransportError("dirty_repository")
    return repo


def forbidden(path: str, policy: RepositoryPolicy) -> bool:
    p = PurePosixPath(path)
    if p.is_absolute() or ".." in p.parts or any(ord(c) < 32 for c in path):
        return True
    if any(part.lower() in FORBIDDEN_SEGMENTS for part in p.parts):
        return True
    name = p.name.lower()
    if name.startswith(".env") and not name.endswith((".example", ".sample")):
        return True
    if name in {"id_rsa", "id_ed25519"} or name.endswith((".pfx", ".p12", ".key", ".sqlite", ".sqlite3", ".db", ".dump")):
        return True
    if path.startswith(("site/data/", "data/", "dist/", "build/")):
        return True
    return any(not pattern.startswith("/") and (fnmatch.fnmatchcase(path, pattern) or path == pattern.rstrip("/") or path.startswith(pattern.rstrip("/") + "/")) for pattern in policy.protected_paths)


def tree_manifest(repo: Path, commit: str, policy: RepositoryPolicy) -> dict[str, dict[str, str]]:
    commit_id(commit)
    manifest: dict[str, dict[str, str]] = {}
    for entry in git(repo, "ls-tree", "-r", "-z", "--full-tree", commit).split(b"\0"):
        if not entry:
            continue
        metadata, encoded_path = entry.split(b"\t", 1)
        mode, kind, oid = metadata.decode().split()
        path = encoded_path.decode("utf-8", "strict")
        if forbidden(path, policy) or kind != "blob" or mode not in {"100644", "100755", "120000"}:
            raise TransportError("forbidden_tracked_path_or_submodule")
        content = git(repo, "cat-file", "blob", oid)
        if mode == "120000":
            link = content.decode("utf-8", "strict")
            parts = list(PurePosixPath(path).parent.parts)
            if PurePosixPath(link).is_absolute():
                raise TransportError("unsafe_symlink")
            for part in PurePosixPath(link).parts:
                if part == "..":
                    if not parts:
                        raise TransportError("escaping_symlink")
                    parts.pop()
                elif part != ".":
                    parts.append(part)
            if forbidden("/".join(parts), policy):
                raise TransportError("protected_symlink_target")
        if PurePosixPath(path).name == ".gitattributes":
            if re.search(rb"(?:^|\s)(?:filter|merge|diff)=", content):
                raise TransportError("external_git_attribute_driver")
        manifest[path] = {"mode": mode, "sha256": hashlib.sha256(content).hexdigest()}
    return manifest


def inspect_history(repo: Path, base: str, candidate: str, policy: RepositoryPolicy) -> dict[str, Any]:
    commit_id(base); commit_id(candidate)
    git(repo, "merge-base", "--is-ancestor", base, candidate)
    commits = git(repo, "rev-list", "--reverse", f"{base}..{candidate}").decode().splitlines()
    for revision in commits:
        tree_manifest(repo, revision, policy)
    manifest = tree_manifest(repo, candidate, policy)
    return {"base": base, "commit": candidate, "commits": commits, "source_manifest_sha256": digest(manifest), "tracked_files": len(manifest)}


def private_directory(policy: RepositoryPolicy, name: str) -> Path:
    if name not in {".bundles", ".quarantine", ".integration-reports", ".integration-worktrees"}:
        raise TransportError("unknown_private_directory")
    path=policy.root/name
    if path.exists() and not path.resolve().is_relative_to(policy.root):
        raise TransportError("private_directory_escape")
    path.mkdir(mode=0o700,exist_ok=True)
    if not path.resolve().is_relative_to(policy.root):
        raise TransportError("private_directory_escape")
    return path.resolve()

def export_bundle(policy: RepositoryPolicy, repository: str | Path, base: str, candidate: str, *, source_ref: str | None = None, execute: bool = False, ready: ReadyProof | None = None) -> dict[str, Any]:
    repo = inspect_repository(policy, repository)
    report = inspect_history(repo, base, candidate, policy)
    report.update({"dry_run": not execute, "operation": "export_bundle", "source_refs_written": False, "source_worktree_copied": False})
    if base == candidate:
        report["noop"] = True
        return report
    if source_ref is None:
        refs=git(repo,"for-each-ref","--format=%(refname)","--points-at",candidate,"refs/heads/worker/admin-v2-*","refs/heads/review/admin-v2-*","refs/heads/integration/admin-v2-*").decode().splitlines()
        if not refs: raise TransportError("frozen_source_branch_required")
        source_ref=sorted(refs)[0].removeprefix("refs/heads/")
    full_ref=branch_ref(source_ref)
    if git(repo,"rev-parse",full_ref).decode().strip()!=candidate: raise TransportError("source_ref_changed")
    report["source_ref"]=source_ref
    if not execute: return report
    policy.permit(ready)
    directory=private_directory(policy,".bundles")
    bundle=directory/f"{uuid.uuid4()}.bundle"
    git(repo, "bundle", "create", str(bundle), full_ref, "^" + base, timeout=180)
    heads=git(repo,"bundle","list-heads",str(bundle)).decode().splitlines()
    if heads != [candidate+" "+full_ref] or git(repo,"rev-parse",full_ref).decode().strip()!=candidate:
        bundle.unlink(missing_ok=True)
        raise TransportError("source_ref_changed")
    inspect_repository(policy,repo)
    report["source_ref"]=source_ref
    os.chmod(bundle, 0o600)
    report.update({"bundle": str(bundle), "bundle_sha256": file_sha256(bundle)})
    return report


def import_bundle(policy: RepositoryPolicy, repository: str | Path, bundle: str | Path, bundle_sha256: str, base: str, candidate: str, destination_ref: str, *, expected_old: str | None = None, execute: bool = False, ready: ReadyProof | None = None) -> dict[str, Any]:
    repo = inspect_repository(policy, repository)
    commit_id(base); commit_id(candidate)
    ref = branch_ref(destination_ref)
    if not destination_ref.startswith("worker/admin-v2-"):
        raise TransportError("transport_only_advances_worker_staging_refs")
    path = Path(bundle).resolve(strict=True)
    if not path.is_relative_to(policy.root / ".bundles") or not SHA256.fullmatch(bundle_sha256) or file_sha256(path) != bundle_sha256:
        raise TransportError("bundle_hash_or_path_mismatch")
    heads = git(repo, "bundle", "list-heads", str(path)).decode().splitlines()
    if len(heads) != 1 or len(heads[0].split())!=2 or heads[0].split()[0] != candidate:
        raise TransportError("unexpected_bundle_heads")
    branch_ref(heads[0].split()[1].removeprefix("refs/heads/"))
    git(repo, "bundle", "verify", str(path))
    if expected_old is not None:
        commit_id(expected_old)
    if ("branch "+ref) in git(repo,"worktree","list","--porcelain").decode().splitlines():
        raise TransportError("staging_ref_checked_out")
    current=[line.split("\0",1)[1] for line in git(repo,"for-each-ref","--format=%(refname)%00%(objectname)",ref).decode().splitlines() if line.split("\0",1)[0]==ref]
    if current != ([] if expected_old is None else [expected_old]):
        raise TransportError("staging_ref_cas_conflict")
    report = {"dry_run": not execute, "operation": "import_bundle", "base": base, "commit": candidate, "destination_ref": destination_ref, "bundle_sha256": bundle_sha256}
    if not execute:
        return report
    policy.permit(ready)
    # Quarantine independent objects before touching the destination object database.
    staging = private_directory(policy,".quarantine")
    with tempfile.TemporaryDirectory(dir=staging) as temp:
        quarantine = Path(temp) / "repo.git"
        git(repo, "clone", "--bare", "--no-local", "--no-hardlinks", str(repo), str(quarantine), timeout=180)
        git(quarantine, "fetch", "--no-tags", "--no-write-fetch-head", str(path), candidate, timeout=180)
        git(quarantine, "update-ref", "refs/heads/worker/admin-v2-quarantine", candidate)
        details = inspect_history(quarantine, base, candidate, policy)
        if git(quarantine, "fsck", "--no-reflogs", "--unreachable", "--no-progress").strip():
            raise TransportError("unreachable_bundle_objects")
        sanitized = Path(temp) / "validated.bundle"
        git(quarantine, "bundle", "create", str(sanitized), "refs/heads/worker/admin-v2-quarantine", "^" + base, timeout=180)
        git(repo, "fetch", "--no-tags", "--no-write-fetch-head", str(sanitized), candidate, timeout=180)
        if ("branch "+ref) in git(repo,"worktree","list","--porcelain").decode().splitlines():
            raise TransportError("staging_ref_checked_out")
        policy.permit(ready)
        git(repo, "update-ref", ref, candidate, expected_old or "0" * 40)
        report.update(details)
    return report
