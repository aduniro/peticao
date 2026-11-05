#!/usr/bin/env bash
# Libera SSH de ROOT por chave (somente a chave dedicada do notebook; sem senha). Idempotente.
# O firewall da Vultr continua limitando QUEM chega na porta 22 (só o seu IP). A chave privada nunca sai do notebook.
# Uso na VPS (como root):  bash 09-acesso-root.sh             (liberar)
#                          bash 09-acesso-root.sh --revogar    (remover por completo)
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode como root (sudo bash $0)."; exit 1; }
PUB='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDx3J1rqiPdD1xhBg16occfydB/NKt/eYmirrhJ6lyrA claude-root@zorin (acesso root via tailnet)'
MARK='claude-root@zorin'
AK=/root/.ssh/authorized_keys
DROP=/etc/ssh/sshd_config.d/90-root-chave.conf
remove_all() {
  [ -f "$AK" ] && { grep -v "$MARK" "$AK" > "$AK.new" || true; install -m 600 "$AK.new" "$AK"; rm -f "$AK.new"; }
  rm -f "$DROP" /etc/ssh/sshd_config.d/90-root-tailnet.conf
}
if [ "${1:-}" = "--revogar" ]; then remove_all; sshd -t && systemctl reload ssh; echo "Acesso root por chave REVOGADO."; exit 0; fi
install -d -m 700 /root/.ssh; touch "$AK"; chmod 600 "$AK"
sed -i "/$MARK/d" "$AK"   # troca a linha antiga (inclui a versão com restrição de tailnet)
printf 'no-agent-forwarding,no-port-forwarding,no-X11-forwarding %s\n' "$PUB" >> "$AK"
rm -f /etc/ssh/sshd_config.d/90-root-tailnet.conf
# Garante root só por chave (nunca por senha), qualquer que seja o padrão do sistema.
printf 'PermitRootLogin prohibit-password\n' > "$DROP"; chmod 644 "$DROP"
if ! sshd -t; then echo "sshd_config inválido: revertendo."; remove_all; exit 1; fi
sshd -T | grep -E '^(permitrootlogin|passwordauthentication) ' | sed 's/^/  efetivo: /'
systemctl reload ssh
echo "OK. Root liberado por chave. Para desfazer:  bash 09-acesso-root.sh --revogar"
