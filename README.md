# Canonical real profiles — prepared source, not installed

This packet implements fixed profile descriptors/pins, a candidate per-node V2
catalog and an internal one-step consumer with one persistent slot PER NODE in the
EXISTING canonical queue database. No service, scheduler, app, real queue,
worker, host, credential or production database was changed. No real build,
browser or profile qualification was run. The current worker runtime remains
unchanged and accepts only its existing fixture profiles/actions.

## Division of ownership

Infra owns the persistent worker broker/root entry/retirement lifecycle. Apoio
owns this separate profile/catalog/consumer candidate. Retirement source ABI now matches frozen brokerV2 notice3222; its live
transport/provider and host qualification remain PENDING. Neither this
source nor the local wire library3205 proves broker readiness or installation.
Civo is the intended central development/integration node; Akamai is a future
worker with its own OS/native-tool qualification. Azure is not reactivated here.

## Actual implementations

profiles.py returns three closed, immutable-by-copy descriptors:
admin-typecheck-v1, admin-build-v1 and admin-qa-v1. Descriptor hashes bind actual
canonical descriptor content, source/dependency metadata and artifact policy.
They do NOT prove bytes have been revalidated in the new workspace. Source
reference: appc472837fb5a4584d81f34c420f4de30989084f85,
site14409ebfce08daa337f6b2dfc392fe38b54ee86d,
harness09d1d66d0e821e92d96bd83de70afdb832a31bc6, archive19db95b7...
Node exact20.19.2 and its known binary digest are reference pins. Public deps
archive3009712141b019777b6395e36a628f4e1c0b8720fb617e4ffe5c814d91670698
is207013889bytes. The original cache was not wholly validated. No generic HEAD
or current production version is inferred from this checkpoint.

The physical backing plan remains beneath project .runtime, while job argv/cwd
and environment use the logical managed StateDirectory with short relative
paths. Toolchain destination /opt/peticao-dev-profile-tools-v1 is a PROPOSED
immutable readable root-owned tree, not installed by this packet. It avoids
weakening the worker's InaccessiblePaths mask over .runtime. All generated work,
DB fixtures, temporary files, browser storage and artifacts must stay physically
in the project job backing. No host HOME/config/dotenv/real credentials, real
mail/WhatsApp/cron or production connection is permitted. Fixed offline commands
are only a plan: namespace mapper, executable pins, new units/ports/tmp matrix
and the QA runner adaptation/new package pin remain incomplete. The old QA
runner with its old fixed root/unit is not silently reused as executable here.

catalog.py preserves the select(kind,worker) interface with per-selected-entry
hashing. Candidate V2 has both existing fixtures and three new kinds. Its
shape is a future catalog extension, NOT a mutation of frozen V4's two-kind
catalog. Every template node/profile is qualified=false. Other nodes have
unqualified placeholders rather than borrowed Civo native pins. Real profile
JSON flags cannot override the frozen descriptor's incomplete qualification.
Actual qualification evidence and new reviewed source are needed to activate.

consumer.py is not another scheduler or an admission API. It is intended to be
called by the existing coordinator loop. Constructor verifies facade/Claims use
one identical SQLite path and never initializes schema. Explicit install_schema
is a future migration draft creating only canonical_consumer_slots plus its
worker_id/backend columns and unique active-slot-per-worker index IN THE SAME DB, preserving jobs/events/claims. No real
migration was applied. Generation/authority/catalog/payload/manifest identities
are checked before effects. Slot reserve/phase intents use FULL synchronous
transactions before mutating calls. TokenStore3127 prepares durable private
secret before Claims.reserve/Backend.dispatch; existing claim or attempted start
uses SAMEID observation, never regeneration or dispatch replay. No secret is
stored in rows/events/returns or argv. Loss of response/finish/retirement state
is uncertain and continues to occupy the slot. Terminal completed/failed/canceled
does not free capacity on its own. Admission defaults block real jobs through
unqualified catalog entries.

## Retirement boundary, explicitly pending

Proposed private worker request:
retire{manifest,token,receipt_sha256,bundle_sha256,custody_receipt_sha256}.
Consumer passes a typed RetirementRequest with LaunchSecret hidden from repr;
only a future reviewed private adapter may unwrap it for authenticated wire.
It is not a public facade action or a new action added to frozen V4 here.
The exact broker ACK is state=retained, nested identity and
unit_reference_released=true, rather than synthesized flat proof flags.

The consumer verifies actual ArtifactStore identity/wire/index and, when the
Finalizer result exists, binds the matching terminal result event. It persists
an explicit artifact_custody_verified attestation in the same FULL-synced DB
before requesting retirement. This is an authenticated controller attestation,
not magical remote proof of another machine's disk. Worker must independently
validate token hash, receipt/manifest/invocation/bundle, persist its own exclusive
intent, retain storage and Unref, and return the exact bound receipt. Only exact
ACK matching the frozen nested broker receipt clears the slot. The broker
checks retained storage/mount absence before that durable worker attestation. Lost
ACK or bad binding does not call cleanup again. Default missing provider stays
pending; no backend readiness is claimed. The source wire schema is matched to3222; concrete transport/provider and
native broker interoperability still need qualification before use.

## Reference QA and remaining gates

Reference100=backend43+HTTP7+browser40+maphelpers2+HTTPreset8. Browser success/error
API calls were mocked; real tiles/geocoding are NOT qualified. Prior4CPU/8GiB/
30GiB/3072MiB heap/2700s budget is not a measured minimum or guarantee of host
capacity. Initial parallelism is one per worker, not global serialization across workers. Full source/dependency/wheel/tool integrity,
exact Python/PG/Chromium executable pins, logical/physical mapping and short
PG socket matrix, adapted sealed runner and actual per-node/per-profile
resource/cancellation/custody/retirement qualification remain before activation.

No production cutover or primary arm is performed. Existing authority/floor
must validate primary status for actual consumer use. Civo's isolated fixture
qualification3195 does not itself activate the canonical loop or real profiles.
New explicit migration/installation/test notices, independent technical review,
own leases and coordinated rollout are required under the existing autonomous
infra scope, not a new Owner approval channel. Broker lifetime/recovery,
checkpointed token custody, fencing and fallback acceptance remain separate.

## Local validation

Focused tests use project-local private SQLite and actual TokenStore/ArtifactStore
fixtures with fake backend/custody/retirement peers. No upstream163 suite was
rerun and no app/node/browser/SSH command was executed. Tests exercise slot
concurrency, durable intents/crashes, legacy preservation, exact identities,
failed/missing custody, pending retirement and no replay after a lost ACK.

## Mandatory paired legacy guard

shared_guard.py validates the same transaction, canonical DB, exact control
schema and unique active worker_id index. Its private reviewed-installation
provider defaults absent/fail-closed; no JSON caller flag enables it. Consumer
also defaults to no paired guard. Rollout must quiesce the previous dispatcher
and prove the paired versions and prior legacy process drain before enabling
that provider; merely importing this library is not an installation proof.

legacy_successor.py is a candidate adapter to the frozen3080 coordinator, not
a patch to its original files or an automatically installed loop. It replaces
its dispatch_once only when explicitly wired by a future reviewed coordinator
entry. It reserves the SAME per-node row under BEGIN IMMEDIATE before any
launcher effect, excludes remote ssh-systemd rows, checks already active local
work, and rechecks guard/authority/slot immediately before the fixed launcher.
The remote consumer's reserved slot therefore blocks local Civo work even in
the TokenStore.prepare to Claims.reserve window. A legacy Civo job does not
block an independent Akamai slot. Unknown or failed launch keeps the slot.

Legacy completion alone cannot release it. A separately qualified PRIVATE
terminal/custody provider must prove exact job/payload/worker/generation, stopped
unit, cgroup/process drain and durable result/artifact receipts. This provider
is not implemented or qualified here and defaults absent. It is never a public
RPC accepting caller proof. No source module can infer drain just from a terminal
state. Original old dispatch must not remain active alongside this successor.

The consumer's remote attestation now ALWAYS requires coherent job/claim terminal
states, complete canonical Finalizer result identity/outcome, actual verified
ArtifactStore result/wire/index and corresponding terminal event. Missing or
empty result cannot skip that check. Prestart cancellation lacks normal bundle/
invocation and is refused for this retirement path, pending its own exact flow.

Infra refined the pending wire with retirement OBSERVATION, carrying the same
bound fields. Consumer.retirement uses only the separately injected observer
after a durable original retire intent; exact retained ACK may clear the slot,
while uncertain/no_replay/bad binding keeps it. It never repeats retire, creates
a worker intent or calls cleanup/Unref. Concrete broker wire/ACK compatibility
remains pending its freeze and independent review.

### Exact prestart cancellation exception

A canceled-before-start worker proof is NOT a retained-storage ACK. Existing V4
Finalizer validates and commits the exact authenticated no_unit_created/receipt/
boot response. The candidate consumer has a SEPARATE reconciliation path requiring
canceled job/claim, no InvocationID or remote_running history, complete manifest/
receipt/boot/generation/token binding and matching canonical cancellation event.
It frees the slot in its own guarded transaction without custody, bundle,
retire or Unref. Incomplete/uncertain/start-intent or running evidence cannot use
this shortcut. A lost finish reply is reconciled from committed proof, never
by replaying finish. No retained storage is invented.

The future coordinator/worker bootstrap closure must explicitly include these
new modules and paired dispatch adapter after independent review. Frozen V4's
16-file entry and its two-kind catalog/fixture allowlist are not changed here.
Importing this candidate is not a live integration or schema rollout.
