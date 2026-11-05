#!/usr/bin/env bash
# Grava no cofre a CHAVE de API do Mailrelay associada ao domínio sancionaintegral.org (identificada no comentário).
# Conta cadastrada com o e-mail admin@sancionaintegral.org. O endereço da conta (algo.ipzmarketing.com) é descoberto sozinho, se possível.
# Painel: Mailrelay > Configurações > Chaves de API > criar chave (nome sugerido: peticao-sancionaintegral)
exec node /mnt/dev/peticao/tools/infra/chave.mjs mailrelay:sancionaintegral
