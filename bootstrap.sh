#!/bin/bash
# Execute manually through the separately approved SSH/sudo procedure.
set -Eeuo pipefail
umask 077

if [[ "${EUID}" -ne 0 ]]; then
  printf 'Bootstrap requires sudo/root.\n' >&2
  exit 1
fi

readonly LOG_FILE=/var/log/peticao-azure-bootstrap.log
if [[ -L "${LOG_FILE}" ]] || { [[ -e "${LOG_FILE}" ]] && [[ ! -f "${LOG_FILE}" ]]; }; then
  printf 'Unsafe bootstrap log path.\n' >&2
  exit 1
fi
/usr/bin/touch -- "${LOG_FILE}"
/usr/bin/chown root:root -- "${LOG_FILE}"
/usr/bin/chmod 0600 -- "${LOG_FILE}"
exec 3>&1 4>&2
exec >>"${LOG_FILE}" 2>&1
trap 'code=$?; printf "Bootstrap failed (exit %s); log retained: %s\n" "$code" "$LOG_FILE" >&4; exit "$code"' ERR

[[ "$(/usr/bin/hostname -s)" == peticao-azure-dev-01 ]]
# shellcheck source=/etc/os-release
source /etc/os-release
[[ "${ID}" == debian && "${VERSION_ID}" == 13 ]]
[[ "$(/usr/bin/dpkg --print-architecture)" == amd64 ]]

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=l
/usr/bin/apt-get update
/usr/bin/apt-get install --yes --no-upgrade --no-install-recommends \
  git gh git-lfs python3 python3-venv curl ca-certificates gnupg jq

# The official Debian trixie package source installs the service only.
# No authentication, overlay enrollment or SSH service configuration is performed.
readonly TAILSCALE_KEY=/usr/share/keyrings/tailscale-archive-keyring.gpg
readonly TAILSCALE_LIST=/etc/apt/sources.list.d/tailscale.list
/usr/bin/curl --fail --silent --show-error --location \
  https://pkgs.tailscale.com/stable/debian/trixie.noarmor.gpg \
  --output "${TAILSCALE_KEY}"
/usr/bin/curl --fail --silent --show-error --location \
  https://pkgs.tailscale.com/stable/debian/trixie.tailscale-keyring.list \
  --output "${TAILSCALE_LIST}"
/usr/bin/chmod 0644 -- "${TAILSCALE_KEY}" "${TAILSCALE_LIST}"
/usr/bin/apt-get update
/usr/bin/apt-get install --yes --no-upgrade --no-install-recommends tailscale

{
  /usr/bin/git --version
  /usr/bin/gh --version
  /usr/bin/git-lfs version
  /usr/bin/python3 --version
  /usr/bin/curl --version
  /usr/bin/gpg --version
  /usr/bin/jq --version
  /usr/bin/tailscale version
  /usr/bin/dpkg-query --show --showformat='${Package} ${Version}\n' ca-certificates python3-venv
  printf 'PETICAO_AZURE_BOOTSTRAP_COMPLETE\n'
} >&3 2>&4
