#!/usr/bin/env bash
# Configura o envio de e-mail pelo Amazon SES (SMTP) em /etc/peticao/app.env, sem mostrar as credenciais.
# Uso na VPS:  sudo bash definir-smtp-ses.sh
# Pede (digitação oculta) o usuário e a senha SMTP do SES (opção 1) ou a Access key + Secret de um usuário IAM (opção 2, senha derivada aqui).
# Grava SMTP_URL, MAIL_PROVIDER=smtp e MAIL_FROM. Depois: sudo systemctl restart peticao
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode com sudo: sudo bash $0"; exit 1; }
ENV_FILE=/etc/peticao/app.env
REGION="${SES_REGION:-sa-east-1}"
FROM="${MAIL_FROM_VALUE:-Sanção Integral - PLV 12 <assinatura@sancionaintegral.org>}"
echo "Qual credencial você tem?"
echo "  1) Nome de usuário SMTP + Senha SMTP (assistente 'Criar credenciais do IAM' do SES)  [padrão]"
echo "  2) Access key ID + Secret access key de um usuário IAM (a senha SMTP é derivada aqui)"
read -rp "Opção [1]: " OPT; OPT="${OPT:-1}"
if [ "$OPT" = 2 ]; then
  read -rsp "Access key ID (não aparece): " U; echo
  read -rsp "Secret access key (não aparece): " SK; echo
else
  read -rsp "Nome de usuário SMTP (não aparece): " U; echo
  read -rsp "Senha SMTP (não aparece): " P; echo
fi
[ -n "$U" ] || { echo "Vazio: nada alterado."; exit 1; }
[[ "$U" =~ ^[A-Z0-9]{16,}$ ]] || { echo "O usuário/Access key ID deve ter só maiúsculas e números (começa com AKIA). Confira."; exit 1; }
case "${U}${SK:-}${P:-}" in *\'*|*$'\n'*|*' '*) echo "Credencial com aspas, espaço ou quebra de linha: confira o que copiou."; exit 1;; esac
if [ "$OPT" = 2 ]; then
  [ -n "${SK:-}" ] || { echo "Secret vazia: nada alterado."; exit 1; }
  export SK REGION
  P="$(python3 - <<'PY'
import os, hmac, hashlib, base64
sk, region = os.environ["SK"], os.environ["REGION"]
def sign(key, msg): return hmac.new(key, msg.encode(), hashlib.sha256).digest()
sig = sign(("AWS4" + sk).encode(), "11111111")
for part in (region, "ses", "aws4_request", "SendRawEmail"):
    sig = sign(sig, part)
print(base64.b64encode(bytes([0x04]) + sig).decode())
PY
)"
  unset SK
fi
[ -n "${P:-}" ] || { echo "Senha vazia: nada alterado."; exit 1; }
export U P
URL="smtps://$(python3 -c 'import os,urllib.parse as u;print(u.quote(os.environ["U"],safe=""))'):$(python3 -c 'import os,urllib.parse as u;print(u.quote(os.environ["P"],safe=""))')@email-smtp.${REGION}.amazonaws.com:465"
unset P
tmp="$(mktemp)"; grep -vE '^(SMTP_URL|MAIL_PROVIDER|MAIL_FROM)=' "$ENV_FILE" > "$tmp" || true
printf "SMTP_URL='%s'\nMAIL_PROVIDER='smtp'\nMAIL_FROM='%s'\n" "$URL" "$FROM" >> "$tmp"
install -m 640 -o root -g peticao "$tmp" "$ENV_FILE"; rm -f "$tmp"
echo "SES configurado (host email-smtp.${REGION}.amazonaws.com, remetente: $FROM)."
echo "Para valer: sudo systemctl restart peticao"
