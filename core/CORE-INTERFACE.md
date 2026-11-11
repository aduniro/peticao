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


## Proposed fixed runtime profile — PRIVATE DRAFT, NOT INSTALLED

Patch draft: /mnt/apps/peticao-final/_ops/r0000-cluster-runtime-profile-20261110. Baseline coordinator SHA2563675926e81e1b6160b9548ad15c9d18b8fcc65ccec208cf6329f8ada3fb55f92 matches observed installed Santiago core. This proposal changes only core/coordinator.py, adds core/runtime_profile.py and makes a fixed-kind timeout change in infra/launch.py. gateway.py is unchanged. Root must independently verify the installed launcher pin before any future installation.

New submit contract, and only this contract:
`{"action":"submit","id":"32_lowercase_uuid_hex","kind":"runtime-http-r0000-v1","source_commit":"0a5f734da4f9b8a35a10a20eaa9fb4fd5adb0e4f"}`.
No command, shell, URL, path, environment, free timeout, project_subdir, duration_seconds, archive or base64 is accepted for this kind. The same jobID/payload uses existing queue idempotency; existing generation/one-heavy-job/launcher/cancel/log/artifact/recovery behavior is retained. No parallel queue, listener, RPC action or executor service is added.

This profile is a reviewed runtime artifact derived from an identified commit, NOT a Git checkout and NOT import-source. No source archive/manifest is fabricated under sources/COMMIT; no 475MB upload through the 64MiB source RPC. The operator must stage the separately reviewed artifact transport before submission, with peer ACK/lease. No transfer/install is performed by this patch.

Fixed destination /srv/admin-v2-worker/admin-r0000-runtime-qa-20261110, private executor-owned root/inputs/runs mode0700, regular files only. Files staged there: five reviewed harness scripts plus harness-manifest.json; inputs/runtime.tar SHA4338322c4f9dee2c30c28c5359b2f537312543cb3cfe7fde20a3db69d747df84; inputs/release-manifest.json SHA12b7d8a8e617c98c7d4f22b9e0865b8e3cde63e8d8933b871f65cceb68f72576. Harness manifest pinbb66b05d4d3d48a1ca6af08bb6c32376282e4db62516b315574216a081e2bc90. Fixed /usr/bin/node SHAca0728526aa1cc4e3056decec848ecc6d2c5391cecdd4e21a0ebd221d665c84e (20.19.2/x64/ABI115/NAPI9). Pins are code constants, never RPC-supplied values. Admission validates ONLY the exact RPC contract and normalizes expected code-constant identities; it neither reads worker-private0700 staging nor attests staged bytes. Coordinator and worker may have different UIDs. The executing worker verifies small-file/Node/manifest pins, archive type/size and full archive SHA before invoking any harness command. Missing/inaccessible/tampered staging is a terminal failed job, not a claim of readiness or reason to widen permissions. Safe extraction validates full external/internal manifests,12,043 names/types/bytes/hashes before runtime creation, then full extracted inventory; smoke repeats inventory before starting Next. Hash validity does not independently establish Git ancestry; reviewed release provenance supplies commit attribution.

The internal fixed profile runs safe_extract.py → probe.py (11 intended denials) → smoke.py (5 exact GETs), one heavy job total. Each run uses runs/JOBID-http and runs/JOBID-guard and never overlays/replays prior directories. An exclusive per-job profile marker preserves receipts even if the internal CLI is called twice. Launcher CPU300%/Memory5GiB/KillModecontrol-group/TimeoutStop15 remain; this kind alone uses RuntimeMaxSec120. Profile alarm at105s reserves up to13s child SIGTERM/drain/escalation and receipts within that outer budget. No timeout is caller-configurable. If hashing/extraction/guard/readiness cannot fit, mark failed or reconcile interrupted; do NOT retry or silently increase budget. Remote measured timing is not yet available. No claim that 120s is already sufficient on Santiago.

Artifacts remain in the existing worker work/artifacts export: only allowlisted extraction/result/pid/guard/server/probe technical receipts,32MiB total/16MiB per file. Runtime, dependencies, secrets and arbitrary paths are not exported. A passed profile is SANTIAGO_HTTP_SMOKE_NO_DATABASE_NOT_DEPLOY_QUALIFIED with operationalReady=false; it never starts DB, builds, npm-installs, sends mail, invokes real verifier, deploys, publishes Tailnet or proves browser/signature readiness.

Tests of this draft use synthetic pins/manifests, temporary SQLite queue and harmless fixture child processes only. They do not execute application code, invoke SSH/systemd, or install the proposal. Live target resource/port checks, peer ACK and installation/transfer lease remain prerequisites.


## Proposed history-native-pg17-r0002-v1 — PRIVATE, NOT INSTALLED

Draft /mnt/apps/peticao-final/_ops/r0000-cluster-history-native-pg17-r4-20261110/r0002. Preserves installed480profile and genericqueue behavior. The only new contract is submit with action,id32hex,kindhistory-native-pg17-r0002-v1,source_commitf55595cd348c23ffe559dba2de9150259db9f1e7. Admission performs NO private-stage I/O. Expected payload pins are codeconstants, not caller-supplied. No genericRPC/upload/shell/environment/timeout is added.

New installed module proposed:/opt/admin-v2-cluster/history_native_profile.py; coordinator dispatch recognizes this fixedkind; launcher selects CPU200%,Memory3G,swap0,Tasks256,RuntimeMaxSec600,TimeoutStopSec120 (720s total). Existing480andgenericlimits remain unchanged. Source manifest and app/runtime must all beR0002f555; oldR4ca53is ancestry only, not qualification.

Runtime475576320bytes/SHA2952a2... and manifest7b853d... go to /srv/admin-v2-worker/admin-r0002-runtime-qa-20261111/inputs outside import-source64MiB. Selected adapted harness files and schema7 have their own immutable manifest. Full archive/inventory/schema/tool verification occurs in the oneheavyjob beforePG. Full details/pins/proof limits in README.md of this draft. Tokens and local coordinatorSQLite are never transported; existing authority/config/boot/generation/marker/cgroup are verified read-only.

One wrapper starts one fixed Python entrypoint. Only own nativePG55485 and app31385 are allowed; noDocker/npm/build/provider/realDB. Required19checks+guard+cleanup+schema/runtime/PDFproofs precede completion. Technical allowlist exports group-readableartifacts; PGDATA/password/runtime/lease excluded. Missing/uncertain evidence remainsfailed/interrupted, neverautomaticreplay. Operatorroot still controls installation,stage,submission and post-jobcgroup/ports; this patch does none.
