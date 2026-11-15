"""Synthetic systemd payload only; no application configuration or secrets."""
import errno
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time

PUBLIC = Path("/opt/peticao-dev-worker-qual-20261114-attempt2")
PRIVATE = Path("/mnt/apps/peticao-final/.runtime/civo-worker-runtime-qual-20261114-attempt2")
PROJECT = Path("/mnt/apps/peticao-final/.runtime")
PEER = ("100.80.18.81", 9)  # Santiago: TCP connect only, no application bytes.


def probes():
    values = {"nonroot_uid": os.getuid() != 0 and os.geteuid() != 0}
    status = dict(line.split(":", 1) for line in Path("/proc/self/status").read_text().splitlines() if ":" in line)
    values["zero_capabilities"] = int(status["CapEff"].strip(), 16) == 0
    values["no_new_privileges"] = status["NoNewPrivs"].strip() == "1"
    for name in ("home", "root"):
        try:
            values[name + "_masked"] = not any(Path("/" + name).iterdir())
        except PermissionError:
            values[name + "_masked"] = True
    try:
        fd = os.open(PRIVATE / "private-marker", os.O_RDONLY | os.O_NOFOLLOW)
    except PermissionError:
        values["private_marker_unreadable"] = True
    else:
        os.close(fd)
        values["private_marker_unreadable"] = False
    try:
        fd = os.open(PUBLIC / "readonly-marker", os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW)
    except (PermissionError, OSError) as exc:
        if isinstance(exc, OSError) and exc.errno not in {errno.EACCES, errno.EPERM, errno.EROFS}:
            raise
        values["public_marker_readonly"] = True
    else:
        os.close(fd)
        values["public_marker_readonly"] = False
    values["docker_socket_inaccessible"] = not any(os.access(p, os.R_OK) or os.access(p, os.W_OK) for p in ("/run/docker.sock", "/var/run/docker.sock"))
    # Inspect names only; never load a real credential value from the environment.
    values["system_tmp_inaccessible"] = not any(os.access("/tmp", flag) for flag in (os.R_OK, os.W_OK, os.X_OK))
    values["system_var_tmp_inaccessible"] = not any(os.access("/var/tmp", flag) for flag in (os.R_OK, os.W_OK, os.X_OK))
    values["direct_runtime_access_denied"] = not any(os.access(PROJECT, flag) for flag in (os.R_OK, os.W_OK, os.X_OK))
    values["environment_allowlisted"] = set(os.environ) <= {"PATH", "HOME", "TMPDIR", "LC_CTYPE"}
    with socket.socket() as server:
        server.settimeout(1)
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        with socket.create_connection(server.getsockname(), timeout=1):
            peer, _ = server.accept()
            peer.close()
        values["private_loopback_works"] = True
    with socket.socket() as outside:
        outside.settimeout(0.5)
        try:
            outside.connect(PEER)
        except OSError as exc:
            # A connection refusal/timeout alone is NOT proof of isolation.
            values["tailnet_no_route"] = exc.errno in {errno.ENETUNREACH, errno.EHOSTUNREACH, errno.EACCES, errno.EPERM}
        else:
            values["tailnet_no_route"] = False
    return values


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in {"fixture-pass", "fixture-fail"}:
        raise ValueError("fixed_fixture_profile_required")
    profile = sys.argv[1]
    Path("tmp").mkdir(mode=0o700)
    Path("artifacts").mkdir(mode=0o700)
    values = probes()
    cwd = Path(".").stat()
    Path("artifacts/isolation.json").write_text(json.dumps({"protocol": 1, "checks": values, "filesystem": {"cwd_device": cwd.st_dev, "cwd_inode": cwd.st_ino, "direct_runtime_access_denied": values["direct_runtime_access_denied"]}}))
    Path("output.log").write_text("synthetic namespace qualification; no credential values\n")
    if profile == "fixture-fail":
        child = subprocess.Popen([sys.executable, "-I", "-B", "-c", "import time; time.sleep(14)"],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 env={"PATH": "/usr/bin:/bin"}, close_fds=True)
        Path("artifacts/child-started.json").write_text('{"child_started":true}')
        time.sleep(12)  # Root can prove a running cancellation before normal exit7.
        child.wait(timeout=4)
    code = (0 if profile == "fixture-pass" else 7) if all(values.values()) else 93
    Path("artifacts/fixture.txt").write_text("isolated synthetic systemd qualification\n")
    Path("result.json").write_text(json.dumps({"protocol": 1, "profile": profile, "exit_code": code}))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
