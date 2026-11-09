# Trabalhos duráveis A1 — admissão e execução cercada

Esta etapa implementa somente armazenamento, admissão, reserva para execução, falha e consulta. Não assina documentos, não envia e-mails, não publica um PDF assinado e não qualifica o resultado como ICP-Brasil. A integração final permanece responsabilidade da próxima etapa.

## Arquivos e integração

- Implementação: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/batch-a1-jobs.ts`.
- Testes: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/batch-a1-jobs.test.ts`.
- Contrato técnico do worker: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/a1-worker-contract.ts`.

`BATCH_A1_SCHEMA_SQL` deve ser ligado à inicialização depois das tabelas `admin_users`, `admin_sessions`, `batches` e `batch_document_versions`. O DDL é aditivo e repetível: tabela `batch_a1_jobs`, índices e gatilho que congela o vínculo admitido. Nenhuma linha histórica é migrada para trabalho ou assinada automaticamente. Não há ligação ao fluxo de preparação existente nem alteração do modo `SIGNER=none`.

A coluna de sessão não possui FK deliberadamente: apagar/revogar uma sessão continua possível e torna o trabalho obsoleto na próxima operação. A FK do documento original preserva o vínculo ao histórico imutável. Os campos de saída existem como reserva para a futura finalização, mas este módulo não os preenche.

## Ativação exclusiva pelo servidor

A admissão exige simultaneamente `BATCH_A1_ENABLED=1` e configuração válida em `settings`, chave `batch_a1_policy_v1`. Ausência, formato incompleto, campos extras, credencial inativa ou flag falsa desabilitam o recurso. O pedido HTTP não escolhe a configuração, arquivo, senha, URL ou credencial.

Estrutura exata da configuração (os identificadores e hashes abaixo são campos descritivos, não valores para ativação):

```ts
{
  version: 1,
  revision: number, // inteiro positivo; CAS da política apresentada
  enabled: boolean,
  credentialActive: boolean,
  credentialVersionId: string, // UUID minúsculo da versão protegida
  profileVersion: "pades-basic-unhomologated-v1",
  trustStoreVersion: string, // SHA-256 hexadecimal minúsculo
  expectedCnpj: "15883671000115",
  certificateFingerprintSha256: string // SHA-256 hexadecimal minúsculo
}
```

Não guardar PFX, senha ou caminho nesta configuração. Todo o objeto canônico é resumido em SHA-256; alterar qualquer parte invalida a autorização anterior, mesmo quando alguém esquece de incrementar `revision`.

## Operações entregues

`admitA1Job({ batchId, requestId, expectedDocumentVersion, expectedPolicyRevision }, actor)` aceita exatamente esses quatro campos. Revalida no PostgreSQL o usuário ativo de nível Total, o e-mail do ator, a sessão efetiva e o step-up vigente. O prazo fica congelado no menor valor entre expiração da sessão, expiração do step-up e dez minutos; renovar o login depois não estende a autorização original.

O lote deve existir, estar preparado ou falho, sem aprovação/envio, com PDF original íntegro de até 25 MiB, hash/lista coincidentes e versão original imutável no histórico. São congelados o UUID da versão original, seu tamanho/hash, `documentVersion`, `listHash`, a versão da credencial e a política completa de certificado/confiança. Mesmo UUID de solicitação por ator retorna o trabalho existente apenas com o mesmo pedido. Alterar o pedido com o mesmo UUID é conflito. Há no máximo um trabalho ativo por lote; autorização vencida é encerrada como obsoleta antes de admitir outra ação explícita.

`claimA1Job(jobId, expectedRevision)` é uma operação interna do runner confiável, sem exposição pública direta. Revalida autorização, política e documento dentro da transação. Faz CAS de revisão, emite token de posse novo e aumenta a tentativa. A posse dura no máximo 120 segundos e nunca ultrapassa a autorização congelada. Uma posse vencida pode ser retomada com outro token, no máximo três tentativas. O token anterior não pode registrar falha no lugar da nova execução. O retorno interno inclui `binding`, `leaseToken` e os bytes originais; o worker só deve ser chamado depois que esta transação terminou.

`failA1Job(jobId, leaseToken, expectedRevision, errorCode)` exige posse atual não expirada, revisão correta e nova revalidação. Somente códigos limitados são persistidos: `signing_failed`, `validation_failed`, `worker_unavailable`, `result_uncertain`, `input_mismatch`. Não grava stderr, URL ou texto arbitrário do provedor. Falha é terminal: não há reenvio nem nova assinatura automática.

`getA1Job(jobId, actor)` consulta somente metadados após verificar usuário Total, sessão e step-up. A projeção não contém bytes, e-mail, token de posse nem identificador de autorização. O endpoint futuro deve preservar essa projeção.

Admissão, claim, obsolescência e falha usam auditoria na mesma transação. Falha da auditoria reverte integralmente a transição. Timeouts locais limitam espera de locks a um segundo e comandos a cinco segundos. Não existe chamada ao worker, assinatura ou envio dentro dessas transações.

## Finalização: contrato proposto, ainda não implementado

1. Executar o worker pelo transporte interno e validar seu relatório e PDF fora da transação. A resposta técnica com `icpBrasilQualified=false`/`homologated=false` não constitui comprovação de ICP-Brasil.
2. Na transação de publicação, revalidar usuário/sessão/step-up, autorização original congelada, gate duplo e hash da política. Travar lote e trabalho na mesma ordem das operações existentes. Conferir CAS, token de posse atual e prazo, versão exata do lote, UUID/hash/tamanho do original e todos os campos do binding.
3. Exigir evidência verificável independente do hash final e vínculo ao original, fingerprint do certificado efetivo, titular CNPJ, perfil, trust store e resultado de validação compatível com a classificação pretendida. Verificação/homologação não foi entregue nesta etapa.
4. Registrar a nova versão assinada no histórico imutável e um relatório persistido ligado ao trabalho/hash de saída. A aceitação de uma origem `a1-worker` no histórico pertence à integração do responsável e não é introduzida silenciosamente por este módulo.
5. Somente após validação apropriada publicar bytes/hash/classificação no lote, invalidar aprovações antigas e marcar o trabalho como concluído por CAS. Histórico, relatório, lote, trabalho e auditoria devem confirmar ou reverter juntos.
6. Não aprovar lote nem enviar mensagem automaticamente. Resultado inválido, incerto ou posse vencida nunca publica. Retomada de posse não promete execução física única: o fencing impede que uma execução anterior publique no lugar da atual.

A política de implantação e autorização do responsável continua vigente; nada foi aplicado na VPS.

## Validação realizada em 09/11/2026

Cinco testes de integração passaram com PostgreSQL real fictício, exclusivo na porta 54372, Node 20.19.2 fixado, `MAIL_PROVIDER=dev`, diretórios vazios para credenciais e `SIGNER=none`:

1. Gate fechado por padrão, configuração ausente, pedido com caminho extra, sessão ausente/expirada e nível real insuficiente.
2. Concorrência/idempotência, conflito de pedido, exclusividade por lote, DDL repetível, imutabilidade do vínculo e visibilidade durável por outra conexão PostgreSQL.
3. Claims concorrentes, CAS, posse ocupada/vencida, retomada com novo token, rejeição do token antigo e falha terminal sem repetição automática.
4. Revogação do usuário, exclusão da sessão, alteração da política e mudança do original invalidam o trabalho.
5. Falhas forçadas da auditoria revertem admissão, claim e falha; os bytes do lote/histórico e o estado de e-mail continuam preservados.

A checagem TypeScript direcionada terminou com zero diagnósticos. Evidências privadas:

- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-jobs-qa/execution.json`.
- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-jobs-qa/validation.log`.
- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-jobs-qa/types.log`.

O teste de durabilidade usou outra conexão, não reinício completo do sistema/processo. Não houve certificado real, assinatura criptográfica, SMTP real, homologação, teste integrado de transporte ou publicação nesta etapa. Não foi executado build global nem modificado WIP congelado.
