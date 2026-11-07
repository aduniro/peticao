# Continuidade da integração do admin-v2

A integração permanece em andamento, sem deploy autorizado. O plano completo continua em `AUDITORIA-CONTINUIDADE-ADMIN-V2-20261106.md`; este registro não reduz o escopo às correções já concluídas.

Candidato: `/mnt/dev/peticao/.cache/admin-integration/candidate-stage01`, ramo `admin-v2-stage01`. Não publicar o checkout principal inteiro, que contém mudanças públicas de outras tarefas ainda não publicadas.

Checkpoints:

- `77f33f7`: candidato atualizado com os três arquivos efetivamente publicados após a restauração dos formulários, hashes conferidos.
- `0020ce1`: transações de contas, proteção concorrente do último Total, uso único de redefinição e revogação; ranking regional agregado antes do limite por estado.
- `43b56e8`: publicação vinculada ao manifesto simulado, verificação de origem/cópia antes da troca e trava comum entre os caminhos de publicação. Inclui instalador separado, ainda não executado na VPS, e ensaio de atualização do banco.
- `7750df0`: fixtures cumulativas atualizadas para as regras de CPF/identidade já publicadas, sem importar mudanças de aliases de e-mail ainda não publicadas.

Evidências mais recentes em `/mnt/dev/peticao/.cache/admin-audit-20261106/`: suíte cumulativa **235/235**, oito testes Python do publicador/pipeline, ensaio da inicialização real no esquema anterior (seis tabelas aditivas, registros fictícios e definições existentes preservados), tipos e build aprovados. A rodada inicial 225/234 foi diagnosticada e corrigida nos testes que presumiam contratos antigos; as regras públicas atuais foram mantidas.

Detalhes e comandos: `docs/ETAPAS-ADMIN-01.md` e `deploy/LEIAME.md` dentro do candidato. O ensaio usa apenas banco de desenvolvimento em loopback/porta explícita e dados fictícios. O SQLite de revisão não participa desses testes.

Próxima etapa: A6 (autoria das correções, estados finais do Terminal e idempotência de respostas), demais controles sensíveis, QA visual/permissões em seis tamanhos e conferência final com a VPS atual. O aviso de Minha conta ainda aguarda a aprovação de texto já solicitada ao dono. Triagem interna, mensagens/editor, edição recuperável, IAs e documentos das Etapas 2–7 continuam pendentes no escopo completo. O término desta rodada de testes não conclui o objetivo nem autoriza publicação.

## Checkpoint seguinte — autoria e Terminal

`4ca0273` implementa autoria real nas rotas de correção/reenvio e resultado autenticado do Terminal, separado da saída do comando. O registro começa sem sucesso, e o resultado só é finalizado após validação do protocolo/assinatura; a ação e a auditoria são atualizadas atomicamente. Serviço antigo é recusado antes de receber o comando. O visual do console foi preservado.

A suíte cumulativa atual passou **244/244**, com tipos e build aprovados (`stage01-cumulative-terminal.log`, `stage01-typecheck-actions.log`, `stage01-build-actions.log` no diretório de evidências). A6 continua parcial: as respostas de contato ainda exigem fila durável e reconciliação de envios incertos. O diagnóstico está em `docs/A6-RESPOSTAS-PENDENTES.md` do candidato. Não houve deploy ou instalação de serviço na VPS.


## Checkpoint seguinte — respostas de contato

`5a3cbd6` implementa reserva durável e atômica do texto/card antes do envio, uma tentativa por item, retomada pelo cron existente e resultado inconclusivo sem repetição automática. O selo vincula a prévia exata, o destinatário, a origem e as cópias. O histórico anterior é preservado e não entra em disparo automático. A fila pública conserva sua política.

Validação atual: **251/251**, tipos, build e ensaio de migração aprovados. Evidências: `stage01-cumulative-contact.log`, `stage01-typecheck-contact.log`, `stage01-build-contact.log`, `stage01-schema-contact.log`. Workers concorrentes, aceite tardio e falhas entre envio/gravação foram ensaiados com dados e transportes fictícios. O ensaio de histórico anterior preservou IDs, autores, resultados e horários.

A6 permanece parcial até os rótulos/aviso de envio inconclusivo aprovados serem integrados à interface. Também faltam controles sensíveis, QA visual/permissões, conferência com produção e Etapas 2–7. A autorização de deploy continua sendo posterior à validação completa. Nenhuma alteração da VPS ou da revisão de CPFs nesta rodada.


## Checkpoint seguinte — confirmação extra e QA de contato

No candidato, `aada17c` torna atômicos a reserva e o consumo do código de confirmação extra, serializa a quota entre sessões e relê a conta/sessão no banco. A gestão de usuários exige a confirmação existente na página e no POST; nenhuma redação de aviso foi alterada. O handler foi testado nos quatro níveis, com ausência/expiração de confirmação, origem externa e autoria real.

Validação atual: **256/256** testes cumulativos, tipos e build aprovados (`stage01-cumulative-stepup.log`, `stage01-typecheck-stepup.log`, `stage01-build-stepup.log`). `0ba3094` promove o QA local de contato ao repositório: seis larguras aprovadas para falha de rede injetada, preservação do rascunho, botão liberado e recuperação da prévia. Não houve envio real; não é prova de QA integral ou de entrega. Evidências em `visual/contact-editor.json` e `stage01-contact-browser.log`.

A prévia isolada foi reiniciada em `http://127.0.0.1:3031/admin`, com banco fictício 54345. O banco de testes cumulativos é outro (54341). Pendências preservadas: avisos aguardando aprovação, resultado de convites/redefinições, demais controles e telas, QA por nível e Etapas 2–7. Nenhuma alteração da produção, instalação remota ou deploy.


## Checkpoint seguinte — pedidos de redefinição e matriz de páginas

`661fa7a` serializa a quota compartilhada de convites/redefinições e reserva token em hash + auditoria atomicamente antes do transporte. O resultado interno distingue aceite/fila/pedido sem envio; o handler administrativo ainda precisa consumi-lo após aprovação dos avisos. A resposta pública permanece uniforme. Suíte atual: **260/260**, tipos e build aprovados (`stage01-cumulative-reset.log`, `stage01-typecheck-reset.log`, `stage01-build-reset.log`).

`e4a629b` promove o QA de páginas por nível: **120 verificações aprovadas** (quatro níveis, cinco páginas, seis larguras), mais ausência de sessão e gate de confirmação extra. Usa contas/sessões fictícias, sem envio de código real; não comprova todos os endpoints assíncronos. Relatório `visual/access-pages.json`. O servidor temporário 3032 foi encerrado, sessões do teste revogadas e prévia 3031 preservada.

Novo achado para corrigir: Leitura ainda vê alguns atalhos incompatíveis e “Liberar CPF”, embora as rotas recusem a operação. Ajustar visibilidade sem mudar rótulos/estética. Avisos pendentes consolidados no candidato em `docs/ADMIN-AVISOS-PARA-APROVACAO.md`; não interpretar silêncio como aprovação.

Conferência SSH somente leitura: 333 arquivos de código da VPS sem diferenças da referência após os formulários; sete arquivos críticos do candidato iguais por SHA-256. Evidência `production-contract-reset.json`. Nenhum dado de assinatura ou valor de configuração inspecionado nesta conferência. Etapas restantes e deploy continuam pendentes; não reduzir o escopo do plano.


## Checkpoint seguinte — controles visíveis conforme o nível

`c169f57` extrai a política pura de níveis para uso compartilhado com o navegador, preservando os exports do backend e recusando níveis desconhecidos. Menu, atalhos do painel, “Ver pendentes” e liberação de CPF seguem o nível real. Total mantém todos os itens; a barra inferior preserva as sete posições. CSS, rótulos e avisos foram preservados.

Validação atual: **261/261** testes cumulativos, tipos e build aprovados (`stage01-cumulative-role-ui.log`, `stage01-typecheck-role-ui.log`, `stage01-build-role-ui.log`). `e07fdac` registra **144 casos de QA** em quatro níveis e seis larguras, cobrindo controles, cinco páginas, posições Menu/Filtros, acesso direto, erros HTTP/rede/exceções e rolagem horizontal. Relatório: `visual-role-ui-isolated/access-pages.json`.

A execução inicial detectou cancelamentos de consultas da página anterior ao reutilizar a aba; o registro foi preservado. A execução aprovada usa uma página por caso e não filtra mensagens de erro. O servidor temporário 3032 foi encerrado e as sessões foram revogadas; a prévia 3031 permanece ativa. O achado específico de controles indevidos para Leitura está corrigido no candidato.

Seguem pendentes os avisos em aprovação, feedback de contato/convites, revisão das demais telas/contratos e Etapas 2–7. Não houve deploy, alteração da VPS nem modificação da revisão de CPFs. Este checkpoint não conclui o plano.


## Checkpoint seguinte — preferências e curadoria auditadas

`f9bb4ff` torna atômica a gravação das preferências com sua auditoria. Decisões individuais de domínio também reúnem domínio, três metadados institucionais e auditoria em transação, com trava entre decisões manuais; a rota registra o autor real e recusa propriedades herdadas como tipo. O classificador existente, os demais campos dos assinantes, os rótulos e avisos foram preservados. A operação por fonte continua uma sequência de decisões individuais, sem promessa de atomicidade do lote completo.

Validação atual: **265/265**, tipos e build aprovados (`stage01-cumulative-settings-domains.log`, `stage01-typecheck-settings-domains.log`, `stage01-build-settings-domains.log`). Regressões incluem rollback de auditoria/metadados, preservação dos demais dados, permissões/autor e domínio/subdomínio simultâneos. O teste do navegador passou nas seis larguras para pendência, falha de rede, preservação dos estados, recuperação e auditoria do autor; relatório `visual-settings/settings.json`.

A preferência fictícia foi restaurada e a sessão revogada; servidor temporário 3032 encerrado, prévia 3031 preservada. Nenhuma consulta/curadoria de assinantes reais ou alteração da VPS/SQLite de revisão. Próxima revisão: registro de ações em `acoes/index.ts`, ainda posterior aos efeitos e separado da auditoria; não confundir com o journal do Terminal já corrigido. Demais telas/contratos, avisos em aprovação e Etapas 2–7 continuam no escopo; nenhum deploy autorizado.


## Checkpoint seguinte — admissão e resultado da Central

`3b5be27` registra ações de escrita antes dos efeitos, com identificador de pedido persistido, ator e auditoria. Efeitos de banco e resultado final são atômicos; aceite externo é separado de conclusão. Pedidos externos com resultado incerto registrado não são repetidos automaticamente. O aviso pós-commit do Terminal não bloqueia desligamento. Histórico anterior recebe estado legado sem reexecução.

Validação atual: **277/277**, tipos, build e migração aprovados; suíte específica 27/27. Inclui perda simulada de resposta do commit, falhas em auditoria, operações opostas, aviso pendente e correlação do sinal temporário de publicação. Não foi executado deploy/serviço root. O navegador passou nas seis larguras para consultas/simulações, preservando campos e configurações. Relatório `visual-actions/actions.json`; contrato completo `docs/A6-CENTRAL-JOURNAL.md` do candidato.

Ainda falta vincular execução à intenção/simulação única para retries após perda da resposta HTTP, além do histórico/fluxo controlado de conciliação. A trava não substitui essa idempotência. AV-5 e AV-6 foram submetidos ao dono: resultado indeterminado e descrição/dicas da janela. Nenhum desses textos foi inserido; a janela configurada não foi alterada. As demais pendências e Etapas 2–7 continuam no objetivo. Sem deploy ou alteração da VPS/revisão de CPFs; prévia 3031 ativa, servidor temporário 3032 encerrado.


## Checkpoint 49e0fdf — execução única da intenção administrativa

No candidato isolado `admin-v2-stage01`, cada execução HTTP de escrita exige intenção da simulação, vinculada ao administrador/ação/parâmetros e consumida uma única vez. Retentativas recuperam o resultado persistido; após recarga, o navegador apenas consulta. Efeitos externos incertos continuam bloqueados até conciliação. Nenhum aviso ou CSS alterado.

Validação: **283/283** cumulativos, tipos, build e migração; seis larguras de navegador com resposta perdida e recuperação, sem duplicação, exceções ou erros HTTP inesperados. O primeiro cumulativo teve duas falhas de configuração do transporte de teste; o log foi preservado e a repetição passou sem editar esses testes. Documentação e evidências no candidato em `docs/A6-CENTRAL-JOURNAL.md`.

Servidor temporário 3032 encerrado após QA e sessão fictícia revogada. Prévia 3031 ativa. Vigia e respondedor conferidos ativos. Nenhuma alteração remota, deploy ou mudança das decisões da revisão local. Próximo trabalho: histórico e conciliação controlada da Central; avisos aguardam resposta e Etapas 2–7 continuam pendentes. Integração completa ainda não concluída; publicação exige autorização final.


## Checkpoint 89600b6 — histórico e conciliação por comprovante

Backend local: histórico paginado Total + step-up; conciliação por comprovante root ligado ao ID/SHA do pedido, com auditoria atômica e preservação da autoria/horário originais. O executor proposto grava comprovantes por ID sem sobrescrita. Recusa comprovada permite nova intenção; falha do publicador continua indeterminada, pois pode haver deploy parcial. Não usar último estado mutável, ausência de prova ou veredito livre como atalho.

Validação final: **292/292** cumulativos, tipos, build, oito testes Python e regressão no navegador em seis larguras aprovados. Detalhes em `docs/A6-CENTRAL-JOURNAL.md` no candidato; evidências `stage01-cumulative-reconcile-final.log` e `stage01-reconcile-browser-regression.log`. O roteiro de navegador exercita o fluxo de intenção já existente; a interface nova aguarda AV-7 e não foi ativada. AV-1–AV-6 e procedimento controlado para falhas parciais também pendentes.

O servidor temporário 3032 foi encerrado e a sessão fictícia revogada; prévia 3031 preservada. Nenhuma alteração da VPS, revisão local ou dados reais; nenhum deploy. O próximo avanço independente é a triagem interna (Etapa 2), portando lógica pura e evidências por colunas permitidas, sem SSH root no app. A leitura de `tools/ponte/triagem-lib.mjs`/`triagem.mjs` mostrou duas correções necessárias no porte: a coleta atual usa exclusão de colunas em vez de lista permitida, e algumas minutas inferem recebimento/ação executada só pelo registro de envio. Não levar essas inferências para o app novo. As Etapas 2–7 permanecem no objetivo completo.


## Checkpoint 625c537 — primeiro backend da triagem interna

O candidato contém análise por regras, evidência limitada/parametrizada, propostas de campus e fila durável por revisões. A coleta não leva SSH root ao app. Faltas de evidência e truncamentos são explícitos; envio aceito não significa entrega, e nome compatível não confirma identidade. Trabalhadores antigos não sobrescrevem resultados; reanálise cria outra versão, sem alterar decisões/cadastros/respostas existentes. O texto original não é duplicado no snapshot e o input é amarrado com HMAC de domínio próprio, sem alterar chaves ou hashes de CPF.

Validação final: **307/307** cumulativos, tipos e build; migração com sete tabelas aditivas preservando esquema e registros anteriores; teste HTTP dos handlers compilados, autenticação, agendador, análise e revisão preservada. Dados fictícios, sem API CPF-Brasil ou envios externos a participantes. Evidências e limites em `docs/ETAPA-02-TRIAGEM.md` do candidato. Build e tipos devem ser sequenciais: a checagem paralela viu arquivos gerados removidos pelo build; a rodada serial passou.

A Etapa 2 ainda não está completa: interface/minutas, informes duráveis somente ao dono, atualização por eventos e curadoria de campus pendentes. AV-8 não foi ativado; AV-1–AV-8 foram reunidos por e-mail e continuam aguardando resposta. A aplicação da VPS e a revisão local de CPF não foram alteradas. O servidor temporário 3032 foi encerrado e a sessão revogada; prévia 3031 preservada. Rotina nova não está instalada/em execução automática na VPS. A leitura da base de e-mails da Etapa 3 foi registrada em `docs/ETAPA-03-BASE-MENSAGENS.md`; as Etapas 3–7 continuam no escopo, sem autorização de deploy.


## Checkpoint 55b830f — base de mensagem, conteúdo e tentativas

No candidato: identidade de pedido/mensagem, conteúdo criptografado opcional, versões e tentativas duráveis. Vínculo com fila exige conteúdo/tipo/destinatário exatos. Aceite bloqueia repetição; incerteza permanece distinguida e a exceção de retry é explícita/interna. Conteúdo tem política explícita, limite separado da identidade e expurgo auditado que conserva metadados. Foram perguntadas ao dono as opções 30/90 dias ou sem exclusão automática; nenhuma política foi ativada.

**318/318** cumulativos, tipos após build, build e migração aprovados. O ensaio inclui e-mails/filas antigos e não fabrica conteúdo ou identidade retroativa. São nove tabelas aditivas e duas colunas UUID nulas nos legados. Código/contrato/evidências em `docs/ETAPA-03-BASE-MENSAGENS.md` do candidato.

A biblioteca ainda não é chamada pelo transporte atual ou worker: não afirmar arquivo automático funcionando. Conexão de envios/fila, correlação real de provedores/eventos, política completa, consultas autorizadas, prévia, conversas/editor e interfaces continuam pendentes. Nenhuma alteração de estética/avisos. Prévia 3031 retomada, `/admin` respondeu 200. Nenhum deploy, modificação da VPS ou revisão local de CPFs. A integração completa e as etapas seguintes continuam em andamento.


## Checkpoint 30c30d2 — mensagem/journal conectados ao transporte

Os caminhos direto e de fila usam identidade, admissão e resultado correlacionado. Falha de gravação/callback após aceite não causa outro envio; contato mantém tentativa única/sem fila e chave por resposta. A fila antiga é identificada no primeiro processamento novo, preservando payload/data; Reply-To observado fica estável. A política pública de fallback/retry permanece explícita, e aceite conhecido permite recuperar uma confirmação perdida da fila sem novo transporte.

**326/326** cumulativos com `--test-concurrency=4` e build separado; tipos/build/migração e HTTP do app compilado aprovados. O smoke criou contato e resposta somente dev/fictícios, conferiu dois registros correlacionados, tentativa única por mensagem, recusa de resposta duplicada e assinaturas intactas. Os logs anteriores foram preservados; a sonda Reacher havia levado 359 ms para prazo de 300 ms sob carga, e passou sem mudar prazo/regra após isolamento. Rodízio/disjuntor mantêm a chave original `transacional` separada do marketing.

Conteúdo continua sem cópia automática até política explícita; preferência 30/90/permanente e avisos AV-1–AV-8 aguardam resposta. Etapa 3 ainda incompleta: recuperação/rollback, IDs/eventos, retenção completa, consultas protegidas e interface. Detalhes/evidências em `docs/ETAPA-03-TRANSPORTE.md`. Prévia 3031 preservada, QA 3032 encerrado e sessão revogada. Nenhum deploy, modificação de dados reais ou revisão local. Objetivo completo e Etapas 4–7 continuam ativos.

## Checkpoint fdf33c4 — rollback do transporte protegido

No candidato `admin-v2-stage01`, o publicador para consumidores antes da troca e exige guard fixo antes de voltar ao worker anterior. Filas correlacionadas com aceite comprovado são reconciliadas; as demais ficam retidas sem apagar conteúdo/histórico. Falha mantém o backup e impede o worker anterior; publicação seguinte recusa recuperação pendente. Nenhum SQL/guard foi instalado ou executado na VPS.

Passaram 331/331 cumulativos, cinco testes SQL específicos, 17/17 Python, tipos, sintaxe shell e diff. Root/systemd são fixtures locais; SQL rodou somente em PostgreSQL isolado. Não mudou código visual/textos e não houve novo build ou QA visual: a referência compilada anterior continua a mesma. Contrato: `.cache/admin-integration/candidate-stage01/docs/ETAPA-03-ROLLBACK.md`. Logs: `.cache/admin-audit-20261106/stage03-rollback-{cumulative,pipeline-final,sql-final,typecheck}.log`.

Próximo bloco: consultas administrativas autorizadas de mensagens/tentativas, depois prévia segura e correlação de eventos/IDs. Recuperação de incerteza durante operação normal, interfaces, política de retenção e demais Etapas 2–7 continuam pendentes. Não considerar a integração integral concluída nem iniciar deploy sem autorização específica. Notificações somente para operator-1608598f41@example.invalid.

## Checkpoint 5331053 — metadados de mensagens autorizados

No candidato `admin-v2-stage01`, GET `/api/admin/emails/mensagens` exige Edição ou superior e oferece lista/detalhe de metadados e tentativas. Logs legados sem vínculo são tentativas independentes; logs correlacionados não duplicam mensagens. Paginação conserva microssegundos. Conteúdo, tokens, payloads, ciphertext e erros livres não são expostos. Nenhum texto/interface foi ativado.

Passaram 335/335 cumulativos, quatro específicos, tipos após build, build e HTTP compilado. Na primeira rodada HTTP a expectativa literal do cabeçalho foi ajustada à composição do Next, mantendo exigência de no-store. Relatório `.cache/admin-audit-20261106/runtime-mail-history/mail-history.json`; contrato no candidato `docs/ETAPA-03-CONSULTAS.md`. Assinaturas e registros de envio foram comparados antes/depois e preservados. Sessões fictícias revogadas, temporário 3032 encerrado; prévia 3031 retomada e /admin respondeu 200.

Próximo: prévia segura de conteúdo com autorização própria e dados sensíveis mascarados, correlação de IDs/eventos, recuperação operacional e demais etapas. Retenção/avisos e interfaces continuam pendentes; não confundir este checkpoint com integração completa. Nenhum deploy ou alteração da VPS/revisão de CPFs.

## Checkpoint 45e0a54 — backend da prévia protegida

No candidato `admin-v2-stage01`, o endpoint de prévia exige Total + confirmação extra e audita o autor real. HTML é interpretado e reemitido por lista permitida, com máscaras, sem conteúdo ativo, rede ou corpo bruto; autenticação/senha/OTP/convite ficam restritos. Templates e versões arquivadas não são reescritos. As máscaras são conservadoras, não um classificador universal. A futura interface requer sandbox vazio e AV-9, ainda pendente.

Passaram 343/343 cumulativos, oito específicos, build, tipos e HTTP/navegador nas seis larguras. Zero requisições do documento a rastreadores, sem acesso ao pai, exceções ou erros de console; assinatura/fila/mensagens preservadas e nenhuma escrita de e-mail dev. O defeito de máscara encontrado pelo teste foi corrigido e a falha preservada. Só parse5/entities foram acrescentados: 150 versões anteriores preservadas, sem remoções, instalação física isolada em /home/barre/.cache/peticao-admin-deps-preview-v1.

Contrato no candidato `docs/ETAPA-03-PREVIA.md`; evidências `.cache/admin-audit-20261106/stage03-preview-*` e `runtime-mail-preview/`. Sessão revogada, temporário 3032/navegador encerrados, prévia 3031 retomada (/admin 200). Nenhuma instalação na VPS, alteração de regras/formulários públicos, schema ou revisão de CPFs. IDs/eventos reais, recuperação, retenção, interface/conversas/editor e demais Etapas 2–7 continuam pendentes; não declarar integração integral concluída.

## Checkpoint 790e426 — recibos por tentativa

No candidato `admin-v2-stage01`, os adapters Brevo/MailerSend/SendPulse/Mailrelay/SES passam IDs disponíveis ao journal. Campos são validados; ausência ou falha de leitura do metadado depois do aceite não dispara outro envio. Mailrelay guarda o ID do principal em falha posterior da cópia, conservando incerteza do conjunto. SMTP genérico/dev não inventam ID. Regras de guarda, rodízio, fila, canais e singleAttempt preservadas; sem mensagens/avisos novos.

Passaram 351/351 cumulativos, oito novos (23 direcionados), build, tipos após build e HTTP compilado. Os formatos externos foram testados com fetch/SMTP fictícios e documentação primária, sem chamar provedores reais. O HTTP usou banco de QA novo separado: contato/resposta, uma tentativa por mensagem, duplicação recusada e IDs nulos em dev. Sessão revogada, temporário 3032 encerrado; prévia 3031 retomada com o banco anterior. Contrato no candidato `docs/ETAPA-03-RECIBOS.md`; evidências `.cache/admin-audit-20261106/stage03-receipts-*` e `runtime-mail-receipts/mail-transport.json`.

Não houve deploy, schema, alterações de assinaturas/dados reais ou revisão de CPF. A próxima correlação exige conta/escopo autenticado, destinatário e ID inequívocos; não atribuir eventos atuais por endereço a uma mensagem. Eventos individuais, recuperação, retenção, interfaces/conversas/editor e demais etapas seguem pendentes; AV-1–AV-9 não foram aprovados por ausência de resposta.

## 07/11 — checkpoint b0ab46e: primeiro journal de eventos, SES/SNS

No candidato `admin-v2-stage01`, tentativas ganham escopo opcional do provedor e há journal de eventos mínimos. Associação exige provedor, conta/escopo, ID e destinatário inequívocos; evento antecipado espera o recibo, e colisão posterior retira o vínculo. SNS valida tópico/assinatura antes do processamento. Falha do journal permite retry pelo HTTP 500 existente, sem desfazer a supressão anterior. Entrega só à cópia não marca o principal; abertura/clique com múltiplos destinatários não é atribuído a todos. O cache OAuth SendPulse acompanha a credencial para não reutilizar token da conta anterior.

Passaram 363/363 cumulativos, doze novos (28 direcionados), build, tipos após build, migração e roteiro de HTTP compilado. Migração preservou fila/payload, assinatura fictícia com ID/inscrição/hashes/consentimento/datas e histórico; escopos antigos permanecem nulos. Caso positivo SNS usa certificado fictício no helper; HTTP compilado confirma leitura autorizada e rejeição de envelopes não confiáveis. Não houve notificação real AWS, envio de e-mails, alterações de produção ou da revisão de CPF. Contrato no candidato `docs/ETAPA-03-EVENTOS.md`; evidências `.cache/admin-audit-20261106/stage03-events-*` e `runtime-mail-events/mail-events.json`.

Temporário 3032 encerrado, sessão revogada; prévia 3031 retomada com o banco anterior e /admin respondeu 200. Agora são dez tabelas administrativas aditivas no candidato. Falta conectar coletores dos demais provedores, conferir tópico/conta e política real SNS/IAM antes de deploy, concluir recuperação, retenção, interfaces/editor e demais etapas. AV-1–AV-9 continuam pendentes. Nenhum deploy autorizado ou executado por este checkpoint.


## 07/11 — checkpoint 23e5b0f: eventos das APIs por mensagem

No candidato `admin-v2-stage01`, Brevo, MailerSend e as duas contas Mailrelay passam os fatos disponíveis ao journal por conta/ID/destinatário/data inequívocos. A atividade MailerSend não é usada como ID de mensagem, e SendPulse conserva seu agregado sem inventar horário de entrega a partir do envio. Cada página é persistida antes da próxima; falha de journal conserva supressão/agregado e o próximo ciclo deduplica. Lacunas de identidade continuam explícitas, sem associação por proximidade. Contrato no candidato `docs/ETAPA-03-EVENTOS-API.md`.

Passaram **372/372** cumulativos, nove novos (17 direcionados), build, tipos após build e HTTP compilado com respostas de API injetadas. Uma assinatura confirmada e um item da fila fictícios preservaram todos os dados. O primeiro QA parou antes dos testes por URL localhost; a configuração foi corrigida para o loopback IP exigido, sem relaxar o guard. Sessão revogada, temporário 3032 encerrado, prévia 3031 retomada com banco e configuração anteriores (/admin 200). Evidências `stage03-api-events-*` e `runtime-mail-api-events/mail-api-events.json`.

O diagnóstico anterior da estrutura de respostas reais terminou em modo somente leitura, sem envio de mensagens ou alteração de contas; seu relatório contém apenas flags/formatos/status. Não confundir esse diagnóstico com os testes fictícios ou com cobertura completa do histórico.

Nenhum deploy, schema, regra/visual/aviso público ou revisão de CPF alterado. Próximo bloco: completar eventos autenticados por conta e lacunas de identidade/datas, recuperação operacional/retenção, depois interfaces/conversas/editor e demais Etapas 2–7. A integração completa segue ativa; AV-1–AV-9 e retenção não tiveram aprovação inferida. O deploy final continuará aguardando autorização expressa. Notificações somente para operator-1608598f41@example.invalid.


## 07/11 — checkpoint d421a59: webhooks autenticados por conta

No candidato `admin-v2-stage01`, notificações Brevo/MailerSend/SendPulse conectam-se ao journal com autenticação específica e escopo de conta configurado no servidor. MailerSend v2 é suportado sem retirar o agregado anterior. O ping com chave pública só confirma envelope de teste inerte, nunca atividades. Corpo tem limite em bytes/UTF-8/estrutura; IDs/datas/destinatário continuam necessários sem associação por proximidade. Configuração incompleta falha fechada; falha do journal/agregado em modo vinculado permite repetição, preservando a supressão anterior. A revisão também corrigiu o caso herdado de destinatário ausente/malformado que poderia gravar `undefined` como endereço.

Passaram **383/383 cumulativos**, onze regressões novas, build, tipos após build e HTTP compilado dos três provedores com notificações fictícias. Assinatura confirmada e item de fila anteriores preservaram todos os dados. A primeira rodada de 382/build/HTTP foi mantida como evidência anterior à correção do destinatário; o código final foi novamente validado. Nenhuma chamada a provedor real ou envio de e-mail nos testes. Relatório `runtime-mail-webhook-events/mail-webhook-events.json`, logs `stage03-webhook-events-*` e contrato do candidato `docs/ETAPA-03-EVENTOS-WEBHOOK.md`.

Sessão de QA revogada, temporário 3032 encerrado e prévia 3031 retomada com banco/configuração anteriores (/admin 200). Nenhum schema, aparência/aviso, VPS ou revisão de CPF alterado. Não foram criados/alterados webhooks reais; a conta e a equivalência dos IDs precisam de prova operacional antes de afirmar cobertura real.

Próximo bloco: recuperação operacional das tentativas interrompidas, retenção e integração das consultas/interfaces; conversas/editor e demais Etapas 2–7 continuam no objetivo. A integração inteira não está concluída. AV-1–AV-9 e retenção continuam sem aprovação inferida. Deploy final aguarda autorização explícita; notificações somente a operator-1608598f41@example.invalid.


## 07/11 — checkpoint ac7e859: recuperação operacional de fila sem reenvio

No candidato `admin-v2-stage01`, diagnóstico e conclusão administrativa de fila exigem prova exata do vínculo/conteúdo/destinatário e tentativa finalizada com aceite. Total + confirmação extra e usuário atual são exigidos; o autor não vem do corpo. A conclusão preserva data original do aceite, payload, tentativas e dados de assinatura, sem chamar transporte. Entrega individual, ausência de registro ou tempo decorrido não liberam incerteza. Worker atrasado agora só atualiza itens ainda pendentes, sem sobrescrever uma recuperação concorrente.

Passaram **389/389 cumulativos**, seis regressões novas, build, tipos e HTTP compilado. A primeira falha era a ausência de Host na fixture; corrigida sem relaxar a proteção de origem. O ensaio compilado usou banco novo separado, assinatura e fila fictícias, conferiu autoria/idempotência/microdatas e não chamou transporte/provedor. Contrato do candidato `docs/ETAPA-03-RECUPERACAO.md`; evidências `stage03-mail-recovery-*` e `runtime-mail-recovery/mail-recovery.json`. Sessão revogada, temporário 3032 encerrado, prévia 3031 retomada com banco/configuração anteriores (/admin 200).

O dono aprovou explicitamente, pela resposta nativa “Aprovar estes textos”, o **AV-10**: botão “Concluir fila sem reenviar” e aviso “A fila será concluída com base no aceite já registrado pelo provedor. Nenhum e-mail será reenviado. Isso não comprova entrega ao destinatário.” Essa autorização não se estende aos AV-1–AV-9, retenção ou deploy. O controle visual ainda não foi integrado; este checkpoint é backend e prova de funcionamento.

Não alterei schema, aparência/avisos do app, VPS ou revisão de CPFs. Próximo bloco: integrar controle aprovado e consultas no visual admin-v2. Retenção, conversas/editor e demais Etapas 2–7 continuam no objetivo completo. Nenhum deploy realizado; autorização final continua necessária. Notificações somente a operator-1608598f41@example.invalid.


## 07/11 — checkpoint d7e0542: paginação segura e componente visual preparado

O candidato acrescenta lista de recuperação Total + stepup com scan limitado e cursor estável, inclusive quando um candidato é omitido por divergência de conteúdo. Só ID/tipo/destinatário/data do aceite saem na resposta. Passaram **391/391 cumulativos**, dois testes novos, build, tipos e HTTP compilado com whitelist de metadados; rodada específica anterior 7/7. Relatório `runtime-recovery-list/mail-recovery.json`, logs `stage03-recovery-ui-*` e contrato `docs/ETAPA-03-RECUPERACAO-INTERFACE.md` do candidato.

`RecuperarFila.tsx` está preparado, mas NÃO importado/ativado na página. Isso respeita a regra do dono: AV-10 aprovado cobre botão/modal, enquanto complementos da tabela e erros (AV-11) e erro de paginação (AV-12) foram perguntados em mensagens nativas e enviados somente ao dono por e-mail. Nenhuma aprovação inferida, nenhuma validação visual/interativa alegada. Após aprovação, conectar à seção existente e testar quatro níveis/seis larguras, falhas antes/depois do commit, duplo clique, cancelamento/foco e paginação.

Ponte conferida somente leitura: serviços Vigia e respostas ativos, consulta saudável, duas mensagens autenticadas anteriores e nenhuma nova aprovação desses textos. Mensagem de 06/11 22:27 UTC pede que o CPF inválido limpe o aviso/borda ao focar novamente; o candidato tem blur/touched e não handler de foco. Registrado para regressão pública/comparação da VPS, sem modificar formulário neste bloco. O resumo legado de fila também precisa de texto aprovado para distinguir falha/retido de desistência de 48 h; não corrigir por contagem enganosa.

Sessão de QA revogada, temporário 3032 encerrado, prévia 3031 retomada com banco/configuração anteriores (/admin 200); banco de QA separado preservado. Sem schema, interface ativa, VPS ou revisão de CPF alterados. Retenção, conversas/editor, demais interfaces e Etapas 2–7 continuam no objetivo completo; sem deploy e sem aprovação final inferida. A mensagem de complementos foi aceita pelo serviço de e-mail (não é confirmação de entrega), destinada só a operator-1608598f41@example.invalid.


## 07/11 — checkpoint 4f9f9f0: triagem atualizada por evidências

O candidato acrescenta rodízio limitado para revisar diagnósticos concluídos diante de mudança de input/evidência das fontes existentes. HMAC canônico ignora relógio e texto livre, considera expiração relevante, e não cria revisão por polling sem mudança. Antes de enfileirar, confere novamente o contato e a última revisão: pedido manual/concorrente mais recente vence. Esgotados/outros motores não são reiniciados automaticamente. Revisões e decisões humanas permanecem; a rotina não altera cadastro nem envia resposta.

Passaram **398/398 cumulativos**, sete regressões novas, primeira rodada direcionada 22/22, build, tipos após build e HTTP compilado. O ensaio percorreu cron autenticado, evento fictício → nova revisão → revisão anterior preservada → rodada estável. Cache CPF/filas/respostas vazios conferidos no banco de QA; sem transporte/provedor ou escrita de assinatura. Contrato do candidato `docs/ETAPA-02-ATUALIZACAO-EVIDENCIAS.md`; evidências `stage02-refresh-*` e `runtime-triage-refresh/triage.json`.

Sessão revogada, temporário 3032 encerrado, prévia 3031 retomada com banco/configuração anteriores (/admin 200); banco de QA novo preservado separadamente. Nenhum schema/interface/VPS/revisão CPF alterado. Esse trabalho independente veio antes das minutas para evitar usar diagnóstico antigo; minutas humanas, novas fontes individuais, curadoria de campus, informes duráveis e integração visual ainda não estão concluídos. Retenção/conversas/editor e demais Etapas 2–7 continuam no objetivo inteiro.

AV-10 permanece aprovado. AV-11/AV-12 e avisos anteriores permanecem pendentes; fila autenticada da Ponte não mostrou novas mensagens de 07/11 na conferência. Não foi inferida aprovação por tempo decorrido. Componente de recuperação continua preparado e não conectado à página. Deploy final continua aguardando autorização expressa; informes só para operator-1608598f41@example.invalid.


## 07/11 — sugestão de resposta vinculada à triagem (737e700)

Backend GET/POST somente leitura, fonte por regras e revisão humana obrigatória. Confere entrada, evidências, análise e última revisão no mesmo snapshot; recusa contexto alterado, pendente ou incompatível. Prova de contexto não autoriza envio e não substitui o selo existente. Não salva minuta nem escolhe retenção. Interface não conectada e textos não ativados.

Passaram **405/405 testes cumulativos**, build, typecheck serial e HTTP compilado. QA confirmou ausência de escrita em assinaturas/envios, bloqueio de prova antiga após nova revisão e recusa da prova como selo até com Total + confirmação extra. Sessões revogadas e prévia original `http://127.0.0.1:3031/admin` restaurada (200). Logs `stage02-suggestion-*.log` e relatório `runtime-triage-suggestion/triage.json` na cache de auditoria, fora do Git.

AV-10 explicitamente aprovado/reconfirmado pelo dono; AV-11/AV-12 e demais textos permanecem pendentes. Nada publicado na VPS; autorização final de deploy segue necessária. Próximo: continuar integração das fontes, minutas humanas/curadoria e interfaces aprovadas, além das etapas restantes do plano completo. Este checkpoint não conclui esse objetivo.


## 07/11 — evidências individuais conectadas à triagem (1ecebc9)

Mensagens, tentativas e eventos vinculados passam a compor a coleta consistente por campos permitidos. Confere associação por conta/recibo/provedor/destinatário e tentativa finalizada; não usa endereço isolado como prova da mensagem. Aceite, entrega, abertura, clique, falhas e incerteza têm diagnósticos distintos; não confirmam assinatura nem autorizam envio. Fonte ausente ou limites excedidos mantêm diagnóstico inconclusivo. Comparação da análise recalculada percebe mudanças efetivas de contexto temporal/campus, além dos metadados; revisões antigas são preservadas.

Passaram **414/414 cumulativos**, nove novos, build, typecheck serial e HTTP compilado (primeira rodada direcionada 37/37). QA compilado: outra conta ignorada, evento vinculado invalida sugestão e agenda revisão via cron, anterior preservada/polling estável. A fixture HTTP sem assinatura não alega resolução; testes de integração com assinante fictício comprovam permanência pendente. Nenhum transporte externo ou escrita de assinaturas. Sessões revogadas e prévia original 3031 retomada (200), com banco/configuração anteriores. Evidências `stage02-outbound-*.log` e `runtime-triage-outbound/triage.json` na cache de auditoria; contrato no candidato `docs/ETAPA-02-EVIDENCIAS-MENSAGENS.md`.

Nada publicado ou alterado na interface, schema ou revisão CPF. Vigia e respostas ativos na verificação; nenhuma aprovação nova na entrada autenticada local de 07/11. AV-10 aprovado, demais avisos/retenção sem aprovação inferida. Próximo: curadoria/aprovação de campus; persistência de minutas humanas, informes, interfaces, conversas/editor e etapas restantes continuam no objetivo completo. Deploy final exige autorização do dono.


## 07/11 — gate de migração atualizado e executado (72ec622)

O ensaio `deploy/test/admin-schema-upgrade.mjs` falhou na execução atual por esperar nove tabelas aditivas; `mail_message_events` é a décima. A falha anterior foi preservada. Atualizada a lista exata e ampliado o ensaio da fundação anterior ao escopo de conta/eventos: mantém conta desconhecida como NULL, não fabrica entrega, conserva recibo/estado/horários com microssegundos e eventos vinculados na repetição do DDL atual e bootstrap anterior. Três índices de correlação verificados. Demais invariantes de esquema/assinantes/fila/históricos permanecem exigidos.

Rodada final aprovada em PostgreSQL fictício 54341, esquema temporário removido. Logs `stage07-schema-current-before.log`, `-after.log` e `-final.log` na cache; contrato no candidato `docs/ETAPA-07-ENSAIO-SCHEMA-ATUAL.md`. Teste/documentação apenas, sem mudança de aplicação ou DDL; 414 cumulativos/build/tipos/HTTP da aplicação continuam sendo a evidência anterior, sem repetição desnecessária. Não é prova de instalação na VPS nem de compatibilidade com alterações futuras.

Próximo: curadoria de campus e demais partes já autorizadas. A integração completa permanece ativa e incompleta; deploy não autorizado, avisos pendentes sem aprovação inferida.


## 07/11 — curadoria de referência de campus (465f69d)

Prévia somente leitura e decisões humanas versionadas, sem publicação automática. Exige conta real, Edição para prever/consultar e Total + confirmação extra para registrar; revalida usuário ativo/nível/e-mail na transação. Intenção vincula dados normalizados, classificação pública atual, contato/triagem/input, revisor/decisão e ID anterior. Histórico append-only, idempotência e concorrência com auditoria atômica. Não modifica assinaturas, filas, respostas ou JSON público. Valida IFES/IBGE e sintaxe de URL, sem buscar fonte ou declarar comprovação automática.

Teste inicial revelou marcador `[cpf]` produzido pela ocultação de número incidental desviando um pedido de campus. Corrigida a classificação sem expor o número nem alterar categorias explícitas de CPF; regressão adicionada e falha inicial preservada. Passaram **30/30 direcionados, 422/422 cumulativos**, migração (11 tabelas aditivas com decisões/autoria/microssegundos preservados no DDL atual/bootstrap anterior), build, tipos e HTTP compilado. QA confirmou permissões/stepup, preview sem escrita, prova ligada ao revisor, correção preservando a anterior e recusa de intenção antiga; sem transporte real ou mudança de assinante/fonte pública.

Sessões revogadas, temporário encerrado, prévia original 3031 restaurada com banco/configuração anteriores (200). Contrato no candidato `docs/ETAPA-02-CURADORIA-CAMPUS.md`; logs `stage02-campus-*` e `runtime-campus/campus.json` na cache de auditoria. O primeiro node --check do roteiro usou caminho relativo ao diretório errado; foi corrigido para absoluto e passou, sem repetir os cumulativos por isso. Não houve falha de sintaxe do roteiro nem mudança de proteção.

Nenhuma interface/aviso ativado, VPS/revisão CPF alterada. Backend não equivale à interface de curadoria concluída. Próximo: base de conhecimento compartilhada com fontes/curadoria, preservando as três funções IA. Minutas humanas, informes duráveis, interfaces, conversas/editor/retenção e demais etapas continuam no objetivo completo. AV-10 aprovado, demais textos e retenção sem aprovação inferida; autorização final de deploy segue necessária. Vigia e respostas estavam ativos e não havia nova entrada autenticada local de 07/11 na conferência.
