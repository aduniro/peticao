#!/usr/bin/env bash
# Guarda o token do WhatsApp do MailerSend (whatsapp_full) criptografado na VPS, lendo do cofre local. Não imprime o token.
# Uso (no seu computador):  bash deploy/18-credencial-mailersend-whatsapp.sh      (depois: systemctl restart peticao)
set -euo pipefail
ROOTSSH=(ssh -4 -o BatchMode=yes -i "$HOME/.ssh/id_peticao_root" -o IdentitiesOnly=yes root@216.128.169.215)
KEYS="${PETICAO_INFRA_DIR:-$HOME/.config/peticao-infra}/keys.env"
T="$(grep -m1 '^MAILERSEND_WHATSAPP_TOKEN=' "$KEYS" | cut -d= -f2-)"
[ -n "$T" ] || { echo "Falta MAILERSEND_WHATSAPP_TOKEN no cofre (chave.mjs mailersend:whatsapp)."; exit 1; }
printf '%s' "$T" | "${ROOTSSH[@]}" 'systemd-creds encrypt --name=mailersend-whatsapp - /etc/peticao/creds/mailersend-whatsapp.cred && chmod 600 /etc/peticao/creds/mailersend-whatsapp.cred'
"${ROOTSSH[@]}" 'D=/etc/systemd/system/peticao.service.d/credenciais.conf
grep -q "LoadCredentialEncrypted=mailersend-whatsapp:" "$D" || echo "LoadCredentialEncrypted=mailersend-whatsapp:/etc/peticao/creds/mailersend-whatsapp.cred" >> "$D"
systemctl daemon-reload; echo "token do WhatsApp gravado (criptografado)."'
