#!/usr/bin/env bash
# Teste ponta a ponta do tratamento de bounce/reclamação, SEM alterar a configuração do app.
# Envia ao simulador do SES (não afeta a reputação): bounce@, complaint@ e success@simulator.amazonses.com,
# espera os avisos chegarem pelo SNS e mostra o que entrou na lista de bloqueio. Depois apaga as linhas do simulador.
# Uso na VPS:  sudo bash teste-ses.sh     (pede o usuário e a senha SMTP do SES, ocultos; nada é gravado)
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode com sudo: sudo bash $0"; exit 1; }
REGION="${SES_REGION:-sa-east-1}"
CRED=/etc/peticao/creds/ses-smtp.cred
if [ -s "$CRED" ]; then
  J="$(systemd-creds decrypt --name=ses-smtp "$CRED" -)"
  SMTP_USER="$(printf %s "$J" | python3 -c 'import json,sys;print(json.load(sys.stdin)["user"])')"
  SMTP_PASS="$(printf %s "$J" | python3 -c 'import json,sys;print(json.load(sys.stdin)["pass"])')"
  echo "Usando a credencial guardada (criptografada) na VPS."
else
  read -rsp "Nome de usuário SMTP do SES (não aparece): " SMTP_USER; echo
  read -rsp "Senha SMTP do SES (não aparece): " SMTP_PASS; echo
fi
[ -n "$SMTP_USER" ] && [ -n "$SMTP_PASS" ] || { echo "Vazio."; exit 1; }
export SMTP_USER SMTP_PASS REGION
cd /opt/peticao/app
runuser -u peticao -w SMTP_USER,SMTP_PASS,REGION -- node -e '
const nodemailer = require("nodemailer");
const t = nodemailer.createTransport({ host: `email-smtp.${process.env.REGION}.amazonaws.com`, port: 465, secure: true, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
(async () => {
  for (const to of ["success@simulator.amazonses.com", "bounce@simulator.amazonses.com", "complaint@simulator.amazonses.com"]) {
    try {
      const r = await t.sendMail({ from: "Sanção Integral - PLV 12 <assinatura@sancionaintegral.org>", to, subject: "Teste técnico do simulador SES", text: "Teste técnico do simulador do SES." });
      console.log("enviado:", to, "→", r.accepted.length ? "aceito pelo SES" : "RECUSADO");
    } catch (e) { console.log("FALHA:", to, "→", String(e.message).slice(0, 160)); }
  }
})();'
unset SMTP_USER SMTP_PASS
echo "Aguardando os avisos do SES/SNS (30 s)…"; sleep 30
echo "--- Lista de bloqueio (somente endereços do simulador) ---"
runuser -u postgres -- psql -d peticao -c "SELECT email, reason, created_at FROM email_suppressions WHERE email LIKE '%@simulator.amazonses.com' ORDER BY email;"
runuser -u postgres -- psql -d peticao -qc "DELETE FROM email_suppressions WHERE email LIKE '%@simulator.amazonses.com';"
echo "Limpeza feita (linhas do simulador removidas)."
