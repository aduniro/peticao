# Trabalhos duráveis A1 — admissão e execução cercada

Esta etapa implementa armazenamento, admissão, reserva para execução, falha, consulta e finalização transacional com prova opaca de validação. Não realiza criptografia nem envia e-mails dentro das transações. A publicação como ICP-Brasil exige a prova emitida pelo adaptador v2 com configuração homologada explícita; não é habilitada por um resultado técnico genérico do worker.

## Arquivos e integração

- Implementação: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/batch-a1-jobs.ts`.
- Testes: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/batch-a1-jobs.test.ts`.
- Contrato técnico do worker: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/a1-worker-contract.ts`.

`BATCH_A1_SCHEMA_SQL`, exportado pelo módulo puro `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/batch-a1-schema.ts` e reexportado pelo módulo de jobs, deve ser ligado à inicialização depois das tabelas `admin_users`, `admin_sessions`, `batches` e `batch_document_versions`. O DDL é aditivo e repetível: tabela `batch_a1_jobs`, índices e gatilho que congela o vínculo admitido. Nenhuma linha histórica é migrada para trabalho ou assinada automaticamente. Não há ligação ao fluxo de preparação existente nem alteração do modo `SIGNER=none`.

A coluna de sessão não possui FK deliberadamente: apagar/revogar uma sessão continua possível e torna o trabalho obsoleto na próxima operação. A FK do documento original preserva o vínculo ao histórico imutável. A tabela `batch_a1_validations` guarda os metadados de validação, hashes de entrada/saída e vínculos ao trabalho e à versão assinada. Seus relatórios são imutáveis por gatilhos de UPDATE/DELETE/TRUNCATE. A referência de relatório no trabalho possui FK; o token concluído só deixa um SHA-256 para reconciliar a mesma finalização sem revelar a posse original.

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

## Disponibilidade e reconciliação

`getA1Availability(batchId, actor)` é a fonte da UI: revalida Total/sessão/step-up e retorna `{ok:true, available, documentVersion?, policyRevision?, latestJob?, error?}`; falhas de parâmetros/autorização retornam `{ok:false,error}`. Gate fechado e documento indisponível retornam `available:false`, com código técnico. Não ativa nada. Uma tarefa ativa impede nova admissão.

Os metadados incluem `requestId` para reconciliar uma resposta HTTP perdida com a intenção exata, além de `outputVersionId`, `outputSha256` e `validationReportId` nulos até a conclusão. Não inferir sucesso apenas porque existe uma tarefa do mesmo lote. Nunca repetir POST automaticamente após falha de rede.

## Finalização entregue

`finishA1Job(jobId, leaseToken, expectedRevision, bytes, proof)` copia os bytes antes de qualquer espera e aceita somente `VerifiedA1Pdf` que passa `isVerifiedA1Pdf(proof, bytes, binding)`. JSON, casts e cópias de objetos não produzem essa capacidade. O binding completo congelado, hash final, identidade/fingerprint e política homologada são conferidos pelo guard. A chamada externa a `verifyA1Pdf` ocorre antes da transação, pelo responsável pela orquestração.

A transação revalida Total, sessão, step-up, expiração original, gate, política/credencial, posse/token, revisão CAS, lote ainda não aprovado/enviado e documento original exato. Ordem dos locks: ator/sessão/política, lote e trabalho. Resultado obsoleto não sobrescreve PDF: registra obsolescência auditada quando aplicável. Posse vencida não publica.

Após essas verificações, preserva eventual versão assinada observada, acrescenta versão histórica `signed` de fonte `a1-worker`, grava relatório imutável, publica bytes/hash/classificação `icp-brasil`, limpa código de aprovação, expiração, tentativas e aprovação anterior, e marca o trabalho como concluído por CAS. Histórico, relatório, lote, trabalho e auditoria confirmam ou revertem juntos. Não aprova nem envia o lote.

Finalização repetida com mesmo token original, revisão de entrada, prova e bytes devolve os mesmos IDs/hash sem segunda versão ou segundo relatório. Exige autorização/política ainda válidas, correspondência do artefato imutável e PDF atualmente publicado; outra intenção/token ou bytes distintos falham. Execução física única não é prometida: fencing impede que uma execução antiga publique sobre a atual.

O worker genérico continua `pades-basic-unhomologated-v1`; ele não emite por si só comprovação ICP. Gate adicional `A1_VALIDATION_ENABLED=1`, adaptador v2 e pares explícitos de perfil/OID homologados são exigidos pela camada de validação. Sem configuração homologada real, a operação permanece fechada. O teste com resposta v2 fictícia não homologa certificado ou perfil reais.

Nada foi aplicado na VPS.

## Validação realizada em 09/11/2026

A primeira etapa passou cinco testes de integração; a extensão de finalização acrescenta três grupos dirigidos. Resultados atuais estão nos logs abaixo. Os testes executam com PostgreSQL real fictício, exclusivo na porta 54372 nesta frente (runner cumulativo pode usar outra porta explícita local), Node 20.19.2 fixado, `MAIL_PROVIDER=dev`, diretórios vazios para credenciais e `SIGNER=none`:

1. Gate fechado por padrão, configuração ausente, pedido com caminho extra, sessão ausente/expirada e nível real insuficiente.
2. Concorrência/idempotência, conflito de pedido, exclusividade por lote, DDL repetível, imutabilidade do vínculo e visibilidade durável por outra conexão PostgreSQL.
3. Claims concorrentes, CAS, posse ocupada/vencida, retomada com novo token, rejeição do token antigo e falha terminal sem repetição automática.
4. Revogação do usuário, exclusão da sessão, alteração da política e mudança do original invalidam o trabalho.
5. Falhas forçadas da auditoria revertem admissão, claim e falha; os bytes do lote/histórico e o estado de e-mail continuam preservados.

A checagem TypeScript direcionada terminou com zero diagnósticos. Evidências privadas:

- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-jobs-qa/execution.json`.
- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-jobs-qa/validation.log`.
- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-jobs-qa/types.log`.

A extensão verifica prova falsa e bytes adulterados, commits simultâneos com replay único, limpeza dos códigos antigos, relatório/histórico únicos, rollback integral por falha na auditoria e bloqueios de revogação, alteração de política/documento, aprovação e posse vencida. O runner desta frente usa PDF original e PDF com assinatura criptográfica SINTÉTICA gerados pelo teste pyHanko do worker, via `QA_A1_ORIGINAL_PDF`/`QA_A1_SIGNED_PDF`; não são certificados ICP reais. A avaliação externa é um fetch v2 fictício, explicitamente separado da verificação criptográfica sintética. Sem esses caminhos, o teste de protocolo usa bytes PDF sintéticos e não alega testar criptografia.

- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-jobs-qa/finish-validation.log`.
- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-jobs-qa/run-finish.py`.
- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-synthetic-original.pdf`.
- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/a1-synthetic-signed.pdf`.

O teste de durabilidade usou outra conexão, não reinício completo do sistema/processo. Não houve SMTP real, homologação ICP real ou deploy. Não foi executado build global nem modificado WIP congelado.
