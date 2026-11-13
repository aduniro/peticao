# Passive development coordinator — staging phase 1

This package stages code and an inactive unit on `peticao-build-a1`. It does not
restore or create a database, start or enable a daemon, promote authority, run a
job, create a listener, reload systemd, or change Docker, SSH or firewall rules.
The production Nome–CPF worker/queue and e-digger are outside its scope.

Runtime modules originate from the preserved infrastructure draft
`65b56997b20467f641e3407e048043a8ec0e3864`. Kubernetes remains disabled. The
separate `next-topology` draft is not substituted into this staging package.

## Reviewed execution

Commit this repository, then prepare a packet outside the repository. Its
commit, operator SHA256, unit/runtime hashes and delegation digest are frozen.
The critical ledger notice must bind both commit and complete packet SHA256.

`client.py run` supports `preflight`, `apply`, `verify` and `rollback`.
Preflight/verify are read-only. Apply/rollback require a protected lease record
with the current Infra operator session, a live independently acquired **deploy**
lease for `deploy:akamai-development-coordinator-standby`, and the exact manifest
event/packet binding. Edit or other scopes, released leases, root's other lease
records and changed packets are refused before SSH. Tokens are neither printed
nor sent to the remote machine. Central quorum requirements are never waived.

## Remote effects after a valid deployment gate

- Refuse existing code, unit, queue, identity or staging state; no overwrite.
- Require Akamai hostname/root, trusted non-writable parent directories and at
  least 20 GiB free, preserving the shared migration floor.
- Create only the locked system identity `vigia-coord`, with no home and a
  `nologin` shell, immutable runtime files, an inert unit and a private receipt.
- Check imports as that unprivileged identity without invoking initialization.
- Never start or enable the service. A verified development snapshot, private
  RPC identity design and a separate coordinated transition are still required.

Rollback removes only hash-matching files from this receipt, and refuses active
or initialized staging and foreign directory contents. It deliberately retains
the locked system identity and audit receipt rather than deleting a potentially
reused UID. It does not delete any original project data or existing account.

Transport failure is uncertain, not evidence of abort: no automatic retry. Read
the bounded remote receipt/verify state and reconcile the exact operation.

## Validation

The isolated tests use temporary files and a temporary instance of the real
cooperative ledger. They exercise actual quorum/fencing, packet binding, wrong
scope/actor refusal, service inactivity, no database creation, hash-safe rollback,
foreign-file preservation and transport uncertainty. No live account or service
is modified by tests.
