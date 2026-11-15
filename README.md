# Worker runtime V2 candidate — source only

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
current-boot metadata and ALL14 code files before any runtime module import.
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
