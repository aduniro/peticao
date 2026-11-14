#!/bin/bash
# Explicit installation only; never called automatically by the source package.
set -Eeuo pipefail
umask 022
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=l
readonly BASE=/opt/peticao-toolchain
readonly RUNTIME=/mnt/apps/peticao-final/.runtime/azure-dev-toolchain
readonly PINS=/opt/peticao-toolchain/pins.json

validate_pins() {
  /usr/bin/python3 - "$1" <<'PY'
import json, re, shlex, sys
p = json.load(open(sys.argv[1], encoding="utf-8"))
def require(ok, message):
    if not ok: raise SystemExit(message)
def digest(value):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value)
require(isinstance(p, dict), "pins must be an object")
names = ["docker-ce", "docker-ce-cli", "containerd.io", "docker-buildx-plugin", "docker-compose-plugin"]
require(isinstance(p.get("docker_packages"), dict) and set(p["docker_packages"]) == set(names), "exact Docker package set required")
for name in names:
    value = p["docker_packages"][name]
    require(isinstance(value, str) and re.fullmatch(r"[0-9][A-Za-z0-9.+:~_-]*", value), "invalid exact Docker version")
require(digest(p.get("docker_gpg_sha256")), "Docker key SHA256 required")
for key, major in [("node20", "20"), ("node22", "22")]:
    node = p.get(key)
    require(isinstance(node, dict), "Node pin object required")
    require(isinstance(node.get("version"), str) and re.fullmatch(major + r"\.\d+\.\d+", node["version"]), "invalid Node version")
    require(digest(node.get("sha256")), "Node archive SHA256 required")
require(p["node20"]["version"] == "20.19.2", "Node20 must be 20.19.2")
require(isinstance(p.get("playwright_version"), str) and re.fullmatch(r"\d+\.\d+\.\d+", p["playwright_version"]), "exact Playwright version required")
require(isinstance(p.get("smoke_image"), str) and re.fullmatch(r"(?:[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?/)*[a-z0-9]+(?:[._-][a-z0-9]+)*@sha256:[a-f0-9]{64}", p["smoke_image"]), "Docker smoke image must use digest without tag")
out = {"DOCKER_KEY_SHA": p["docker_gpg_sha256"], "NODE20_VERSION": p["node20"]["version"], "NODE20_SHA": p["node20"]["sha256"], "NODE22_VERSION": p["node22"]["version"], "NODE22_SHA": p["node22"]["sha256"], "PLAYWRIGHT_VERSION": p["playwright_version"]}
for key, value in out.items(): print(key + "=" + shlex.quote(value))
print("DOCKER_PACKAGES=(" + " ".join(shlex.quote(name + "=" + p["docker_packages"][name]) for name in names) + ")")
PY
}

if [[ "${1:-}" == --validate-pins && $# == 2 ]]; then
  validate_pins "$2"
  exit
fi
[[ $# == 1 && "$1" == --apply ]] || { echo 'Usage: /opt/peticao-toolchain/source/bootstrap.sh --apply' >&2; exit 64; }
[[ $EUID == 0 ]] || { echo 'Root required' >&2; exit 77; }
[[ "$(/bin/hostname -s)" == peticao-azure-dev-01 ]] || { echo 'Wrong hostname' >&2; exit 78; }
source /etc/os-release
[[ "$ID" == debian && "$VERSION_ID" == 13 && "$(/usr/bin/dpkg --print-architecture)" == amd64 ]] || { echo 'Debian 13 amd64 required' >&2; exit 78; }
/usr/bin/python3 -c 'import sys; assert sys.version_info[:2] == (3, 13), "Existing Python 3.13 required"'
/usr/bin/id builder >/dev/null
readonly PIN_VALUES="$(validate_pins "$PINS")"
eval "$PIN_VALUES"

# All task temporary/cache files stay under the project root.
/usr/bin/python3 - <<'RUNTIMEPY'
from pathlib import Path
import os,pwd
root=Path('/mnt/apps/peticao-final/.runtime/azure-dev-toolchain')
for p in [Path('/mnt/apps'),Path('/mnt/apps/peticao-final'),root.parent,root]:
 if p.is_symlink():raise SystemExit('Runtime parent symlink refused')
 p.mkdir(mode=0o755,exist_ok=True)
 if not p.is_dir():raise SystemExit('Runtime parent must be directory')
user=pwd.getpwnam('builder')
for name,mode,uid,gid in [('root-work',0o700,0,0),('npm-cache',0o700,0,0),('builder-work',0o700,user.pw_uid,user.pw_gid),('ms-playwright',0o755,0,0)]:
 p=root/name
 if p.is_symlink():raise SystemExit('Runtime symlink refused')
 p.mkdir(mode=mode,exist_ok=True);os.chown(p,uid,gid);os.chmod(p,mode)
RUNTIMEPY
export TMPDIR="$RUNTIME/root-work"
WORK=$(/usr/bin/mktemp -d "$TMPDIR/bootstrap.XXXXXXXX")
trap '/bin/rm -rf -- "$WORK"' EXIT
/usr/bin/install -d -m 0755 "$BASE" /etc/apt/keyrings
/usr/bin/apt-get update
/usr/bin/apt-get install -y --no-install-recommends ca-certificates curl gnupg xz-utils
/usr/bin/curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 https://download.docker.com/linux/debian/gpg -o "$WORK/docker.asc"
printf '%s  %s\n' "$DOCKER_KEY_SHA" "$WORK/docker.asc" | /usr/bin/sha256sum --check --strict
/usr/bin/gpg --batch --yes --dearmor -o "$WORK/docker.gpg" "$WORK/docker.asc"
/usr/bin/install -m 0644 "$WORK/docker.gpg" /etc/apt/keyrings/peticao-docker.gpg
printf '%s\n' 'deb [arch=amd64 signed-by=/etc/apt/keyrings/peticao-docker.gpg] https://download.docker.com/linux/debian trixie stable' > /etc/apt/sources.list.d/peticao-docker.list
/usr/bin/apt-get update
# Exact versions are mandatory; unavailable pins fail rather than choosing latest.
/usr/bin/apt-get install -y --no-install-recommends "${DOCKER_PACKAGES[@]}"
for package in "${DOCKER_PACKAGES[@]}"; do
  [[ "$(/usr/bin/dpkg-query -W -f='${Version}' "${package%%=*}")" == "${package#*=}" ]]
done

install_node() {
  local name="$1" version="$2" sha="$3" target="$BASE/$1" archive="$WORK/$1.tar.xz"
  if [[ -e "$target" ]]; then
    [[ -f "$target/.archive-sha256" && "$(<"$target/.archive-sha256")" == "$sha" && "$("$target/bin/node" --version)" == "v$version" ]] || { echo "Existing $target does not match pins; refusing replacement" >&2; exit 78; }
    return
  fi
  /usr/bin/curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/v$version/node-v$version-linux-x64.tar.xz" -o "$archive"
  printf '%s  %s\n' "$sha" "$archive" | /usr/bin/sha256sum --check --strict
  /usr/bin/mkdir "$WORK/$name"
  /usr/bin/tar -xJf "$archive" --strip-components=1 --no-same-owner -C "$WORK/$name"
  [[ "$("$WORK/$name/bin/node" --version)" == "v$version" ]]
  printf '%s\n' "$sha" > "$WORK/$name/.archive-sha256"
  /bin/mv "$WORK/$name" "$target"
}
install_node node20 "$NODE20_VERSION" "$NODE20_SHA"
install_node node22 "$NODE22_VERSION" "$NODE22_SHA"
/usr/bin/install -d -m 0755 /usr/local/bin
/bin/ln -sfn "$BASE/node20/bin/node" /usr/local/bin/node
/bin/ln -sfn "$BASE/node20/bin/npm" /usr/local/bin/npm
/bin/cat > /usr/local/bin/node22 <<'SH'
#!/bin/sh
export PATH=/opt/peticao-toolchain/node22/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
exec /opt/peticao-toolchain/node22/bin/node "$@"
SH
/bin/cat > /usr/local/bin/npm22 <<'SH'
#!/bin/sh
export PATH=/opt/peticao-toolchain/node22/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
exec /opt/peticao-toolchain/node22/bin/node /opt/peticao-toolchain/node22/lib/node_modules/npm/bin/npm-cli.js "$@"
SH
/bin/chmod 0755 /usr/local/bin/node22 /usr/local/bin/npm22
/usr/bin/install -d -m 0755 "$BASE/playwright" "$RUNTIME/ms-playwright" "$RUNTIME/npm-cache"
printf '%s\n' '{"name":"peticao-dev-browser-tools","private":true,"version":"1.0.0"}' > "$BASE/playwright/package.json"
export npm_config_userconfig=/dev/null npm_config_cache="$RUNTIME/npm-cache"
export PLAYWRIGHT_BROWSERS_PATH="$RUNTIME/ms-playwright"
/usr/local/bin/npm22 --prefix "$BASE/playwright" install --save-exact --ignore-scripts --no-audit --no-fund "playwright@$PLAYWRIGHT_VERSION"
# Playwright-managed OS dependencies may install/upgrade individual libraries.
# This is deliberately not an apt full-upgrade or distribution upgrade.
/usr/local/bin/node22 "$BASE/playwright/node_modules/playwright/cli.js" install-deps chromium
/usr/local/bin/node22 "$BASE/playwright/node_modules/playwright/cli.js" install chromium
/bin/chmod -R a+rX "$RUNTIME/ms-playwright" "$BASE/playwright"
/usr/bin/systemctl enable --now docker
/usr/sbin/usermod -aG docker builder
printf '%s\n' 'Installed. Docker group grants root-equivalent host access; builder needs a new login.' 'Smoke tests were not run. Run /opt/peticao-toolchain/source/smoke.sh --run as builder after a new login.'
