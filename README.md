# Launch-token custody: source-only candidate

This module fills the prerequisite in Backend.dispatch: the controller must
persist its per-job launch secret BEFORE reserving or sending work. It does not
create another queue, scheduler, public action, cloud resource or platform API key.
No real credential or remote machine is used by this packet. Civo remains the
planned central development machine; Akamai support; Codex stays on Dell.

TokenStore requires an existing owned0700 child of the project .runtime directory,
a trusted root/service ancestor chain and a stable directory descriptor. It
creates an exclusive0600 empty intent, fsyncs file+directory, then generates a
256-bit job secret, writes its exact manifest/generation/job envelope, fsyncs and
reads back validated custody before returning. Existing or partial files are never
overwritten and never cause regeneration. Concurrent callers have exactly one
winner. A crashed/incomplete preparation stays uncertain for explicit
reconciliation. load() retrieves only the same complete bound token; it neither
reserves nor launches. Metadata returns hashes only. Secret objects redact repr
and str, reject ordinary JSON/pickle serialization; explicit value_for_dispatch()
is solely for the internal authenticated Backend.dispatch call, never logs/argv.

Recovery must inspect the SAME canonical queue row/claim before deciding what
to do. A prepared envelope with no claim can supply the same token to first
dispatch. An existing claim/permit or lost start response must be observed under
the same ID, not redispatched; Claims remains the atomic authority enforcing
that rule. This module does not infer claim absence, roll an epoch back, mint a
replacement token, rearm a worker or create a second scheduler. Promotion and
snapshots must preserve/validate custody together with the canonical queue in
the future reviewed encrypted recovery flow; that integration is still missing.

Local tests use actual private files, fsync, concurrent processes and process
crash. The validator and allowed_root injection are explicit local-fixture seams,
not runtime configuration knobs; the default validates the production path.
Three integration cases use an immutable copy of runtime3116, a real local child
and synthetic unit/cgroup/transport identities. Runtime3116 source review was
pending at preparation; copying it does not endorse host execution. These tests
do not qualify systemd, UID999 access, actual scheduler integration or distributed
recovery. No live canonical queue, platform auth, production or SSH was changed.

The full remaining work includes canonical-loop integration, resource accounting
and parallelism, real build/QA profiles, private helper/transport and Civo host
qualification, fencing/promotion/restart/failback and Dell-off acceptance.

## V2 recovery durability correction

Parent3121 remains frozen and held. A complete visible envelope after a process
crash does not prove its producer synced it. V2 load validates the same open
regular-file descriptor, fsyncs that descriptor plus its held directory descriptor
and only then returns the same secret. Sync failure returns CustodyUncertain;
no dispatch or regeneration is performed. The ordinary-file read-only fsync is
Linux-specific, matching the target runtime; unsupported/erroring filesystems
fail closed. The new regression checks sync failure on file or directory and
that recovery syncs both before yielding a secret. Runtime3116 fixture dependency
is unchanged. The final23 tests passed after Apoio released the agreed IO window; no
suite ran concurrently with that independent144 review. Source/contract updates do not qualify any host.
