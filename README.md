# Owner-preserving promotion metadata — SOURCE ONLY / NOT DEPLOYABLE

This separate source pins the baseline authority overlay3051/87c11977, preserving
unmodified originals under upstream/. No baseline checkout, installed file,
service, real queue, /etc guard, VPS, user account or actual promotion was changed.
Local root privileges were used ONLY for explicitly delegated private fixtures,
a real numeric UID999/GID987 reader, and the original module's metadata checks
on the fixed /usr/bin/true verifier executable. The verifier itself is mocked,
never executed; kernel boot is real and node identity is fixture-injected Civo.

The problem is root replacing service0600 files with root0600 temporary inodes.
atomic_metadata.py preserves existing expected UID/GID/mode and gives NEW service
metadata UID999:GID987/0600 before publication. Service directory must be0700 with
that owner. Only authority.json, generation-floor.json and promotion.json can be
written in a service-owned directory. Root/private snapshot staging stays root;
ordinary nonroot private staging keeps its own caller owner. No existing foreign
owner/mode is repaired automatically; an old root-owned service file requires
its own separately reviewed migration, not an implicit chown here.

All path components are opened as directories with O_NOFOLLOW, but ownership/mode
checks cover the FINAL directory, not trust of every ancestor. Lock, preimages
and publications reopen the target separately. Deployment must separately prove
trusted parent topology and quiesced writers. Publication uses
an anchored directoryfd. Target must be regular, single-link, expected owner and
0600; symlink, hardlink, FIFO, foreign owner/mode, occupied changed preimage and
arbitrary service filenames are refused. A generated same-directory temporary
is exclusive. Complete bytes -> fchown/fchmod -> filefsync -> replace -> dirfsync.
Only the temporary inode created by this invocation can be removed before
publication. Lost successful rename reply or failed dirfsync is visible-uncertain,
never rollback of the published data. No secret content is printed.

Promotion gathers protected preimages of authority/floor/origin/optional receipt
BEFORE running its live verifier, then uses those exact preimages in the three
writes. Floor changed during verifier is refused instead of being decreased.
The service-owned private operator lock is cooperative and nonblocking; unknown
or foreign existing lock is rejected. The root requirement is checked before
creating a promotion lock. EpochGuard/authority_guard are byte-identical to3051;
no call writes /etc/peticao-dev-authority/epoch.json.

IMPORTANT: dirfd and preimage checks are NOT compare-and-swap. Because the service
owns the directory, exclusion of concurrent authorized/service writers still
requires the canonical fencing/quiescence protocol. The separate floor -> authority
-> receipt publications are not a transaction or distributed consensus. Failure
after floor leaves floor advanced; failure after authority leaves authority
advanced. Neither authorizes decrementing the floor, rearming source, repeating
promotion or starting a daemon automatically. Prepublication rollback means
removing only the own temporary; published state is preserved for observation.

Tests run producer UID0 and fork a reader that fchdir enters ONLY the private
fixture directory, closes that directoryfd, removes supplemental groups and
irreversibly sets GID987 and UID999. This bypasses ONLY Owner workspace ancestors,
not target-file permissions. No new account is created. The reader proves JSON
files can actually be opened after normal publication, fixture promotion and
partial failure. Tests cover links/foreign owner/mode, writer/chown/fsync failures,
correct fsync order, lost rename reply, floor change and no automatic replay.
The fixture operator guard remains root0600 with unchanged bytes. No real guard
or production data is read for that test.

Validation logs and capability are outside this source Git repository at:
/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/authority-owner-preservation
Do not deploy this candidate or count local ownership evidence as approval for
live promotion, installation or any other infrastructure gate.
