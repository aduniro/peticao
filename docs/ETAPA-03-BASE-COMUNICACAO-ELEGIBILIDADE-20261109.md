# Base de comunicação: elegibilidade e supressão puras

Continuação restrita autorizada do contrato `74e5003`: módulo puro e testes,
sem persistir/coletarPII, criarDDL/API/UI, ativar emissor, enviar ou exportar dados.
O módulo não tem imports, rede, banco, relógio ou acesso à configuração.

## Estados condicionais

`assessCommunicationEligibility` recebe somente fatos enumerados de registro,
validade de endereço, origem, revisão explícita, registro de base/evidência,
finalidade, retenção e bloqueios. Responde:

- `eligible_for_preparation`: todos os fatos exigidos estão explicitamente
  positivos, condicionalmente à correção e autorização dos registros de origem.
- `ineligible`: há bloqueio conhecido(arquivo, endereço inválido, rejeição,
  base/evidência ausente, outra finalidade, expiração, optout ou supressão).
- `unknown`: faltam fatos, há valores inválidos ou a revisão/política ainda é
  desconhecida. Campo omitido nunca ganha padrão de aprovação.

Bloqueio conhecido prevalece sobreUNKNOWN. A função não escolhe fundamento,
prazo, critério jurídico, fonte ou contato: `recorded` informa apenas que existe
registro, não que esse fundamento foi verificado pelo software. Não interpreta
presença em assinatura, contato, importação ou abandono como opt-in. Não calcula
retenção nem assume30dias. Campos identificadores/extras não são aceitos como
fatos e não são copiados para a saída.

Toda resposta mantém `authorizedToSend:false` e `consentInferred:false`.
`eligible_for_preparation` não pode ser transformado em autorização de envio ou
substituir sessão/permissão/consulta atual de dados. Um futuro backend deverá
construir esses fatos a partir de registros autorizados; receber `approved` do
navegador não é uma concessão de acesso nem uma comprovação de consentimento.

## Supressão independente

`assessCommunicationSuppression` separa preferência de marketing e bloqueio
geral, com `clear`/`suppressed`/`unknown`. Bloqueio geral conhecido vale nos dois
canais; optout de marketing conhecido bloqueia marketing, mas não converte uma
confirmação transacional em bounce/reclamação. Preferência desconhecida de
marketing não vira permissão. Canal desconhecido também não é presumido.

Essa é uma função sem estado: não lê/escreve `email_suppressions`, não cria
preferência e não foi conectada ao gateway `sendMail`. Portanto, não se afirma
que o canal existente ou a VPS já possuem descadastro/optout atualizado.

## Provas

**8/8 testes passaram**, zero falhas/cancelados/ignorados. Incluem matriz completa
27combinações de canal/bloqueio/preferência; bloqueios sobreUNKNOWN; todos os
campos omitidos/desconhecidos; fontes assinatura/contato/manual/CSV/abandono sem
inferência de opt-in; entrada imutável; ausência de identificadores na saída;
fatos inválidos e ausência de chamadasfetch. Nenhum PostgreSQL ou transporte foi
iniciado. Tipos focados exclusivamente no módulo/teste passaram com código0.

Ambiente limpo, sem carregar arquivos de ambiente ou credenciais. Fontes
preservadas durante a execução. Evidência original
`/tmp/admin-communication-pure-6le_ksdn/`; cópia/checksums privados em
`.cache/qa-communication-pure-20261109/`. O relatórioJSON guarda comandos e hashes.

## Pendências preservadas

Retenção da futura base, fundamentos/evidências que o dono aceitará, importação
revisável, registro cifrado/procedência, preferências persistentes, token de
descadastro e integração de gateway/headers/campanha continuam pendentes.
Nenhuma decisão anterior foi inventada ou ampliada por este módulo puro.
