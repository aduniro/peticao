#!/usr/bin/env bash
# Registra a CHAVE API v3 do Brevo (controle total: domínios, remetentes, envio) no cofre, com identificação, e valida.
# Painel: app.brevo.com > SMTP e API > Chaves de API > Gerar uma nova chave de API > nome: peticao-api
exec node /mnt/dev/peticao/tools/infra/chave.mjs brevo
