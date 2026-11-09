# Acesso externo ao documento e reconciliação do recibo

Backend funcional para completar a lacuna entre a emissão do desafio v1 e a página externa do presidente. Não altera a confirmação existente, os PDFs, a classificação ICP/gov.br ou o envio dos lotes.

## Contrato

- `POST /api/presidente/documento`: JSON estrito `{token,password}`. Retorna os bytes exatos do PDF selecionado, `application/pdf`, download com nome fixado pelo número do lote e cabeçalhos `x-document-version`/`x-document-sha256`. Nunca recebe credenciais na URL.
- `POST /api/presidente/estado`: mesma autenticação. Retorna `{ok,state,canConfirm,expiresAt,document,receipt}`. `document` contém somente IDs/número/tipo/revisão/hash/tamanho. `receipt` só aparece quando consumido, com identificador, horário e a classificação já existente `own-confirmation`, `icpBrasil:false`, `govBr:false`.
- `canConfirm` é calculado no servidor. Uma lease expirada pode permitir nova tentativa **manual**, sem alterar o estado durante a consulta. O cliente não deve decidir isso com seu relógio nem repetir automaticamente um POST de confirmação.
- Falhas de capacidade/senha/expiração/vínculo retornam o mesmo resultado indisponível. Limites: corpo 512 bytes, mesma origem, JSON e 12 consultas/minuto/IP compartilhadas entre os dois endpoints. Não há GET de PDF ou recibo por token sozinho.

## Invariantes

O token e a senha reutilizam os HMACs v1. A leitura revalida emitente Total ativo, perfil/revisão/conta responsável, hashes reais dos bytes e revisão integral do documento. Senhas incorretas antes da verificação compartilham o orçamento de cinco tentativas com a confirmação; consultas não consomem o desafio nem cancelam uma lease em curso.

Um recibo consumido pode ser reconciliado até a expiração original de dez minutos, inclusive depois de aprovado/enviado o mesmo binário. Continua exigindo o mesmo perfil/emitente/vínculo. Isso não transforma a capacidade em histórico permanente. Confirmação posterior permanece bloqueada, e nenhum envio é disparado pela leitura.

Auditoria contém somente IDs/revisão/estado, sem token, senha, CPF ou nascimento. Falha de auditoria impede retornar o PDF. Não houve mudança de DDL ou das regras públicas de cadastro.

## Validação local

Fonte em `/mnt/dev/peticao/.cache/admin-integration/candidate-president-access-20261109`. Executor isolado: `/mnt/dev/peticao/.cache/admin-integration/candidate-president-access-20261109/tools/admin-qa/president-access-local.py`, Node20.19.2 pinado e PostgreSQL temporário 54367, configurações vazias e identidades fictícias.

- **20/20 testes** de acesso, contrato v1 e store passaram, incluindo cinco tentativas concorrentes, lease ativa/expirada, reconciliação, revogação, troca de bytes/lista, auditoria atômica, origem/limites/headers e ausência de envios. Log final: `/tmp/admin-president-access-ezyip24k/validation.log`.
- A primeira rodada falhou em dois seeds de teste: timestamp que violava o CHECK de expiração e string não UUID na lease. Foram corrigidos somente os valores fictícios; nenhuma restrição foi removida. Evidência preservada: `/tmp/admin-president-access-wqy6c7xs/validation.log`.
- A rodada intermediária aprovada está em `/tmp/admin-president-access-zvbjzzc2/validation.log`; o teste final acrescenta `canConfirm` calculado pelo servidor.

TypeScript completo final passou com saída 0 e fonte estável: `/tmp/admin-president-access-e7vy8bea/validation.log`. QA HTTP compilado ainda deve ser executado e registrado. Não considerar este backend como página externa concluída, homologação A1, assinatura criptográfica própria ou deploy.
