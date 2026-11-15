# Worker broker wire protocol - source preparation

Local Linux AF_UNIX stream framing and kernel peer authentication for the
persistent worker broker. This packet is NOT a running broker or installer.
It creates no listener, socket path, service, worker, queue or platform resource.

Broker constructs one fixed internal handler exactly once, then serves several
connections sequentially. SO_PEERCRED is checked before reading or invoking the
handler. Production defaults require UID0 for broker and client peer; the UID
parameter exists only for unprivileged local tests. Broker PID/UID are rechecked
on each call. No requested UID or handler name can change peer authority.

Frames use an unsigned 64-bit network-order length. Request maximum is65536;
reply bound accommodates the existing artifact512MiB base64 envelope. JSON must
be an object with finite values and unique keys. Only the existing seven worker
RPC actions are accepted; WorkerRPC still owns exact field/profile/manifest,
claim/token/admission/authority validation. The wire does not authorize work.

One request is sent once. Lost/partial/corrupt response yields OutcomeUncertain;
there is no reconnect/retry/reinvoke. Handler errors expose type only, never
exception text, tokens or log excerpts. A failed reply cannot cause another
handler invocation. The caller must observe the same durable job identity.

## Required integration before deployment

The root entry must validate the entire pinned runtime and broker code closure,
current node/boot/epoch/profile qualification, protected socket parent/ownership,
and actual PID1 mount namespace. It must own one UnitReferences and WorkerRPC
for its process lifetime. The listener must be local root-only; SSH/sudo entry
must remain fixed, authenticated, scoped and source-pinned.

Startup must reconcile journal/bindings/storage and fail closed on lost live
reference lifetime, start/stop/cleanup uncertainty or foreign state, without
rearming or replay. Stop must drain or preserve exact job state. Per-job
finalization must verify custody, retain physical project backing, and release
its Ref only after that retention; this packet performs none of those actions.
No collected-unit exception or generic cleanup is introduced.

The existing canonical coordinator remains the only queue. Capacity, durable
launch tokens, per-job policy and real app build/QA profiles need their own
reviewed integration. Source tests do not prove those requirements. Real Civo
qualification3195 validated the underlying V4 reference/storage lifecycle on
three synthetic jobs, not this future broker or the distributed migration.

## Evidence

12 local socketpair tests PASS0.005s using actual Linux peer credentials and
separate connections. Handler/socket fault injection checks no duplicate call
and suppressed exception text. No actual systemd bus, host install, TCP listener
or external service is used here. The first test run leaked one fixture socket
(ResourceWarning); both endpoints are now closed and the corrected log is clean.
The original log remains private in state/tests.log, corrected in
state/tests-fixed.log. No inherited83/163 suites were rerun.
