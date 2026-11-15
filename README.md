# Isolated Civo systemd qualification — PREPARATION ONLY

No SSH connection, host installation, service/unit, production data, global
admission/epoch, actual coordinator queue, promotion, firewall, key or cloud
resource was touched in preparing this source. Current local tests use fake
contracts, mocked processes/network and private temporary fixture files only.
They do NOT prove actual systemd isolation. RuntimeV2 notice3099/df721fce is now independently reviewed and its eight
transitive library modules are copied byte-for-byte under runtime/. Held3089 is
normally superseded. These pins are required before the preparation notice; actual execution needs a DIFFERENT canonical
manifest/lease and independent review as delegated by Infra.

## Exact future scope

Host: peticao-civo via existing pinned Owner root SSH only. IPv4 100.122.224.82;
HostKeyAlias peticao-civo.tail1a6d71.ts.net and existing dedicated known_hosts.
SSH alone consumes the existing private key; no private key content is inspected,
copied, printed or put into a package. No root key transfer to vigia-coord.

Public code ONLY:
/opt/peticao-dev-worker-qual-20261114-attempt1 (new root0755, code root0644).

Private fixture state ONLY:
/srv/peticao-dev-prep/civo-worker-runtime-qual-20261114-attempt1 (new root0700).

Existing /opt and /srv/peticao-dev-prep parents must already have trusted ownership
and modes; never change them. Refuse occupied/link/foreign attempts. The fixed
installer persists /opt/.peticao-dev-worker-qual-20261114-attempt1.install-intent.json
before creating public code. Partial installation is preserved, never re-extracted.
No tar extraction, generic remote command, public listener, sudoers or RPC install.

Three distinct generated job IDs are fixed in the reviewed execution operation
BEFORE effects. The ONLY units are admin-dev-<each32hexID>-g1.service, max3.
Runtime StateDirectory is /var/lib/private/peticao-dev-job-<ID>-g1, kept after stop;
mode0700 and effective StateDirectoryMode0700 are verified, never corrected.
Controls/tokens/journal/exports/private custody are confined to the synthetic
private attempt. This fixture queue is NOT another operational scheduler.

## Canonical authorization, no new voter or approval channel

Apoio preparation source receives normal admin-recuperacao ACK. Infra publishes a
NEW actual execution notice, author admin-recuperacao/operator session
01a1d130-2948-7140-bcfb-34696b20ab8d, operation=test, resource exactly
 deploy:civo-worker-runtime-qualification,
preparation_only=false, queue_cutover=false, production_access=false.
It fixes this source commit/hash closure, runtime notice/commit/hash closure,
exact qualification_operation (execute=true, exact3IDs/destinations/pins).
Apoio independently reviews/ACKs both runtime and execution notice. That is NOT
implied by a preparation ACK or passed mock tests.

review_gate.py adapts reviewed()/validate_lease from the existing passive restore
client. Clean Git source, exact hashes, real notice authors/ACKs, runtime closure,
active own Infra capability, exact resource/operation, acquisition bound to that
execution notice and time budget are checked. No borrowing another session's
lease or automatic renewal. The client checks again immediately before SSH and
binds every remote phase to the reviewed operation digest. The install package
must equal the package generated from the reviewed source, not arbitrary stdin.

Before an actual window, Infra must consult canonical status/history and inform
Root. Do not request Owner approval again for this already authorized scope;
technical Root/Infra review and execution reservation are still mandatory.

## Future bounded sequence, NOT instructions to execute now

qualification_client.py exposes fixed phases install, preflight, bootstrap,
start, observe and cleanup only. It has a CLI with required --manifest-event and
absolute --lease-file. Local private evidence/intents go to
/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-systemd-qualification/execution-state
only AFTER canonical validation. No actual command invocation is provided here
because the execution notice and own capability do not exist yet. The example
operation remains execute=false; no preparation ACK can enable it.

The root helper verifies host, root ownership/ancestors, exact code package and
all pins before importing frozen runtime modules. Python runs -I/-B and disables
bytecode; the dynamic child reads public code without entering the private tree.
Bootstrap is exclusive: actual kernel boot, fixture epoch/authority, existing-queue
schema, journal, closed admission, private perjob tokens and descriptors pinned to
the real interpreter/program. No global make_service/config is used.

Start persists intent before a detached root helper, captures real PID/start_ticks/
boot identity. Run has its own exclusive lock and intent. The helper is bounded
250seconds; units are bounded120seconds with limited memory/CPU/tasks. A lost SSH
response leaves durable evidence and a continuing helper, never a repeated start.
The success path deliberately drops a response AFTER actual unit start and then
observes SAMEID without another dispatch. Observe is read-only aggregate metadata.

The three paths use frozen WorkerRPC/Backend/SystemdAdapter/ArtifactStore:
1. fixture-pass exits0, custody verifies, same fixture queue becomes completed.
2. fixture-fail has fixed bounded child14s, exits7, failed is preserved.
3. same fixed fixture-fail is canceled while>=2PIDs actually inhabit its own
   cgroup. Real InvocationID/binding, fresh stop, MainPID0 and emptycgroup are
   required. Unknown exit is allowed ONLY for canceled with provedownstop.
Actual artifacts export/import are verified before accepting queue outcomes.

The pinned qualification_job.py emits only synthetic artifacts/probe booleans:
DynamicUser/nonroot/capEff0/noNewPrivs; home/root masks; fake private marker denied;
public readonly marker cannot be written; Docker socket inaccessible; allowlisted
environment names (no real credential values read); private loopback works and
bounded TCP-connect to Santiago100.80.18.81:9 has no route. No application bytes
are sent. Timeout/refusal alone do NOT qualify isolation. Host effective properties
and limits must agree with the actual namespace checks.

Admission proof uses positive SH mutation, a separate exec with closefds showing
EX is busy, then EX closes persistent epoch-bound admission after drain. New
prepare/start use valid fixture credentials and must fail for the EXACT closed
admission cause; invalid token errors cannot count as fencing proof. No extra
unit or production admission is created.

## Failure, cleanup and evidence

No blind retry for installation/bootstrap/start/run/finish/export or extraction.
No wildcard stop/reset-failed. Cleanup is its own exclusive intent under the
execution lock, refuses live/unknown runner identity, keeps admission closed and
checks fresh real bindings/InvocationID/cgroups for ONLY3fixture units before any
stop. Unknown/unbound/foreign identity is refused and evidence retained. It never
restarts/finalizes work, deletes exports/journals or targets a foreign unit.

Baseline uses running service IDs/MainPID/InvocationID only, excluding volatile
user/session/getty units explicitly. No application database/config/log content,
/proc commandline or credential is inspected. Baseline difference fails the
qualification; it is not silently ignored. Stdout contains aggregate states/counts
only; private traces/tokens/live log content never enter tool context or reports.

This qualification cannot prove distributed node readiness, real build/QA profiles,
cutover, consensus, failback or disaster recovery. UID999 coordinator ownership
preservation is a separately queued task; a root fixture does not qualify it.
