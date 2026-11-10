# Coordinator core — interface

Source: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/core/coordinator.py`.
Deploy target (infrastructure operator): `/opt/admin-v2-cluster/coordinator.py`.

Python 3 standard library only. Commands: `/usr/bin/python3 /opt/admin-v2-cluster/coordinator.py rpc`, `daemon`, or `run JOBID`. RPC consumes one JSON object on stdin, returns `{ "ok": true, "result": ... }`; errors return `{ "ok": false, "error": "Type", "detail": "..." }`, exit 1.

Runtime defaults: `ADMIN_CLUSTER_ROOT=/srv/admin-v2-coordinator`; `ADMIN_WORKER_ROOT=/srv/admin-v2-worker`. `ADMIN_CLUSTER_BOOT` is a test override; production reads `/proc/sys/kernel/random/boot_id`. `ADMIN_CLUSTER_DISPATCH=0` disables execution and creation of worker directories on the São Paulo reserve. `ADMIN_CLUSTER_TEST_INLINE=1` is only for local tests; never install it in service units or SSH gateways.

Authority: `/srv/admin-v2-coordinator/authority.json` must be operator-owned and read-only to coordinator/worker: `{ "role": "primary", "generation": 1, "armed_boot_id": "CURRENT_BOOT_UUID" }`. Other roles: standby, suspended. A boot mismatch makes primary effectively suspended; no automatic promotion/rearming. Standby status/jobs queries do not reconcile or update jobs. Heartbeats are observation files only.

RPC actions:

- `health`: effective authority, current boot, absolute runtime paths.
- `submit`: `{ "action":"submit", "id":"32_lowercase_uuid_hex", "kind":"fixture-pass", "duration_seconds":0.2 }`. Fixed kinds: fixture-pass, fixture-fail, build, typecheck, test. Duration fixtures only, 0–30 seconds. Real jobs require `source_commit` (40 lowercase hex) and optional `project_subdir` (default site). Both package.json and package-lock.json must exist. Same ID with same normalized payload returns existing job; differing payload is rejected.
- `import-source`: commit, sha256 and archive_base64. Maximum compressed archive 64 MiB, expanded source 500 MiB/50,000 entries. Rejects absolute paths, traversal, symlinks, hardlinks, devices/FIFOs, .git, node_modules, .next, secrets, preview-state, pgdata and .env files except examples. The commit identifier is provided by the trusted submitting client; the digest proves archive integrity, not independent Git ancestry. Client must generate the archive from the explicit reviewed commit.
- `status`: id. Reconciles only on primary, returns metadata and result if present.
- `jobs`: optional limit (1–200), after_seq; returns jobs and up to 500 ordered events.
- `logs`: id, optional byte offset; returns up to 32 KiB redacted output plus next offset.
- `cancel`: id; queued jobs become canceled; active jobs use root launcher --cancel.
- `snapshot`: consistent SQLite online backup plus authority in a generated controlled snapshots directory; returns absolute path and database SHA-256. Full checkpoint replication/recovery is handled by recovery.py.

SQLite: `/srv/admin-v2-coordinator/queue.sqlite`, tables jobs/events. Jobs fields: id,payload,digest,state,generation,created_at,updated_at,started_at,finished_at,exit_code,error. Events fields: seq,at,job_id,kind,data. States: queued,starting,running,completed,failed,interrupted,canceled. Only one starting/running job is allowed at a time. A launch with uncertain response is never automatically repeated. Queued jobs from older authority generations become interrupted and require explicit review/new-ID resubmission.

Worker directory: `/srv/admin-v2-worker/jobs/JOBID/`, mode 2770. `config.json` mode0660 includes id,payload,digest,generation. `execution.started` is an exclusive persistent replay guard. `state.json` includes id,state,started_at,boot_id,pid,start_ticks,generation,exit_code and final finished_at/error. `result.json` additionally contains source_commit,digest,phases,artifacts. `output.log` is bounded to10MiB of command output with common credential redaction. Artifact manifest hashes regular files only under work/artifacts, maximum500MiB. Files remain local; no arbitrary file retrieval RPC.

The privileged launcher is external: `/usr/bin/sudo -n /usr/local/libexec/admin-v2-launch JOBID` or `--cancel JOBID`. It must validate arguments, restrict systemd unit naming, execute worker as vigia-worker with group admin-v2-exec, use KillMode=control-group and enforce CPUQuota=300%, MemoryMax=5GiB, UMask=0007. Cancellation escalation is the launcher's/systemd's responsibility. The core itself never needs a general sudo rule.

Every real job copies immutable imported sources into its own work directory, then executes fixed argv: npm ci followed by npm run build/typecheck or npm test. No shell interpolation. Environment is rebuilt from a small allowlist; no database URLs, SMTP credentials or production environment are inherited. App-specific disposable test database setup and approved integration fixtures are a separate handoff; currently real jobs may fail until those are supplied. The worker account's authorized administrative privileges mean source execution is trusted code, not a hostile multi-tenant sandbox.

Local verification (no SSH, application or real DB required):

`/usr/bin/python3 -m unittest discover -s /mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/tests -p 'core*.py' -v`
