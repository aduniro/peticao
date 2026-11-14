# Civo tools parity

Scope: install only CMake, FFmpeg and ImageMagick plus the 122 pinned missing Ubuntu noble packages (78.5 MiB download, 232.3 MiB installed). No upgrades/removals, repository changes, app/auth/session access or service commands.

Execution requires own Apoio deploy reservation bound to immutable notice and actual Root ACK. Download checks all exact SHA256 values from existing APT metadata; rejects maintainer service commands and unit/init payloads before installation. Per-run APT configuration clears DPkg hooks to prevent PackageKit/needrestart launches; global APT files are not changed. Service invocation/PID snapshots must remain identical. Existing package versions must remain identical; only reviewed additions allowed. Any failure preserves evidence and refuses automatic retry.

Remote private runtime: /mnt/apps/peticao-final/.runtime/civo-tools-parity-20261114. Separate non-root fictitious smoke workspace: /mnt/apps/peticao-final/.runtime/civo-tools-smoke-20261114. Compile and run a trivial C executable; generate and probe one-second synthetic video; resize a synthetic PNG. No external media or app data.

No general jobs, production deployment or queue cutover authorized by this package.
