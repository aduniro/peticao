#!/usr/bin/env bash
# Registra a CHAVE SMTP do Brevo (login + chave) no cofre, com identificação, e valida o login no relay.
# Painel: app.brevo.com > SMTP e API > aba SMTP > Gerar uma nova chave SMTP > nome: peticao-smtp (anote também o "Login", xxxx@smtp-brevo.com)
set -e
C="node /mnt/apps/peticao-final/peticao/tools/infra/chave.mjs"
echo "--- 1/2 Login SMTP (xxxx@smtp-brevo.com)"; $C brevo:smtp-login
echo "--- 2/2 Chave SMTP (peticao-smtp)";       $C brevo:smtp
