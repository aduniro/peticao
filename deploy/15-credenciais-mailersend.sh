#!/usr/bin/env bash
# Guarda o token do MailerSend CRIPTOGRAFADO na VPS (systemd-creds), lendo do cofre local, e liga ao serviço do app. Não imprime o token.
# Uso (no seu computador):  bash deploy/15-credenciais-mailersend.sh
set -euo pipefail
ROOTSSH=(ssh -4 -o BatchMode=yes -i "$HOME/.ssh/id_peticao_root" -o IdentitiesOnly=yes root@216.128.169.215)
KEYS="${PETICAO_INFRA_DIR:-$HOME/.config/peticao-infra}/keys.env"
TOK="$(grep -m1 '^MAILERSEND_API_TOKEN=' "$KEYS" | cut -d= -f2-)"
[ -n "$TOK" ] || { echo "Falta MAILERSEND_API_TOKEN no cofre (chave.mjs mailersend)."; exit 1; }
printf '%s' "$TOK" | "${ROOTSSH[@]}" 'systemd-creds encrypt --name=mailersend-api - /etc/peticao/creds/mailersend-api.cred && chmod 600 /etc/peticao/creds/mailersend-api.cred'
"${ROOTSSH[@]}" 'D=/etc/systemd/system/peticao.service.d/credenciais.conf
grep -q "LoadCredentialEncrypted=mailersend-api:" "$D" || echo "LoadCredentialEncrypted=mailersend-api:/etc/peticao/creds/mailersend-api.cred" >> "$D"
systemctl daemon-reload; echo "token do MailerSend gravado (criptografado)."'
