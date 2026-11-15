# Persistent worker broker - source candidate

No host installation, socket activation, unit, mount or cloud action was
performed for this packet. Both policy/evidence templates reject execution.
This is a new source candidate, not an installed broker or a finished migration.

## Immutable dependencies

runtime/ contains the16 exact V4 public code blobs (3178/4e15b7e), independently
reviewed3183. SOURCE-CUSTODY.json records every hash. Runtime core is unchanged;
its one-shot rpc.py remains blocked. A frozen test helper is explicitly test-only.
Real Civo3195/3202 proved underlying native reference/storage lifetime for three
synthetic jobs, not this broker, real app profiles or distributed recovery.

## Process and trust boundary

Broker/proxy validate root-owned bounded files and BOTH complete code closures,
current node/boot qualification and matching runtime evidence before runtime
imports. The broker must share PID1 mount namespace and root/tmp views. It takes
an exclusive operator-prepared /srv/peticao-dev-worker/broker.lock before opening
one real default UnitReferences connection and making one WorkerRPC instance.

Socket activation supplies exactly one root local UNIX listener at
/run/peticao-dev-worker-broker/worker.sock, private parent0700 and socket0600.
No public TCP endpoint exists. Kernel SO_PEERCRED/PID/UID checks precede request
reading; fixed bounded JSON/framing and an internal action allowlist are used.
Future fixed SSH target is /usr/bin/python3 -I -B
/opt/peticao-dev-worker-broker/broker_proxy.py. Existing transport.py still points
to the old blocked rpc.py: an independently reviewed successor must change it.

The root entry/OS/stdlib/config are trusted, not a hostile-root boundary. Root
needs manager/mount access to prepare isolated job storage; job units still use
unchanged DynamicUser/private network/no capabilities/hidden credentials and
physical project backing. Candidate root service deliberately keeps manager
mount namespace; root control code handles no arbitrary command/profile/path.
No service file is installed/enabled here. Restart=no prevents creating another
keeper automatically after failure. KillMode=control-group covers broker helper
children; actual job units are separate systemd units.

## Internal lifecycle contract

Original seven WorkerRPC actions are unchanged. The new internal retire request
has EXACT fields: action, manifest, token, receipt_sha256, bundle_sha256,
custody_receipt_sha256. The canonical coordinator sends it only AFTER validating
and fsyncing artifact custody. The custody digest is an authenticated attestation
by that token holder; it is not independent remote disk observation. Worker
checks full manifest/receipt/token hash, typed stop proof/invocation/boot,
finalized outcome/identity and sealed bundle. Under admission+job locks it writes
an exclusive private project intent before cleanup. Only exact retained backing
and released original reference can produce a fsynced/read-back retained receipt.
No token is written to retirement metadata or error/log output.

A lost response must NOT retry retire. The read action retirement takes the same
fields and only verifies an existing durable receipt plus actual retained storage.
Missing/partial state stays uncertain/no_replay; it creates no intent/Ref, starts
no unit, and never unmounts/Unrefs. An explicit duplicate retire with a COMPLETE
receipt is also verification-only; an incomplete intent is never replayed.
Capacity remains held until the canonical consumer durably verifies the exact
retained acknowledgement. completed alone cannot release a node slot.

Quarantine keeps this process/connection rather than discard held references on
a cleanup/fsync error; it allows only observe/logs/bundle/retirement on the current
epoch. No prepare/start/finalize/cancel/retire mutation occurs. SIGTERM drains new
work and waits for references to release; a forced kill still requires explicit
reconciliation, never automatic rearm. Logs after retained storage may need the
canonical custody bundle: the unchanged runtime logs accessor expects mounted
output. Exports and physical backing remain preserved, no garbage collection.

## Startup and recovery boundary

Before accepting requests, reconcile every current-boot journal receipt/binding
and retirement directory. Prepared-never-started receipts require no invocation,
unit or storage evidence. Terminal receipts require typed full stop and result,
sealed export, exact durable retirement and actual retained physical storage.
Foreign, recreated, active, old-boot, start-intent, running, uncertain or partially
retired state blocks the listener. It never recreates a Ref or infers cleanup
from a collected unit. Same-boot completed retirement can be read without rearm.

Automatic cross-boot journal rollover, all-node fencing, operator reconciliation,
promotion/failback, restart recovery and Dell-off acceptance remain required
before distributed readiness. This source does not pretend to finish them.

## Validation and coordinated integration

58 local tests cover private SQLite/filesystem durability, identity/corruption,
no-replay crashes, actual socketpairs and kernel peer credentials. Three use a
real local subprocess, actual WorkerRPC/canonical queue and ArtifactStore custody
across separate connections, with unit/cgroup/bus/unmount adapters SYNTHETIC.
The latest listener CLOEXEC change reran its16 guard tests. AST26 passed; local
systemd-analyze verify accepted candidate units. New tests never opened SystemBus
or deployed a host broker. Original fixture-path/ancestor failures are preserved.
All temporary work stayed physically under this project. No inherited83/163
suites were rerun or relabeled as broker qualification.

Apoio owns the independent profiles/CatalogV2/same-queue consumer/pairedguard
source. Guard must serialize local and remote admission in the SAME existing DB
transaction per node. No public API, new queue/voter, production app/database,
credential copy, GPU or new cloud purchase is introduced by this packet.
