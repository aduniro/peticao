# Coordinator RPC facade — SOURCE ONLY / NOT DEPLOYABLE

This is a candidate library and patch, NOT a running service, installed CLI,
second scheduler, deployment or authorization for acquisition/cutover. All node
and fixture profile qualifications in catalog.template.json are false.

## Custody and integration

SOURCE-CUSTODY.json pins authority overlay notice3051/commit87c11977. The four
unmodified upstream modules are under upstream/. coordinator.py changes remote
routing and the inherited sanitizer only; authority_guard.py, remote_contract.py
and runtime_profile.py remain byte-identical. Infra owns runtime642 separately;
no files there were changed. Integrate into the ONE canonical scheduler only
after separate review; there is no extra daemon or listener here.

Facade(queue, catalog, authority, queue_validator=..., worker_root=..., backend=...)
provides public rpc(dict) and INTERNAL manifest_for(id). The production defaults
require a root-owned catalog with trusted ancestors and a private existing queue.
Actual installed queue ownership/modes remain an explicit integration gate; tests
use owned0600 files/0700 parents, not evidence of installed permissions.

Submit accepts exactly action,id,kind,worker_id. Only fixture-pass/fail are
represented. Digests and qualification come from a root-controlled catalog;
generation/node/kernelboot/op/epoch come from the guarded authority. No generic
command/path/env/archive/token is accepted. Payload contains fixed identity and
catalog digest, not its own hash. The exact contract manifest is derived from
that persisted payload. Same ID+identity is idempotent; changed worker/profile,
catalog, authority epoch or legacy ID refuses. Queue and queued event insertion
share BEGIN IMMEDIATE and recheck authority/catalog under that DB lock. This is
NOT a distributed root/epoch lock and does not replace admission fencing.

No secret is generated, no Backend.dispatch is called, and no receipt/completion
or fake-artifact submission endpoint exists. A future canonical dispatcher MUST
persist the per-job random token privately before ONE Backend.dispatch call.
Lost response means observe SAMEID, never retry dispatch. Schema installation is
explicit in Claims; facade checks it exists and never creates a queue/schema.

## Legacy routing

reconcile skips remote payload.backend=ssh-systemd-v1 before local state access.
dispatch_once selects only local queued rows, before generation/directory/launcher
work. A remote starting/running job still occupies the existing global single-job
slot. Direct legacy run/cancel/logs also reject remote work. Local job/event state
and event sequences remain unchanged. A stale remote generation is not marked
interrupted by the local dispatcher; remote recovery needs the canonical backend.

## Read API and logs

health/jobs/status/logs read the existing DB using mode=ro, query_only and no
reconcile. No immutable=1. The fixture proves healthy DELETE journal bytes and
logical state unchanged, NOT physical byte invariance for all WAL/recovery states.
Public metadata preserves job IDs/states/times/generation and event seq/refs;
free-form event data/error, raw payload, private paths and arbitrary results are
not exported. Safe known kind, source hash and common site subdir remain usable.

Infra explicitly chose compatible legacy log debugging: at most32768 raw bytes,
byte offsets, existing credential-family sanitizer. Private regular files only,
no links/hardlinks/world-readable files or remote→local fallback. Optional
metadata_only returns no text. Remote uses only injected Backend.logs(manifest,
offset=0); no adapter means unavailable. Invalid response fails closed. Historical
remote logs after changed authority/catalog are unavailable pending a distinct
reviewed historical-observation contract.

Known credential spans are now masked in BYTES across the complete private log
(max10MiB) BEFORE slicing at an arbitrary offset into a max32768byte reply.
The shared log_redaction.py is copied byte-for-byte from Infra642, source/hash
recorded in SOURCE-CUSTODY.json. Both legacy RPC and Facade use the same private
log_access.py dirfd reader. Known credentials crossing offsets/chunks stay masked;
mask length preserves raw byte offsets. Remote Backend.logs must do this same
whole-log masking on the worker; facade cannot reconstruct unseen remote prefixes.

Pattern redaction still cannot detect arbitrary secrets. No live log contents
belong in reports/tool context. Before deployment qualify access policy and ensure
operational secrets/envelopes are never logged. The inherited text prefix regex
also had quadratic work on long identifier lines; a negative identifier-boundary
lookbehind fixes repeated restart while retaining credential families. The stalled
fixture run, earlier offset weakness and correction remain recorded outside this
source repo. Tests use fictitious credentials only, never printed as test output.

## Still required

Root guard distribution/bootstrap/rearm; SH admission lock during mutating RPC,
EX fencing drain and persistent epoch-bound closed admission on ALL workers;
fencing ALL admin-dev-<id>-gN.service plus admin-v2-job executors; authenticated
transport; actual worker/profile readiness; canonical scheduling/token custody;
artifact/result/cancel qualification; install transaction and live recovery.
Azure remains blocked by AADSTS530035; do not wake/auth-bypass based on this file.

Tests are local fictitious SQLite/log data, mocked launcher/backend and no hosts,
network, systemd, actual private key, production DB, app/A1/NomeCPF/K3s access.
