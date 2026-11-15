# SourceA operator client V3 - preparation component

No SSH, Civo mutation, service start or credential reading occurred while
preparing/testing this component. It must be composed into Apoio's complete
reviewed SourceA packet before it can execute. It is not a standalone installer.

Copy ONLY qualification_client.py and review_gate.py into SourceA. The contract
is provided by SourceA, with runtime/10 and broker/5 plus six root harness files.
Tests load its exact preliminary pure Git blob ef8e078/eb787986; they DO NOT use
an evolving worktree. Do not copy test_operator_client.py into SourceA: it injects
that historical pure contract for component tests only. CONTRACT-CUSTODY.json
records the verified dependency. Final SourceA tests/review use its actual code.

The client package is exactly23 public files:21 reviewed code members plus
RUN-REQUEST.json and readonly-marker. No capability, token, key or private config
is packaged. The SSH identity is consumed only by the existing SSH binary.
Host alias212.2.241.70, strict existing known_hosts hash, root tailnet100.122.224.82,
no multiplexing/agent forwarding. No account/auth/writer takeover.

Fixed installer only creates the approved A directory below /opt, after an
exclusive durable installation intent. It refuses occupied paths, unsafe parent
metadata or malformed/hash-mismatched members. It does not chmod/chown existing
parents, extract archives, delete evidence or accept an arbitrary destination.
All remote non-install phases invoke fixed qualification_helper.py phase digest;
only install has public package stdin. Responses are bounded aggregates and
cannot assert global qualification, B scope, cutover or evidence deletion.

Gate requires the execution notice by admin-recuperacao on exactly
 deploy:civo-worker-broker-qualification, operation=test, production_access=false,
queue_cutover=false, preparation_only=false and permanent Infra operator_session.
SourceA must be authored by Apoio and independently ACKed by Root; exact clean
Git/whole-source file hashes must match both preparation and execution notices.
Runtime3178/4e15b7 and broker3237/0676c0 must match commits, reviewed code closure
and independent Apoio ACKs. The new execution notice also requires Apoio ACK.
Any confirmed notice disposition makes a dependency unusable even with old ACK.

The executor owns a private regular capability file with matching Infra session,
active canonical TEST lease/exact resource/fence and acquisition bound to the
execution event. Every remote effect rechecks current gate and host pin. Start
requires at least600seconds plus120margin; all other phases75+120. Future root
runner must stay within that start budget. No borrowed Root capability, stale
lease, broadened resource set or source-only approval can execute.

Install/bootstrap/start/cleanup have exclusive fsynced local intents before one
possible network invocation. Lost reply/crash means no replay. Observe may repeat
without a mutation intent. Public code pin changes are refused. Remote stderr,
raw live logs or tokens never enter output; CLI prints only phase/ok/state.

21 local tests PASS0.031s with actual private files/exclusive durable intents,
frozen pure contract and a SIMULATED canonical ledger/SSH. Tests check composite
ACKs, exact scope, session/lease/manifest/fence/budget, denied default, no duplicate
mutation call, host/scope changes, package hashes, reply limits/negative flags.
AST3+fixed-installer AST passed. These tests are not actual SSH/Gate qualification;
complete SourceA composition and independent review remain mandatory.

## V2 interoperability correction

Parent3244/810a35 is preserved, unACKed and never executed remotely. Review found
the installer wrote a flat remote tree while core.load expects public/runtime
and public/broker subdirectories. V2 keeps the23-member flat wire package but
maps the10 known runtime members and5 known broker members into exactly those
two freshly created root755 directories; harness6 and request/marker stay at root.
It fsyncs both subdirectories, public and /opt after writing/fsyncing each file.
The durable install intent is persisted before the first public mkdir.

The installer refuses occupied PUBLIC, PRIVATE or SOCKET_PARENT before any
public write. The exact additional OS metadata path
/opt/.peticao-dev-worker-broker-qual-20261115-attempt1.install-intent.json
must be declared in execution notice install_intent_path; Gate checks it. This
is reviewed installer bookkeeping, not a job temporary directory. The logical
TEST resource remains exact deploy:civo-worker-broker-qualification.

Gate also requires the host systemd major/hash to equal the tracked, hashed,
execute=false OPERATION.template.json in SourceA. An ignored/untracked template
cannot establish the version pin. Changed OS pin requires new frozen source.

29 tests PASS0.133s. Five execute the ACTUAL installer code against real private
project filesystem fixtures (mkdir/O_EXCL/write/modes/file+directory fsync and
partial-crash preservation). Only absolute destination roots, root UID/hostname
and ancestor root metadata are mocked; nothing is written under actual /opt,
/run or project operational .runtime. Assertions verify exact23-file layout,
first intent+parent fsync and final runtime/broker/public/opt fsync order, no
reinstall after partial write, occupied private/socket refusal and bad digest
before intent. Ledger/SSH tests remain simulated. No host execution is claimed.

## V3 private capability error redaction

V2 installer/layout/fsync/host-template/intent scope are byte-identical. Only
review_gate.central catches OSError and TimeoutExpired and raises a fixed
PermissionError with suppressed exception chaining. A ledger check puts its
private capability in argv; the raw TimeoutExpired command representation must
never reach a traceback. The added test forces both errors with a synthetic
capability and checks the fixed message and suppressed context.30 local tests
PASS0.136s, no SSH/host effect; previous29 cases remain unchanged.
