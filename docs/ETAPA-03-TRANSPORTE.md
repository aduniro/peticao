# Etapa 3 — conexão inicial ao transporte

Implementada somente no candidato, sem deploy. Não conclui a Etapa 3 nem a integração completa.

## Caminhos conectados

`sendMail` prepara identidade após validar destinatário/BCC, supressão e restrição de preview. A reserva de tentativa/auditoria acontece antes de chamar o provedor. Marketing mantém cadeia própria e não entra na fila transacional. Rodízio/disjuntor conservam as chaves anteriores (`transacional` e `marketing`), pesos, evitados e limite de tentativa única.

Resultado e log correlacionado são gravados uma vez. Falha de gravação ou callback após aceite conhecido não aciona outro provedor. Se o transporte falha sem prova de recusa, a tentativa permanece indeterminada. O failover e reenvio públicos mantêm a política anterior, por opção interna explícita `retryUncertain`; isso não equivale a garantia de que um provedor anterior não recebeu. Contato conserva `singleAttempt` e `queue:false`, com chave própria por resposta, sem reenvio automático inconclusivo.

A fila nova nasce com identidade e auditoria na mesma transação. Item antigo recebe identidade no primeiro processamento observado pelo código novo; payload/data originais e tentativas antigas não são reescritos nem atribuídos retroativamente. Vínculo exige tipo, destinatário e conteúdo. O Reply-To efetivamente observado é conservado para retries, mesmo se a configuração posterior mudar. A migração deixa esse campo desconhecido em mensagens antigas, em vez de inventá-lo.

Quando o aceite já está registrado, a fila pode recuperar uma confirmação perdida sem chamar outro provedor. Uma tentativa ainda preparada bloqueia outra chamada, inclusive depois de tempo decorrido; o fluxo operacional de recuperação desse caso continua pendente. Drenagens oportunistas anteriores são mantidas e podem ser aguardadas em teste/desligamento controlado.

## Conteúdo e privacidade

`MAIL_ARCHIVE_RETENTION` aceita `30`, `90` ou `forever`. Sem valor, novos envios registram identidade/tentativas, mas não copiam o corpo. A preferência foi perguntada ao dono e não foi ativada automaticamente. Envelope efetivo após defaults é o que pode ser arquivado. A integração não expõe chaves nem altera HASH_PEPPER.

Não há endpoint de conteúdo bruto descriptografado nem interface nova. Proteção de acesso, prévia segura, eventos/IDs reais de provedores, conversas/editor, retenção entre todas as cópias e recuperação controlada ainda faltam. Não afirmar arquivo completo ativo ou entrega ao destinatário: aceite é aceite do transporte.

## Compatibilidade operacional ainda a verificar

Migração/boot antigos são compatíveis estruturalmente; isso não prova que voltar a um worker antigo preserve as proteções novas. O candidato agora inclui guard fixo para reconciliar filas correlacionadas já aceitas e reter as demais antes de iniciar código anterior; contrato em `docs/ETAPA-03-ROLLBACK.md`. Instalação e conferência das unidades/perfil reais continuam pendentes. Nenhum SQL manual de desbloqueio ou reenfileiramento foi fornecido/executado.


## Validação deste checkpoint

**326/326** cumulativos na versão congelada, com `--test-concurrency=4` e sem build concorrente; tipos após build, build e migração aprovados. Dezoito testes específicos iniciais passaram; o cumulativo inclui também a regressão acrescentada para o disjuntor original. Os testes de modelos/guardas de contato conservam `queue:false` e `singleAttempt:true`, agora conferindo a chave da resposta reservada.

O roteiro `tools/admin-qa/mail-transport.mjs` atravessou `/api/contato` e a prévia/envio administrativos no app compilado: duas mensagens correlacionadas, uma tentativa aceita por mensagem, recusa de resposta duplicada e assinaturas preservadas. Destinatários fictícios e transporte dev em pasta isolada, sem leitura dos segredos reais. Sessão de QA revogada e servidor temporário 3032 encerrado. A prévia 3031 permanece ativa; não é uma publicação.

Evidências em `/mnt/dev/peticao/.cache/admin-audit-20261106/`: `stage03-transport-cumulative-bounded.log`, `stage03-transport-typecheck-serial.log`, `stage03-transport-build.log`, `stage03-transport-migration.log`, `stage03-transport-runtime.log`, `runtime-mail-transport/mail-transport.json`. O ensaio inclui upgrade da base anterior de arquivo, preservando identidade/fingerprint/datas e deixando Reply-To antigo desconhecido.

As duas rodadas anteriores foram preservadas: a primeira encontrou expectativa antiga dos parâmetros do contato (corrigida para exigir também a chave); a segunda teve timeout de uma sonda Reacher do teste enquanto concorria com o build. O diagnóstico gravado (`stage03-reacher-diagnostic.json`) mostrou `indisponivel` em 359 ms para prazo de 300 ms. A repetição não alterou regras, limites ou verificações: isolou a carga e passou integralmente. Na revisão também foi corrigido o uso da chave interna do rodízio para conservar o disjuntor `transacional`.

Nenhum deploy, dado real/revisão local alterado ou aviso novo ativado. Permanecem preferências/avisos pendentes e o restante das Etapas 2–7; não concluir a integração integral a partir deste checkpoint.
