#!/usr/bin/env bash
# Guarda o token SÓ DE LEITURA de estatísticas da Cloudflare criptografado na VPS (usado pelo painel para contar as respostas recebidas).
# Uso (no seu computador):  bash deploy/17-credencial-cloudflare-analytics.sh
set -euo pipefail
ROOTSSH=(ssh -4 -o BatchMode=yes -i "$HOME/.ssh/id_peticao_root" -o IdentitiesOnly=yes root@216.128.169.215)
KEYS="${PETICAO_INFRA_DIR:-$HOME/.config/peticao-infra}/keys.env"
T="$(grep -m1 '^CLOUDFLARE_ANALYTICS_TOKEN=' "$KEYS" | cut -d= -f2-)"
[ -n "$T" ] || { echo "Falta CLOUDFLARE_ANALYTICS_TOKEN no cofre (chave.mjs cloudflare:analytics)."; exit 1; }
printf '%s' "$T" | "${ROOTSSH[@]}" 'systemd-creds encrypt --name=cloudflare-analytics - /etc/peticao/creds/cloudflare-analytics.cred && chmod 600 /etc/peticao/creds/cloudflare-analytics.cred'
"${ROOTSSH[@]}" 'D=/etc/systemd/system/peticao.service.d/credenciais.conf
grep -q "LoadCredentialEncrypted=cloudflare-analytics:" "$D" || echo "LoadCredentialEncrypted=cloudflare-analytics:/etc/peticao/creds/cloudflare-analytics.cred" >> "$D"
systemctl daemon-reload; echo "token de estatísticas gravado (criptografado). Reinicie: systemctl restart peticao"'
