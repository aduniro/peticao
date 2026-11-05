#!/usr/bin/env bash
# Grava/atualiza UMA variável de /etc/peticao/app.env sem mostrar o valor (digitação oculta).
# Uso na VPS:  sudo bash definir-segredo.sh CPF_BRASIL_API_KEY
# Nomes úteis: CPF_BRASIL_API_KEY TURNSTILE_SECRET_KEY TURNSTILE_SITE_KEY SMTP_URL BREVO_API_KEY MAIL_PROVIDER MAIL_FROM
#              APP_URL ALLOWED_HOSTS RECIPIENTS ADMIN_PASSWORD COVER_CHOICE
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode com sudo: sudo bash $0 NOME"; exit 1; }
NAME="${1:-}"; ENV_FILE=/etc/peticao/app.env
[[ "$NAME" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "Uso: sudo bash $0 NOME_DA_VARIAVEL (maiúsculas, números e _)"; exit 1; }
[ "$NAME" != HASH_PEPPER ] || [ "${FORCE_PEPPER:-}" = sim ] || { echo "Recusado: trocar HASH_PEPPER invalida todos os CPFs já gravados."; exit 1; }
read -rsp "Valor de $NAME (não aparece na tela): " VAL; echo
[ -n "$VAL" ] || { echo "Vazio: nada alterado."; exit 1; }
case "$VAL" in *\'*|*$'\n'*) echo "O valor não pode ter aspas simples nem quebra de linha."; exit 1;; esac
tmp="$(mktemp)"; grep -v "^$NAME=" "$ENV_FILE" > "$tmp" || true
printf "%s='%s'\n" "$NAME" "$VAL" >> "$tmp"
install -m 640 -o root -g peticao "$tmp" "$ENV_FILE"; rm -f "$tmp"
echo "$NAME gravado em $ENV_FILE ($(printf %s "$VAL" | wc -c) caracteres). Para valer: sudo systemctl restart peticao"
