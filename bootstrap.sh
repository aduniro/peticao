#!/usr/bin/env bash
# Peticao: new Civo development host. No credentials, account login or workload deployment.
set -Eeuo pipefail
umask 077
MODE=plan
TARGET_USER=civo
EXPECTED_HOST=peticao-civo
ROOT=/mnt/apps/peticao-final
NODE_VERSION=22.23.5
NODE_SHA=cdeb8670a0c81f51b4dc4ac61919f9b1ad917b304bf8221eb939570663d240f8
SCW_VERSION=2.66.0
SCW_SHA=4d7891fe42ea4d4507fc50df678e9acc000d00780074fb38618ea69d0789fb14
KUBE_VERSION=1.37.2
KUBE_SHA=c04487523e7aa7d1493f7808174c899db93d7a9cf57531420cd76b9bd415f8f4
AWS_VERSION=2.40.3
die() {
  printf 'ERRO: %s\n' "$*" >&2
  if [[ -n ${RUN_DIR:-} ]]; then
    printf 'status=failed exit=1\n' > "$RUN_DIR/result.txt"
    printf 'ERRO: %s. Log privado: %s/install.log\n' "$*" "$RUN_DIR" >&3
  fi
  exit 1
}
usage() {
  cat <<'EOF'
Uso: bootstrap.sh [--plan | --apply --new-vm] [--user civo]
Alvo: Ubuntu 24.04 LTS amd64, hostname peticao-civo.
Padrao --plan: somente mostra o plano; nenhuma instalacao ou autenticacao.
--apply exige root, --new-vm e o hostname esperado. Instala ferramentas,
Docker/Tailscale e Chromium de QA. Nao altera SSH, usuarios ou senhas.
EOF
}
NEW_VM=0
while (($#)); do
  case "$1" in
    --plan) MODE=plan; shift;;
    --apply) MODE=apply; shift;;
    --new-vm) NEW_VM=1; shift;;
    --user) (($# >= 2)) || die '--user sem valor'; TARGET_USER=$2; shift 2;;
    -h|--help) usage; exit 0;;
    *) die "Opcao desconhecida: $1";;
  esac
done
[[ $TARGET_USER =~ ^[a-z_][a-z0-9_-]*$ && $TARGET_USER != root ]] || die 'Usuario invalido'
if [[ $MODE == plan ]]; then
  usage
  cat <<EOF
Host esperado: $EXPECTED_HOST; usuario existente: $TARGET_USER
Diretorio: $ROOT; logs, downloads, cache e temporarios dentro dele.
Base APT: Git, gh, Python3/venv/pipx, compiladores, bibliotecas PDF/SSL/ICU/XML.
Node host: $NODE_VERSION; Codex 0.169.0; Neon 9.5.0; Playwright 1.62.1 + Chromium.
Python isolado: uv 0.13.8; linode-cli 5.70.0; kaggle 2.2.5 + six; oci-cli 3.96.2.
Cloud: Azure CLI via repositorio Microsoft/noble; AWS $AWS_VERSION (assinatura PGP);
Scaleway $SCW_VERSION; kubectl $KUBE_VERSION (somente cliente, sem cluster/contexto).
Docker Engine/Compose/Buildx via repositorio oficial; Tailscale via repositorio oficial.
Versoes APT serao registradas; nao ha upgrade geral do sistema.
App: Next14/React18/Node20.19.2 do container preservados; nao clona nem instala o app.
Nenhuma senha, chave SSH, token, login, volume, VM ou migracao sera criado.
EOF
  exit 0
fi
[[ $EUID == 0 && $NEW_VM == 1 ]] || die 'Use root e --new-vm somente na VM nova'
[[ $(hostname -s) == "$EXPECTED_HOST" ]] || die "Hostname deve ser $EXPECTED_HOST"
# shellcheck disable=SC1091
source /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 && ${VERSION_CODENAME:-} == noble ]] || die 'Exige Ubuntu 24.04 LTS (noble)'
[[ $(dpkg --print-architecture) == amd64 ]] || die 'Este bundle foi validado para amd64'
id "$TARGET_USER" >/dev/null 2>&1 || die 'Usuario precisa existir; nao sera criado'
TARGET_HOME=$(getent passwd "$TARGET_USER" | cut -d: -f6)
TARGET_GROUP=$(id -gn "$TARGET_USER")
[[ $TARGET_HOME == /home/"$TARGET_USER" && -d $TARGET_HOME && ! -L $TARGET_HOME ]] || die 'Home inesperada'
[[ ! -e $TARGET_HOME/.peticao-host-env.sh && ! -L $TARGET_HOME/.peticao-host-env.sh ]] || die 'Bootstrap ja configurou ambiente; revisar logs antes de repetir'
for path in /srv/admin-v2-coordinator /var/lib/rancher/k3s "$ROOT/peticao-release"; do
  [[ ! -e $path ]] || die "Host possui workload existente: $path"
done
# Refuse symlinks before creating root-owned paths; do not recursively chown project data.
for path in /mnt /mnt/apps "$ROOT" "$ROOT/_ops" "$ROOT/_ops/bootstrap-host" "$ROOT/.tools"; do
  [[ ! -L $path ]] || die "Caminho simbolico recusado: $path"
done
install -d -m 0755 /mnt/apps "$ROOT" "$ROOT/_ops"
install -d -m 0700 "$ROOT/_ops/bootstrap-host"
RUN_DIR=$(mktemp -d "$ROOT/_ops/bootstrap-host/run-XXXXXXXX")
exec 3>&1
exec >> "$RUN_DIR/install.log" 2>&1
progress() { printf '%s\n' "$*" >&3; }
on_error() {
  local rc=$1 line=$2
  printf 'status=failed exit=%s line=%s\n' "$rc" "$line" > "$RUN_DIR/result.txt"
  progress "Falha na linha $line (codigo $rc). Log privado: $RUN_DIR/install.log"
  exit "$rc"
}
trap 'on_error "$?" "$LINENO"' ERR
exec 9>"$ROOT/_ops/bootstrap-host/install.lock"
flock -n 9 || die 'Outro bootstrap esta executando'
export DEBIAN_FRONTEND=noninteractive
export TMPDIR="$RUN_DIR/tmp"
install -d -m 0700 "$TMPDIR"
USER_STATE="$ROOT/.tools/host-$TARGET_USER"
[[ ! -L $USER_STATE ]] || die 'Estado de usuario simbolico'
install -d -m 0755 "$ROOT/.tools"
install -d -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0700 "$USER_STATE"
for sub in cache tmp npm playwright; do
  [[ ! -L $USER_STATE/$sub ]] || die 'Cache simbolico'
  install -d -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0700 "$USER_STATE/$sub"
done
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
as_user() {
  runuser -u "$TARGET_USER" -- env \
    PATH="$TARGET_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin" \
    XDG_CACHE_HOME="$USER_STATE/cache" TMPDIR="$USER_STATE/tmp" \
    PIP_CACHE_DIR="$USER_STATE/cache/pip" npm_config_cache="$USER_STATE/cache/npm" \
    PLAYWRIGHT_BROWSERS_PATH="$USER_STATE/playwright" "$@"
}
download() { curl --proto '=https' --tlsv1.2 --fail --show-error --silent --location --retry 3 --connect-timeout 20 --max-time 600 "$1" -o "$2"; }
verify() { printf '%s  %s\n' "$1" "$2" | sha256sum -c -; }
apt_install() { apt-get -o DPkg::Lock::Timeout=180 install -y --no-install-recommends "$@"; }
printf 'Inicio UTC: %s; alvo %s / %s\n' "$(date -u +%FT%TZ)" "$EXPECTED_HOST" "$TARGET_USER"
progress '1/7 Instalando base do Ubuntu e bibliotecas de desenvolvimento...'
apt-get -o DPkg::Lock::Timeout=180 update
apt_install ca-certificates curl gnupg git gh openssh-client rsync tmux jq unzip zip xz-utils \
  sqlite3 postgresql-client zstd acl lsof iproute2 dnsutils ripgrep sudo \
  build-essential pkg-config python3 python3-dev python3-venv python3-pip pipx python3-requests python3-httpx python3-yaml \
  libssl-dev libffi-dev libicu-dev libxml2-dev libxslt1-dev liblz4-1 libzstd1 \
  libreadline-dev zlib1g-dev fonts-dejavu-core fonts-liberation poppler-utils groff less
install -d -m 0755 /etc/apt/keyrings /opt/peticao /usr/local/bin
progress '2/7 Instalando Node LTS separado do runtime do app...'
NODE_DIR=/opt/peticao/node-v$NODE_VERSION
if [[ -e $NODE_DIR ]]; then
  [[ -x $NODE_DIR/bin/node && $($NODE_DIR/bin/node --version) == v$NODE_VERSION ]] || die 'Node existente diverge'
else
  archive="$RUN_DIR/node.tar.xz"
  download "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz" "$archive"
  verify "$NODE_SHA" "$archive"
  install -d "$NODE_DIR"
  tar -xJf "$archive" --strip-components=1 -C "$NODE_DIR"
fi
for cmd in node npm npx corepack; do
  [[ -e $NODE_DIR/bin/$cmd ]] || continue
  if [[ -e /usr/local/bin/$cmd || -L /usr/local/bin/$cmd ]]; then
    [[ $(readlink -f /usr/local/bin/"$cmd") == "$(readlink -f "$NODE_DIR/bin/$cmd")" ]] || die "Binario existente: $cmd"
  else ln -s "$NODE_DIR/bin/$cmd" /usr/local/bin/"$cmd"; fi
done
# Fresh VM only: never remove another Docker/containerd installation.
progress '3/7 Instalando Docker, Tailscale e Azure CLI pelos repositorios oficiais...'
if ! command -v docker >/dev/null; then
  for pkg in docker.io podman-docker containerd runc; do
    if dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q 'install ok installed'; then
      die "Conflito Docker: $pkg; revisar manualmente"
    fi
  done
  download https://download.docker.com/linux/ubuntu/gpg "$RUN_DIR/docker.asc"
  install -m 0644 "$RUN_DIR/docker.asc" /etc/apt/keyrings/peticao-docker.asc
  printf 'deb [arch=amd64 signed-by=/etc/apt/keyrings/peticao-docker.asc] https://download.docker.com/linux/ubuntu noble stable\n' > /etc/apt/sources.list.d/peticao-docker.list
  apt-get -o DPkg::Lock::Timeout=180 update
  apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
if ! command -v tailscale >/dev/null; then
  download https://pkgs.tailscale.com/stable/ubuntu/noble.noarmor.gpg "$RUN_DIR/tailscale.gpg"
  install -m 0644 "$RUN_DIR/tailscale.gpg" /etc/apt/keyrings/peticao-tailscale.gpg
  printf 'deb [signed-by=/etc/apt/keyrings/peticao-tailscale.gpg] https://pkgs.tailscale.com/stable/ubuntu noble main\n' > /etc/apt/sources.list.d/peticao-tailscale.list
  apt-get -o DPkg::Lock::Timeout=180 update
  apt_install tailscale
fi
# Microsoft explicitly supports noble. Do not use Debian/bookworm repositories here.
if ! command -v az >/dev/null; then
  download https://packages.microsoft.com/keys/microsoft.asc "$RUN_DIR/microsoft.asc"
  gpg --batch --yes --dearmor -o "$RUN_DIR/microsoft.gpg" "$RUN_DIR/microsoft.asc"
  install -m 0644 "$RUN_DIR/microsoft.gpg" /etc/apt/keyrings/peticao-microsoft.gpg
  printf 'deb [arch=amd64 signed-by=/etc/apt/keyrings/peticao-microsoft.gpg] https://packages.microsoft.com/repos/azure-cli/ noble main\n' > /etc/apt/sources.list.d/peticao-azure-cli.list
  apt-get -o DPkg::Lock::Timeout=180 update
  apt_install azure-cli
fi
install -d -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0755 "$TARGET_HOME/.local" "$TARGET_HOME/.local/bin"
progress '4/7 Instalando CLIs isoladas do usuario...'
as_user npm install --global --prefix "$TARGET_HOME/.local" @openai/codex@0.169.0 neon@9.5.0
for spec in uv==0.13.8 linode-cli==5.70.0 kaggle==2.2.5 oci-cli==3.96.2; do
  as_user pipx install --python /usr/bin/python3 "$spec"
done
as_user pipx inject kaggle six==1.17.0
progress '5/7 Verificando e instalando AWS, Scaleway e kubectl...'
if ! command -v aws >/dev/null; then
  # Public verification key only. This is not an API key or SSH key.
  cat > "$RUN_DIR/aws-cli-team.asc" <<'PETICAO_AWS_PUBLIC_KEY'
-----BEGIN PGP PUBLIC KEY BLOCK-----

mQINBF2Cr7UBEADJZHcgusOJl7ENSyumXh85z0TRV0xJorM2B/JL0kHOyigQluUG
ZMLhENaG0bYatdrKP+3H91lvK050pXwnO/R7fB/FSTouki4ciIx5OuLlnJZIxSzx
PqGl0mkxImLNbGWoi6Lto0LYxqHN2iQtzlwTVmq9733zd3XfcXrZ3+LblHAgEt5G
TfNxEKJ8soPLyWmwDH6HWCnjZ/aIQRBTIQ05uVeEoYxSh6wOai7ss/KveoSNBbYz
gbdzoqI2Y8cgH2nbfgp3DSasaLZEdCSsIsK1u05CinE7k2qZ7KgKAUIcT/cR/grk
C6VwsnDU0OUCideXcQ8WeHutqvgZH1JgKDbznoIzeQHJD238GEu+eKhRHcz8/jeG
94zkcgJOz3KbZGYMiTh277Fvj9zzvZsbMBCedV1BTg3TqgvdX4bdkhf5cH+7NtWO
lrFj6UwAsGukBTAOxC0l/dnSmZhJ7Z1KmEWilro/gOrjtOxqRQutlIqG22TaqoPG
fYVN+en3Zwbt97kcgZDwqbuykNt64oZWc4XKCa3mprEGC3IbJTBFqglXmZ7l9ywG
EEUJYOlb2XrSuPWml39beWdKM8kzr1OjnlOm6+lpTRCBfo0wa9F8YZRhHPAkwKkX
XDeOGpWRj4ohOx0d2GWkyV5xyN14p2tQOCdOODmz80yUTgRpPVQUtOEhXQARAQAB
tCFBV1MgQ0xJIFRlYW0gPGF3cy1jbGlAYW1hem9uLmNvbT6JAlQEEwEIAD4CGwMF
CwkIBwIGFQoJCAsCBBYCAwECHgECF4AWIQT7Xbd/1cEYuAURraimMQrMRnJHXAUC
akV0ygUJDqP4lQAKCRCmMQrMRnJHXFHjD/9eyZLYcKuQOlLvtqSDtUBiEZf6ZZjM
i3ygYH8rJNtuToUH+HvSpe819urJCquXhDrlK6N+aqW0hCLtNABJG/vsafIgvIYJ
hSGgpgtNnQyMV1jViRWqPjbouw8OkYKBThUfT1i2Y+wn58ifs6ODBCmTexWtXspA
Si+Gt49xDOW0APmbOPnI+a4HJW6tVEo6MWS0WjzpiBayR3d1A4pt4YrPfSdDgpLo
h2SLQqlRqvvVZJaWBjhkErNFpfsBA06sDcPEOb0G8LBUbR4WOcdvhe5LubJbZuxC
AG9kNPCVeQP1ixwjgjXKysaxeQ6rv0VzIQgRp6tLVLWhy6AKDNvLjFSsmXZ1Wl08
Y/RlOHXlzLuQMRE6sR1wOdRxc9TsrNWTGiBK65cvSWOy03JeBkQQ8pesqltiyxI9
U21kkgiXtTSKNGfKK8pO27D81YANhRqPK7iTp6kuFiY2WtOg90KTMNlIT+Ff85Y2
b1rHj6Z0SrCkJujhWk3IBPic/wJgz01LEc/OAdUPlby90RJZcIBhSlWhT7mXnXIO
c0HWlNQrns2s3CTyYwZSiSlYe9ApeLwhjDo8NhbFuCAy61l6O5UsR4AfZxx/rGKv
2wFb1/RN/P4gNe6vmxZAPjR0AQcwD3tc2McimOLr/22kmPz8IH3I0X7WoSFr0Biz
E91G7bb0hOb/cA==
=knv7
-----END PGP PUBLIC KEY BLOCK-----
PETICAO_AWS_PUBLIC_KEY
  download "https://awscli.amazonaws.com/awscli-exe-linux-x86_64-$AWS_VERSION.zip" "$RUN_DIR/aws.zip"
  download "https://awscli.amazonaws.com/awscli-exe-linux-x86_64-$AWS_VERSION.zip.sig" "$RUN_DIR/aws.zip.sig"
  install -d -m 0700 "$RUN_DIR/gnupg"
  fingerprint=$(gpg --homedir "$RUN_DIR/gnupg" --batch --with-colons --import-options show-only --import "$RUN_DIR/aws-cli-team.asc" 2>/dev/null | awk -F: '$1=="fpr"{print $10;exit}')
  [[ $fingerprint == FB5DB77FD5C118B80511ADA8A6310ACC4672475C ]] || die 'Fingerprint da chave publica AWS diverge'
  gpg --homedir "$RUN_DIR/gnupg" --batch --import "$RUN_DIR/aws-cli-team.asc"
  gpg --homedir "$RUN_DIR/gnupg" --batch --verify "$RUN_DIR/aws.zip.sig" "$RUN_DIR/aws.zip"
  unzip -q "$RUN_DIR/aws.zip" -d "$RUN_DIR/aws-unpacked"
  "$RUN_DIR/aws-unpacked/aws/install" --install-dir /opt/peticao/aws-cli --bin-dir /usr/local/bin
fi
for name in scw kubectl; do
  if command -v "$name" >/dev/null; then continue; fi
  if [[ $name == scw ]]; then
    download "https://github.com/scaleway/scaleway-cli/releases/download/v$SCW_VERSION/scaleway-cli_${SCW_VERSION}_linux_amd64" "$RUN_DIR/$name"
    verify "$SCW_SHA" "$RUN_DIR/$name"
  else
    download "https://dl.k8s.io/release/v$KUBE_VERSION/bin/linux/amd64/kubectl" "$RUN_DIR/$name"
    verify "$KUBE_SHA" "$RUN_DIR/$name"
  fi
  install -m 0755 "$RUN_DIR/$name" /usr/local/bin/"$name"
done
# Isolated QA toolchain: no npm install, migrations or edits inside the app.
progress '6/7 Preparando Playwright e Chromium para QA...'
QA_DIR="$USER_STATE/qa"
[[ ! -L $QA_DIR ]] || die 'QA dir simbolico'
install -d -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0700 "$QA_DIR"
as_user npm install --prefix "$QA_DIR" --save-exact playwright@1.62.1
node "$QA_DIR/node_modules/playwright/cli.js" install-deps chromium
as_user node "$QA_DIR/node_modules/playwright/cli.js" install chromium
ENV_FILE="$TARGET_HOME/.peticao-host-env.sh"
[[ ! -e $ENV_FILE && ! -L $ENV_FILE ]] || die 'Arquivo de ambiente existe; revisar antes de substituir'
cat > "$ENV_FILE" <<EOF
# Gerado pelo bootstrap; sem credenciais. Carregar com source neste usuario.
export PATH="\$HOME/.local/bin:/usr/local/bin:\$PATH"
export XDG_CACHE_HOME="$USER_STATE/cache"
export TMPDIR="$USER_STATE/tmp"
export PIP_CACHE_DIR="$USER_STATE/cache/pip"
export npm_config_cache="$USER_STATE/cache/npm"
export PLAYWRIGHT_BROWSERS_PATH="$USER_STATE/playwright"
export QA_PLAYWRIGHT_MODULE="$QA_DIR/node_modules/playwright/index.mjs"
export QA_CHROMIUM="$(as_user node -e "console.log(require('$QA_DIR/node_modules/playwright').chromium.executablePath())")"
EOF
chown "$TARGET_USER:$TARGET_GROUP" "$ENV_FILE"
chmod 0600 "$ENV_FILE"
# Login shell hook only; do not rewrite existing shell setup.
PROFILE="$TARGET_HOME/.profile"
[[ ! -L $PROFILE ]] || die '.profile simbolico'
touch "$PROFILE"
if ! grep -Fq '.peticao-host-env.sh' "$PROFILE"; then
  # shellcheck disable=SC2016
  printf '\n[ ! -f "$HOME/.peticao-host-env.sh" ] || . "$HOME/.peticao-host-env.sh"\n' >> "$PROFILE"
fi
chown "$TARGET_USER:$TARGET_GROUP" "$PROFILE"
progress '7/7 Conferindo versoes e executando smoke local do Chromium...'
{
  printf 'host=%s\nuser=%s\n' "$EXPECTED_HOST" "$TARGET_USER"
  node --version; npm --version; git --version; gh --version
  python3 --version; pipx --version; docker --version; docker compose version
  tailscale version; az version; aws --version; scw version; kubectl version --client=true
  as_user codex --version; as_user neon --version; as_user uv --version
  as_user linode-cli --version; as_user kaggle --version; as_user oci --version
  as_user pipx list --json
  dpkg-query -W -f='${binary:Package}\t${Version}\n'
} > "$RUN_DIR/versions.txt" 2>&1
# Browser smoke: no network, real isolated Chromium rendered a local document.
as_user node - "$QA_DIR/node_modules/playwright" <<'JS'
const {chromium} = require(process.argv[2]);
(async()=>{const browser=await chromium.launch({headless:true});
try {const page=await browser.newPage();await page.setContent('<title>peticao-bootstrap-ok</title>');
if(await page.title()!=='peticao-bootstrap-ok')throw Error('Chromium smoke failed');
console.log('CHROMIUM_SMOKE=PASS');}finally{await browser.close();}})().catch(e=>{console.error(e.message);process.exitCode=1});
JS
printf 'status=installed\ncloud_auth=not_configured\napp=not_deployed\n' > "$RUN_DIR/result.txt"
progress "Concluido. Versoes e log privados: $RUN_DIR"
progress 'Nao foram feitas autenticacoes nem deploy.'
