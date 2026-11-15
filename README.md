# Exact Civo attempt2 storage reconciliation

PREPARED SOURCE ONLY. No installation, SSH, mount, unmount, process action,
credential change or production access has been executed by this package.
The failed test3151 is not retried and never becomes a qualification pass.

## Exact scope

Only job 8b01b1fa889647a184fbe2424263b588 generation1, InvocationID
267d6c39c47d4ec19c0a611f1271f592, kernel boot
c1626328-a278-4baf-a73e-a08803c08678, mount64, device64769,
source inode2105518, underlay inode2105519 and root parent inode2105517.
SOURCE-PINS.json freezes old execution3151/request and13 original modules.
REFERENCE-RO.json is a historical reference, NEVER fresh host authorization.

Old public code remains untouched:
/opt/peticao-dev-worker-qual-20261114-attempt2
Old private attempt:
/mnt/apps/peticao-final/.runtime/civo-worker-runtime-qual-20261114-attempt2
Single backing:
/mnt/apps/peticao-final/.runtime/civo-worker-runtime-qual-20261114-attempt2/job-backing/peticao-dev-job-8b01b1fa889647a184fbe2424263b588-g1/work
Single mount target:
/var/lib/private/peticao-dev-job-8b01b1fa889647a184fbe2424263b588-g1
Managed alias:
/var/lib/peticao-dev-job-8b01b1fa889647a184fbe2424263b588-g1
Future new helper code:
/opt/peticao-attempt2-reconcile-20261115

## Components

reconcile.py validates the combined durable stop chain and fresh host evidence.
host.py supplies the fixed root Civo port, read-only journal queries, original
pinned libraries and fixed preflight/cleanup entrypoints. No worker build,
install_schema, start, stop, export, finalization or journal result mutation.
The old ProjectStorage.cleanup is called only after the separate exact recovery
proof; the normal SystemdAdapter is NOT weakened to accept a collected unit.

Host reads actual manifest/receipt objects from original root-private SQLite
mode=ro, rehashes them and requires full bound stop_proof, pinned bundle hash,
same boot/invocation/cgroup and both runner identity receipts. Read errors fail.
The original PID must be absent; a reused PID is refused too. No signal is sent.
Execution EX and persistent same-epoch admission EX remain held during mutation.
Fresh snapshots before intent and immediately before cleanup require not-found
exact unit, no current PID/cgroup/invocation, original cgroup absent under an
actual cgroup2 mount plus validated controllers, matching manager namespace/root
views, unique rw mount with no nested/stacked mounts and exact dev/inode/underlay.
Absence alone never authorizes an action.

The new reconciliation-<reviewed-operation-id> evidence directory has an exclusive
entry intent before admission closes and a separate durable storage intent.
Existing or partial evidence cannot be reused. Old success-storage-cleanup-intent
is preserved and never consumed as authority. Normal umount only. Frozen storage
checks underlay before removing the empty target and exact managed alias; source
contents and parentroot0700 remain. No recursive chown/delete, forced/lazy umount,
wildcard action or UID-wide cleanup. Final readback must prove retained same
source/devino/root ownership/mode plus mount, target and alias absence. The new
receipt links operation, fence/event and original stop proof. A lost response or
receipt failure stays uncertain, not success and not permission to retry.

## Canonical execution gates

This packet is PREPARO, not an execution grant. After Root source review, Infra
must issue a NEW TEST notice on deploy:civo-attempt2-storage-reconciliation, with
preparation_only=false, queue_cutover=false, production_access=false,
operator_session=01a1d130-2948-7140-bcfb-34696b20ab8d and
reconciliation_operation containing exactly operation_id, execute=true,
original_execution_event=3151 and original_request_sha256 from SOURCE-PINS.json.
Apoio independently reviews and ACKs that notice. Infra acquires its OWN event-
bound TEST lease, with session recorded in private capability file; keep original
acquisition seq when renewing. Gate verifies source commit/all hashes, original
3151 pin/ACK, fresh notice/ACK, exact own session/resource/event and195s margin.
Every SSH phase rechecks the grant after constructing the request, immediately
before transport. Host operation is bounded to60s. This uses the existing ledger,
not a new coordinator/voter/approval channel.

The locally gated installer writes only4 exact root644 files in a new root755
helper directory plus exclusive /opt install intent, never chmods shared parents.
Existing approved key is consumed by SSH only, never inspected/copied. Host pin
and alias are identical to reviewed3151, strict checking and no multiplexing.
Local and remote install/cleanup intents are exclusive; preflight is read-only.
Only aggregate replies are accepted. Private SQL/logs/tokens are not printed.

After NEW reviewed execution and own lease, the fixed local entrypoint is
/usr/bin/python3 -B /mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-attempt2-reconciliation/source/client.py
with phase install, preflight or cleanup and explicit --manifest-event and
--lease-file absolute private capability path. Do not run using PREPARO notice.

## Validation and limits

Tests use synthetic pins/ports and project-local fixtures, never real host/mount
or systemd effects. Host journal read test uses actual private local SQLite RO.
No tests assert real Civo readiness. Core injection seams are local Python test
seams, never RPC or host parameters. Future cleanup receipt is recovery evidence,
not a passed old test, promotion, scheduler cutover or authorization to attempt3.
Prospective normal lifecycle remains a separate runtimeV4 IPC-reference fix.

Concurrency limit: both locks and two observations require exclusion of other
administrative writers. This is not a CAS or defense against hostile concurrent
root intervention. Root/Infra must reserve the exact reconciliation window.
