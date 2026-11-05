#!/usr/bin/env bash
# Guarda o ID e o segredo do SendPulse CRIPTOGRAFADOS na VPS (systemd-creds) e liga ao serviço do app, sem imprimir nada.
# Uso (no seu computador; lê do cofre local e envia por SSH como root):
#   bash deploy/14-credenciais-sendpulse.sh
# O app recebe sendpulse-id e sendpulse-secret só em memória (LoadCredentialEncrypted). Não reinicia o app (use `systemctl restart peticao` depois).
set -euo pipefail
ROOTSSH=(ssh -4 -o BatchMode=yes -i "$HOME/.ssh/id_peticao_root" -o IdentitiesOnly=yes root@216.128.169.215)
KEYS="${PETICAO_INFRA_DIR:-$HOME/.config/peticao-infra}/keys.env"
get() { grep -m1 "^$1=" "$KEYS" | cut -d= -f2-; }
ID="$(get SENDPULSE_CLIENT_ID)"; SEC="$(get SENDPULSE_CLIENT_SECRET)"
[ -n "$ID" ] && [ -n "$SEC" ] || { echo "Faltam SENDPULSE_CLIENT_ID/SECRET no cofre (chave.mjs sendpulse:id e sendpulse:secret)."; exit 1; }
printf '%s' "$ID" | "${ROOTSSH[@]}" 'systemd-creds encrypt --name=sendpulse-id - /etc/peticao/creds/sendpulse-id.cred && chmod 600 /etc/peticao/creds/sendpulse-id.cred'
printf '%s' "$SEC" | "${ROOTSSH[@]}" 'systemd-creds encrypt --name=sendpulse-secret - /etc/peticao/creds/sendpulse-secret.cred && chmod 600 /etc/peticao/creds/sendpulse-secret.cred'
"${ROOTSSH[@]}" 'D=/etc/systemd/system/peticao.service.d/credenciais.conf
for n in sendpulse-id sendpulse-secret; do grep -q "LoadCredentialEncrypted=$n:" "$D" || echo "LoadCredentialEncrypted=$n:/etc/peticao/creds/$n.cred" >> "$D"; done
systemctl daemon-reload; echo "credenciais do SendPulse gravadas (criptografadas). Falta: MAIL_FROM_SENDPULSE e MAIL_PROVIDERS em /etc/peticao/app.env e reiniciar."'
