# Worker runtime V4 candidate — source only

**NOT DEPLOYABLE. No host installation, sudoers, SSH, actual systemd unit,
canonical queue or cloud resource was changed by this preparation.** The target
remains Civo central with Akamai support; Santiago is still the live primary.
Azure control authentication remains blocked. Codex stays on the Dell.

This packet joins the worker contract3046 to actual systemd command construction,
fixed RPC, artifact custody and terminal queue state. It also tests the public
facade3080 against the new backend. It is more than a schema/model, but its tests
use real local fixture subprocesses and **synthetic** unit/cgroup identities.
An actual isolated Civo qualification is being prepared separately by Apoio.
Parent notice3089/27bff is HELD and cannot be executed: its cgroup observer could
return empty for an existing incomplete/unwalkable tree, and its entries imported
runtime modules before final pin checks. Parent source/review evidence are retained.

V2 makes cgroup v2 controller/procs/events reads mandatory, propagates traversal
and read failures, refuses incomplete/linked trees, checks populated before/after
and accepts absence only under a validated v2 mount. A compiled-in hash first
validates the stdlib-only entry_bootstrap.py; that bootstrap validates root-owned
current-boot metadata and ALL16 code files before any runtime module import.
The entry shims, OS/stdlib and root operator remain the trusted computing base.
This is not protection from hostile root or an installer that violates its manifest.

## Implemented flow

1. Facade3080 admits a fixed-profile job into the existing jobs/events database.
   Claims reserve and move queued→starting atomically. Backend.dispatch requires
   a per-job secret already persisted in a private envelope by its caller. There
   is no automatic secret recreation or public dispatch/completion endpoint.
2. Worker prepare receives only the secret hash, binds profile/input digests,
   host/boot/epoch and a deterministic admin-dev-<job>-gN.service receipt. Start
   commits start_intent before calling the trusted adapter. Lost response means
   observe the SAME ID; duplicate dispatch/start is never reissued automatically.
3. The systemd adapter specifies DynamicUser, private network/home/tmp/devices,
   no capabilities, strict filesystem protection, own persistent StateDirectory,
   fixed interpreter/program hashes, CPU/memory/process/time limits and no
   Docker/Tailscale/authority/journal access. No command/argv/env/path is accepted
   from an RPC request. This version admits only fixture-pass/fail profiles.
4. Observation binds the actual InvocationID and own cgroup. Stop rechecks that
   identity and never accepts another unit/PID. A normal finish requires known
   exit status, MainPID0 and empty cgroup. Cancellation may have unknown exit
   status only after the own unit/cgroup are proven stopped; it cannot become
   successful work. Durable first-stop intent wins a late cancellation; the
   final event records that cancellation arrived after finalization began.
5. Root-owned standardized result plus bounded regular-file artifacts are packed
   with an exact identity/index/hash. Receive persists an exclusive intent before
   extraction, rejects links/devices/traversal/duplicates/changed content and
   publishes a private directory atomically. A lost publication response requires
   observe; an incomplete intent is uncertain, never overwritten/rebuilt silently.
6. Only after verifying custody and stopped-unit result does Finalizer update the
   SAME queue row/events to completed/failed/canceled. No second scheduling DB is
   introduced: the worker SQLite is a receipt journal. Original legacy rows and
   their event sequence remain intact. No result body can be submitted publicly.

## Identity and privilege separation

Claims/Backend retain the existing queue owner vigia-coord. That account must
not receive root private keys or own the worker/root journal. PrivilegedTransport
invokes only a fixed sudo helper plus an enumerated node ID, with bounded JSON
on stdin. The proposed root helper uses the existing root mesh key and pinned
host records for remote nodes; Civo local worker calls stay inside the root
helper. No sudoers/helper was installed by this packet. Its own installer,
permissions, role, actual key bindings and interrupted-helper behavior require
separate qualification before activation.

SSH is fixed to the known tailnet endpoints, strict host checking, key-only,
no multiplexing and one fixed Python RPC entry. Timeouts terminate only the
local transport process, leave the remote job uncertain and never retry. Root
entry requires actual current-boot qualification and complete code/profile hashes
under root-controlled files. No /etc runtime configuration is created here;
missing/incomplete qualification fails closed. Hostile root is not in the threat
model: this is a constrained service interface, not protection from its operator.

## Admission and fencing

Every worker mutating RPC holds SH admission.lock for its complete execution and
an exclusive per-job mutex. Operator-only closed_for_fencing requires EX, drains
in-flight mutations and atomically persists admission.json enabled=false bound
to the epoch hash. It remains closed on exit/errors. Observer/log/bundle reads
do not launch jobs. Fencing must do this on ALL possible workers BEFORE stopping
units or changing the epoch; no local file lock provides distributed consensus.
All admin-dev-<32hex>-gN.service AND legacy admin-v2-job executors must be covered.
The old fencing script alone is insufficient. None of these barriers is installed.

## Catalog and logs

NodeCatalog v2 implements facade3080's select(kind,worker) interface with separate
profiles per node: Civo/Akamai/Azure may have different interpreter paths/hashes.
Only the selected immutable qualification entry is included in catalog_sha256;
registering an unrelated node cannot invalidate an already queued Civo job.
False-by-default templates admit nothing. No GPU, new cloud instance or financial
controller is added. Availability/wake/idle/resource/concurrency policy remains
part of the canonical scheduler qualification, not this receipt journal.

The common log_redaction.py masks known credential byte spans across a complete
private log of at most10MiB BEFORE slicing a max32KiB reply. It preserves raw byte
offsets and protects a token whose prefix is before the requested chunk. Regex
restart on long identifier lines is bounded with a negative lookbehind. This is
pattern masking, NOT a guarantee that arbitrary text contains no secrets. Actual
profile namespaces, source selection and log access still need qualification;
no live log contents belong in reports/tool context.

## SQLite and custody changes

Upstream3046 remains in upstream/. Read transactions now use mode=ro/query_only,
write transactions remain explicit mode=rw/synchronous FULL. No immutable=1 on a
live DB. A real crashed-process hot-journal fixture verifies reads refuse required
recovery without modifying main/journal bytes. This does not promise zero physical
SHM/locking effects in every WAL state. Canceled is terminal for idempotent result
delivery. The exact facade3080 and shared log module are pinned/copied unchanged.

## V2 regression evidence

New tests reproduce existing-cgroup/no-procs, no-events, denied-read, walk error,
empty traversal, populated child, malformed PID/events, symlink and changing
population cases. None can become an empty-process proof. Pin-order tests verify
compiled bootstrap hashes, absence of top-level runtime imports, complete closure,
current boot and rejection before runtime loading. Only local fixtures are used;
real Civo qualification remains blocked until this V2 has independent review.

## Validation and remaining scope

Run `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -v` in this directory. Tests
cover real local child exit0/7, same-ID lost replies/restarts, cancellation, late
cancel, changed InvocationID/live cgroup refusal, artifact corruption/link/FIFO/
traversal/budgets/intents/custody, SH/EX/per-job locks, public facade integration,
heterogeneous catalog selection, whole-log offsets, real local pipe transport,
timeouts, key-only argv and read-only hot-journal behavior. Unit/cgroup/SSH node
observations are simulated; no actual privilege/namespace proof is inferred.

Before deployment still required:

* independent review of THIS source and the isolated qualification harness;
* real Civo systemd namespace/process/child-cgroup/stop/export tests and baseline
  preservation, then qualification on other intended workers;
* canonical scheduler integration/token envelopes, qualified capacity/parallelism,
  no second loop, actual build/QA profiles (fixtures do NOT qualify development);
* reviewed bootstrap/sudo/helper/gateway/RPC installation transaction, root guard
  and closed-admission distribution, fresh final snapshot, source fencing;
* actual promotion/restart/failback and remote uncertain-claim reconciliation,
  distributed real development jobs, artifact/idle handling and Dell-off test.

Production signature DB, real Nome–CPF queue, A1, e-digger and K3s are untouched.
Local fixture success is not a complete infrastructure, promotion or DR claim.

## V3 physical project backing (NOT HOST-QUALIFIED)

V2 notice3099 passed independent source review only. Root held harness3108
because work/HOME/TMPDIR and systemd PrivateTmp would write outside the project.
V3 adds project_storage.py to the pre-import pinned closure (16 files). Root
prepares an exact job directory beneath /mnt/apps/peticao-final/.runtime, writes
a durable exclusive bind intent, and mounts only that source onto the exact
/var/lib/private/StateDirectory for the fixed job. StateDirectory, DynamicUser,
private parent, all capabilities/network/home protections remain active. Host
mountpoints are empty bookkeeping; actual output must be proven on project storage.
No BindPaths grants an unmanaged writable directory to a dynamic UID.

Both /tmp and /var/tmp and direct /mnt/apps/peticao-final/.runtime are
InaccessiblePaths, with PrivateTmp still enabled. The managed /var/lib alias
remains the only writable work view for the dynamic user.
The systemd255 source suggests this suppresses private host temp creation; it
is a hypothesis until the exact Civo build and an inotify-observed real unit
prove it. Do not claim effective isolation from command construction alone.

ProjectStorage requires an existing root0700 dedicated directory with a fully
root-controlled nonsymlink ancestor chain. It refuses existing paths, nested or
stacked mounts, changed mount IDs, dev/inode mismatch, foreign receipts/boots/units.
The retained root0700 per-job parent prevents dynamic UID recycling from granting
access to past files, including when systemd idmaps the leaf. No owner equality
between namespace and host leaf is assumed. Fresh own inactive unit and empty
cgroup proof is mandatory before normal unmount; no force/lazy/recursive option.
Intent/reply uncertainty is not retried or equated with absence. Explicit status
can recognize retained output only with a final own receipt and absent mount,
mountpoint and public alias. An interrupted cleanup requires reconciliation.

The qualified bootstrap must create runtime/jobs and runtime/exports. No code
here creates or changes shared ancestor ownership. Worker exports and receiving
ArtifactStore roots must both reside physically under .runtime. Root rpc now
selects the fixed project export root; the separate qualification harness must
select a project custody root too. Controller service-UID access still needs an
independent least-privilege qualification; this packet does not install it.

Local storage tests use real project-private directories and mocked mount syscalls,
tables and identities. They prove fail-closed state-machine behavior, NOT real
mount backing, systemd semantics, idmap safety or absence of host tmp. Those
require the new reviewed isolated host harness. Frozen V1/V2/harness3108 remain
unchanged. Production, canonical queue, credentials and SSH were not modified.

Primary research: https://www.freedesktop.org/software/systemd/man/255/systemd.exec.html
and https://raw.githubusercontent.com/systemd/systemd/v255/src/core/execute.c .

## V4 prospective unit-reference lifetime (not deployed)

Actual TEST3151 failed after the first success: the transient unit had been
collected after stop, so the fresh-bound-unit cleanup guard refused. The runner
was gone; a durable bound exit0/empty-cgroup proof and unchanged mount64 remained.
The failed attempt is retained and requires separate operator-only reconciliation
source3163. V4 does not relax missing-unit cleanup and cannot replay3151.

unit_refs.py maintains a private libsystemd sd-bus connection in the executing
process. One RefUnit per own unit is held across stop and storage cleanup; only
verified retained project storage permits UnrefUnit. A reference from a short
command is insufficient. PID/boot/client/socket identity and the manager's unique
bus owner are pinned; calls target that unique owner. Connection loss, owner
change or uncertain Ref/Unref reply latches uncertainty with no replay/rearm.
The native ABI uses the installed OS libsystemd, declared from upstream v255
headers; OS/loader/stdlib/root are trusted. No new dependency is installed.

The adapter checks a live provider before creating work, acquires the reference
after observing the newly active unit, reobserves the exact InvocationID, and
requires held references through fresh stopped-unit/cgroup checks. It never
accepts a collected/missing or recreated unit as normal cleanup authorization.
Storage uncertainty retains the reference while the executor lives; process or
connection loss needs separate reconciliation. Unit control and physical mount
proof remain independent requirements.

An isolated host runner can own this connection for its complete test lifetime.
The existing one-request RPC entry cannot retain it across future SSH calls.
Therefore its default is explicitly blocked until a persistent worker broker
with a qualified lifetime is implemented and tested. No broker/service/socket is
installed here; node transport/canonical scheduling/readiness are still false.
Future recovery must revalidate active bound units without restarting jobs;
collected/unmounted/uncertain cases cannot be silently recovered by a new ref.

The pre-import closure grows to16 files, including unit_refs.py, and both entry
bootstrap hashes are updated. Local tests include real private filesystem/child
fixtures, fake-bus lifetime/connection failures and a compiled C ABI shim backed
only by a local socketpair. That shim never contacts SystemBus or systemd. Its
compiler uses -pipe and project TMPDIR. The initial ABI smoke lacked explicit
compiler TMPDIR containment; its log is kept, and only the corrected final suite
is used for V4 verification. Native API shape tests and fake references do not
qualify actual systemd retention, manager reexecution or broker recovery.

Primary references: https://www.freedesktop.org/software/systemd/man/255/org.freedesktop.systemd1.html
https://www.freedesktop.org/software/systemd/man/255/sd_bus_call_method.html
https://raw.githubusercontent.com/systemd/systemd/v255/src/systemd/sd-bus.h .
