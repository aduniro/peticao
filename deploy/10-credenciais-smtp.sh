#!/usr/bin/env bash
# Guarda a credencial SMTP do Amazon SES CRIPTOGRAFADA na VPS (systemd-creds, chave do próprio servidor) e valida o login no SES.
# O app a recebe só em memória, pelo systemd (LoadCredentialEncrypted); nada de senha em texto puro em disco.
# Uso (como root na VPS):
#   bash 10-credenciais-smtp.sh              pede usuário e senha (ocultos), VALIDA no SES e só então grava criptografado
#   bash 10-credenciais-smtp.sh --validar    decifra a credencial guardada e testa o login no SES (sem digitar nada)
#   bash 10-credenciais-smtp.sh --ativar     passa o app a enviar pelo SES (MAIL_PROVIDER=smtp)
#   bash 10-credenciais-smtp.sh --desativar  volta o app para a caixa de saída local (MAIL_PROVIDER=dev)
#   bash 10-credenciais-smtp.sh --remover    apaga a credencial guardada
# Nota: quem é root na máquina sempre consegue decifrar; a criptografia protege cópias de disco, backups e vazamentos de arquivos.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode como root (sudo bash $0)."; exit 1; }
REGION="${SES_REGION:-sa-east-1}"; HOST="email-smtp.$REGION.amazonaws.com"
DIR=/etc/peticao/creds; CRED=$DIR/ses-smtp.cred; DROP=/etc/systemd/system/peticao.service.d/credenciais.conf; ENVF=/etc/peticao/app.env
FROM_VALUE="${MAIL_FROM_VALUE:-Sanção Integral - PLV 12 <assinatura@sancionaintegral.org>}"

set_var() { local tmp; tmp="$(mktemp)"; grep -v "^$1=" "$ENVF" > "$tmp" || true; printf "%s='%s'\n" "$1" "$2" >> "$tmp"; install -m 640 -o root -g peticao "$tmp" "$ENVF"; rm -f "$tmp"; }

# Testa usuário+senha no servidor SMTP do SES (só autentica; não envia e-mail). Lê U e P do ambiente.
check_login() {
  U="$1" P="$2" HOST="$HOST" python3 - <<'PY'
import os, smtplib, sys
try:
    s = smtplib.SMTP_SSL(os.environ["HOST"], 465, timeout=20)
    s.login(os.environ["U"], os.environ["P"]); s.quit()
    print("LOGIN OK: o SES aceitou o usuário e a senha SMTP.")
except smtplib.SMTPAuthenticationError as e:
    print(f"LOGIN RECUSADO pelo SES ({e.smtp_code}): usuário ou senha SMTP errados, ou credencial de outra região/conta."); sys.exit(2)
except Exception as e:
    print(f"Não foi possível testar ({type(e).__name__}: {e}). Confira a rede/porta 465."); sys.exit(3)
PY
}

decrypt() { systemd-creds decrypt --name=ses-smtp "$CRED" - ; }
field() { python3 -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$1"; }

case "${1:-}" in
  --validar)
    [ -s "$CRED" ] || { echo "Nenhuma credencial guardada. Rode sem argumentos para gravar."; exit 1; }
    J="$(decrypt)"; check_login "$(printf %s "$J" | field user)" "$(printf %s "$J" | field pass)"; exit $? ;;
  --ativar)
    [ -s "$CRED" ] || { echo "Grave a credencial primeiro (rode sem argumentos)."; exit 1; }
    J="$(decrypt)"; check_login "$(printf %s "$J" | field user)" "$(printf %s "$J" | field pass)" || { echo "Não ativei: o login não validou."; exit 2; }
    set_var MAIL_PROVIDER smtp; set_var MAIL_FROM "$FROM_VALUE"; systemctl restart peticao
    echo "ATIVADO: o app envia pelo SES como: $FROM_VALUE"
    echo "Atenção: em sandbox o SES só entrega a endereços verificados; ative para o público só com a produção liberada."; exit 0 ;;
  --desativar)
    set_var MAIL_PROVIDER dev; systemctl restart peticao; echo "DESATIVADO: o app volta a guardar os e-mails na caixa de saída local (dev)."; exit 0 ;;
  --remover)
    rm -f "$CRED" "$DROP"; systemctl daemon-reload; set_var MAIL_PROVIDER dev; systemctl restart peticao
    echo "Credencial removida e envio desativado (dev)."; exit 0 ;;
  "") ;;
  *) echo "Opção desconhecida: $1"; exit 1 ;;
esac

read -rsp "Nome de usuário SMTP do SES (não aparece): " U; echo
read -rsp "Senha SMTP do SES (não aparece): " P; echo
[ -n "$U" ] && [ -n "$P" ] || { echo "Vazio: nada alterado."; exit 1; }
case "$U$P" in *' '*|*$'\n'*|*\'*|*\"*) echo "Credencial com espaço, aspas ou quebra de linha: confira o que copiou."; exit 1;; esac
[[ "$U" =~ ^[A-Z0-9]{16,}$ ]] || { echo "O usuário SMTP deve ter só maiúsculas e números (começa com AKIA). Confira: não é a Secret key nem a senha do console."; exit 1; }
echo "Validando no SES…"
check_login "$U" "$P" || { echo "Nada foi gravado."; exit 2; }

install -d -m 700 "$DIR"
[ -e /var/lib/systemd/credential.secret ] || systemd-creds setup >/dev/null
U="$U" P="$P" python3 -c 'import json,os; print(json.dumps({"user":os.environ["U"],"pass":os.environ["P"]}))' | systemd-creds encrypt --name=ses-smtp - "$CRED"
chmod 600 "$CRED"; unset U P
install -d /etc/systemd/system/peticao.service.d
printf '[Service]\nLoadCredentialEncrypted=ses-smtp:%s\n' "$CRED" > "$DROP"
systemctl daemon-reload; systemctl restart peticao
echo "Credencial gravada CRIPTOGRAFADA em $CRED e entregue ao app pelo systemd."
echo "Para trocar o app para envio real:  bash $0 --ativar     |  para revalidar a qualquer hora:  bash $0 --validar"
