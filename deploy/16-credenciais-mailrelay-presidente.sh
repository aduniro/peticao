#!/usr/bin/env bash
# Guarda a chave do Mailrelay da conta sancionapresidente (canal de MARKETING) criptografada na VPS e liga ao serviço. Não imprime a chave.
# Uso (no seu computador):  bash deploy/16-credenciais-mailrelay-presidente.sh
set -euo pipefail
ROOTSSH=(ssh -4 -o BatchMode=yes -i "$HOME/.ssh/id_peticao_root" -o IdentitiesOnly=yes root@216.128.169.215)
KEYS="${PETICAO_INFRA_DIR:-$HOME/.config/peticao-infra}/keys.env"
K="$(grep -m1 '^MAILRELAY_API_KEY=' "$KEYS" | cut -d= -f2-)"
[ -n "$K" ] || { echo "Falta MAILRELAY_API_KEY (conta sancionapresidente) no cofre."; exit 1; }
printf '%s' "$K" | "${ROOTSSH[@]}" 'systemd-creds encrypt --name=mailrelay-presidente-api - /etc/peticao/creds/mailrelay-presidente-api.cred && chmod 600 /etc/peticao/creds/mailrelay-presidente-api.cred'
"${ROOTSSH[@]}" 'D=/etc/systemd/system/peticao.service.d/credenciais.conf
grep -q "LoadCredentialEncrypted=mailrelay-presidente-api:" "$D" || echo "LoadCredentialEncrypted=mailrelay-presidente-api:/etc/peticao/creds/mailrelay-presidente-api.cred" >> "$D"
systemctl daemon-reload; echo "chave do Mailrelay (sancionapresidente) gravada (criptografada)."'
