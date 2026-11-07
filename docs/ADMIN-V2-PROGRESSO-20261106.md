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
