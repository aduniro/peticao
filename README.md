# Civo qualification V3 — preparation only

This immutable source is not an installation or host qualification. No remote
calls, units, mounts, new machines, credentials or production changes were made
by preparing it. Old source notice 3108 remains held and was never executed.

## Frozen dependency and placement

Runtime notice 3116, commit 7f5144749bd423b89649d77c6307b40774a125c1,
was independently reviewed: 144 tests passed in 9.766 seconds; ACK 3126 is source
only. The previous 90-second local timeout was retained and is not a pass.
Nine runtime modules are copied byte-for-byte, with SHA256 custody.

Future public code: /opt/peticao-dev-worker-qual-20261114-attempt2
Future private state: /mnt/apps/peticao-final/.runtime/civo-worker-runtime-qual-20261114-attempt2

Control, queue, journals, exports, custody, tokens and job-backing stay beneath
that private root0700 attempt. Shared existing parents are only checked for
root ownership and no group/world write; they are not chmodded. No private
key is inspected or copied. The SSH client consumes the existing approved
identity and verifies the exact public known_hosts pin before every call.

## Evidence required from the future host test

Exactly three fresh synthetic jobs: success, exit7 failure and cancellation
with a descendant in the same cgroup. Actual InvocationID, binding, stopped
cgroup and physical backing dev/inode must match. Runtime ProjectStorage
binds project-backed work into the managed StateDirectory target. Verify
while mounted, collect the artifact through Backend.finish, stop and verify,
then cleanup storage before any reset-failed. Retain project evidence. A
collected/missing unit or uncertain mount/unmount intent cannot authorize
cleanup or replay; reconcile explicitly.

The reviewed systemd255 full version stdout hash must match. Read-only
inotify starts before any unit, watches only names belonging to the three
units in host /tmp and /var/tmp, and detects create/delete between snapshots.
Overflow, lost watch, parent replacement, divergent PID1 mount namespace,
divergent chroot/root/tmp dev/inode or unexpected own-unit names fail closed.
A second drain after the final scan closes the scan/drain race. Only host
scope can qualify: injected local fixture roots never count as host evidence.
No files are created under host tmp by the probe. The fixture verifies both
tmp paths are inaccessible and direct access to the project runtime root is
denied; its cwd must have the bound physical backing identity.

Admission proof includes positive SH mutation, a separate closefds exec showing
EX busy, and exact closed-admission denial with valid synthetic credentials.
Real DynamicUser, PrivateTmp, network restrictions and cgroup behavior remain
unqualified until the actual reviewed host execution passes.

## Execution and review gates

This OPERATION.template.json is execute=false. Infra's separate operation
packet supplies new IDs; template IDs must not be used for the actual run.
Apoio PREPARO notice requires Root review. A NEW execution/test notice must
be authored by Infra/admin-recuperacao, independently ACKed by Apoio, tied to
runtime3116 and exact source hashes, with preparation_only=false,
queue_cutover=false and production_access=false. The executing Infra session
must hold its own active canonical lease for deploy:civo-worker-runtime-qualification.
Every effect rechecks the gate. Root is informed of the execution window.
No additional Owner question or parallel coordinator is introduced.

Installation, bootstrap, start and cleanup have durable exclusive intents.
Lost response means observe the same operation, never blindly retry. Cleanup
requires a dead known runner, exact own binding/InvocationID and fresh stopped
cgroup evidence; never wildcard-stop or delete evidence. Private output is
not exported as live logs; reports contain aggregate results only.

Local tests use project fixture directories and mocks, never real SSH, units,
mounts, production data or host tmp. They validate source behavior only.
This does not qualify cluster readiness, real builds, cutover, promotion,
failback, consensus or production deployment. Owner-preserving metadata is
separate source notice3097, not proven by this root qualification fixture.
