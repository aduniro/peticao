"""Private bounded local-log access shared by both candidate RPC paths."""
import os
from pathlib import Path
import stat

import log_redaction


def read_log(worker_root, job, offset):
    empty = {"id": job, "offset": offset, "output": "", "available": False}
    path = Path(worker_root).absolute() / "jobs" / job / "output.log"
    # Walk with dirfds and O_NOFOLLOW; do not follow replaced parent links.
    directory = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:-1]:
            following = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = following
            info = os.fstat(directory)
            if info.st_uid not in {0, os.geteuid()} or info.st_mode & 0o002:
                raise PermissionError("trusted_log_parent_required")
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid not in {0, os.geteuid()} or info.st_nlink != 1 or info.st_mode & 0o007:
                raise PermissionError("private_regular_log_required")
            if info.st_size > log_redaction.MAX_LOG:
                raise ValueError("bounded_whole_log_required")
            content = os.pread(fd, log_redaction.MAX_LOG + 1, 0)
        finally:
            os.close(fd)
    except FileNotFoundError:
        return empty
    finally:
        os.close(directory)
    answer = log_redaction.slice_log(content, offset)
    return {"id": job, **answer, "available": True}
