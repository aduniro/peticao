# Etapas 0 e 1 — execução autorizada

Autorização autenticada recebida pela Ponte em 06/11/2026 às 20:57 UTC: executar Etapas 0 e 1. Identidade do remetente e DKIM conferidos. Não autoriza deploy.

Checkpoint de origem: f6bf4b6; tag admin-integration-approved-20261106.
Candidato isolado: /mnt/dev/peticao/.cache/admin-integration/candidate-stage01, ramo admin-v2-stage01.
Base: snapshot sanitizado da produção real atualizado em 06/11/2026, preservando correções posteriores de CPF/cache/formulário.

Estado: checkpoint da Etapa 0 concluído (e0f54e2); primeiro porte administrativo isolado commitado (da9fee6). Etapa 1 em andamento, não concluída e não publicada.

Primeira rodada: 50/51 testes administrativos aprovados; a falha restante dependia da base GeoIP ausente no checkout novo. A base local foi vinculada para a repetição, sem alterar a política de geolocalização. Ainda faltam os testes e correções de concorrência, publicação vinculada ao candidato e a validação cumulativa/visual previstos no plano.

Correções iniciais: coluna ts na saúde de e-mails, uptime do processo e captura de falhas de rede nos três componentes administrativos, mantendo rascunhos.


## Retomada após o deploy dos formulários

A produção foi conferida novamente por inventário sanitizado. Apenas três arquivos públicos haviam mudado desde a captura administrativa: `SignForm.tsx`, `pt.ts` e `email-feedback.ts`. Os três foram importados da aplicação efetivamente publicada e conferidos por SHA-256, no commit `77f33f7`. Não foram levados os rascunhos públicos opcionais do checkout principal.

A4: gestão de nível/ativação agora serializa as transações para preservar o último Total ativo; redefinição bloqueia conta e token, consome links e revoga sessões na mesma transação; troca de senha revoga sessões/links e grava auditoria atomicamente. Foram incluídas provas de alterações concorrentes, uso único concorrente e rollback completo quando a auditoria falha. Os 14 testes de usuários passaram no PostgreSQL isolado da porta 54341.

A8: o resumo regional passa a agregar as listas completas antes de aplicar o top 10. O recorte por estado continua limitado apenas na apresentação. A regressão inclui uma IFES fora do top 10 nos dois estados, mas líder quando a região é somada. Os nove testes de rankings passaram. A checagem TypeScript também passou.

Ainda não concluído: A3 (publicação vinculada ao candidato), contratos/autoria de A6 e demais controles da Etapa 1, ensaio explícito das seis tabelas, QA visual/permissões e testes cumulativos finais. Não há autorização para deploy do admin. O texto da tela Minha conta sobre encerramento de sessões foi proposto ao dono, seguindo a regra de aprovação de avisos; aguarda resposta e não foi alterado. O candidato não pode ser liberado com o aviso antigo contradizendo a nova revogação.

As Etapas 2–7 do plano continuam no escopo. A instalação do Vigia contínuo e do respondedor privado foi tratada no checkout principal a pedido expresso do dono, sem alterações na aplicação da VPS ou na revisão local de CPF/nome.

## A3 — candidato de publicação vinculado à simulação

Implementado no candidato, ainda sem instalação na VPS:

- `publication.py` produz manifesto SHA-256 dos caminhos, conteúdos e permissão de execução do proprietário, incluindo `public/data`, e exclui dependências, build, runtime e segredos. O commit de `VERSAO` é metadado; o hash da árvore é a identidade efetiva.
- O descritor fica sob controle de root. A simulação devolve o hash e o componente de Ações o devolve na confirmação; a API recusa parâmetro desconhecido, hash ausente ou diferente. O sinal é criado com exclusividade, sem sobrescrever pedido concorrente.
- O executor só chama o programa fixo; consome o sinal, valida idade, tipo, identificador e candidato, e recusa reuso de identificador. Não aceita comando enviado pelo navegador.
- Publicador manual, botão, atualizador do stage e ferramenta de correção compartilham `/run/lock/peticao-deploy.lock` (root:adunir, 640). O descritor herdado é validado pelo inode e pela trava; não é uma variável que simplesmente desliga a proteção.
- A origem é conferida antes da cópia; origem e cópia são conferidas novamente antes da troca. Mudança durante o build preserva a aplicação anterior.
- O instalador `deploy/23-publicacao-segura.sh` prepara a infraestrutura e preserva uma cópia do publicador antigo, sem publicar o app. A ativação do botão exige o publicador atualizado. O Git, se instalado e atualizado, prepara o manifesto após a atualização do stage; também existe comando root fixo `/usr/local/sbin/peticao-publicar-preparar`.

Validação: oito testes Python de identidade e pipeline, incluindo cópia alterada durante o build, stage alterado durante o build, descritor herdado correto e descritor indevido; testes TypeScript de pedido/simulação/replay; checagem de tipos e build de produção aprovados. O pipeline foi ensaiado em diretórios temporários com comandos de infraestrutura substituídos, sem chamar o deploy real.

### Regressão cumulativa

A primeira rodada teve 225/234 aprovações. Nove falhas vinham de fixtures anteriores à consulta obrigatória de apoiadores, de expectativas antigas sobre iniciais e de espera fixa para o log assíncrono de e-mails. Foram portadas apenas as atualizações pertinentes dos testes atuais; não foram levadas mudanças públicas não publicadas. O teste de normalização de e-mails manteve a expectativa do backend da VPS, sem importar a política de aliases ainda não publicada.

Os 30 testes afetados passaram após o ajuste. A rodada cumulativa seguinte passou **235/235**, com zero falhas. As verificações de logs agora aguardam as linhas efetivas, com prazo máximo, em vez de assumir que 600 ms bastam.

### Ensaio de atualização do banco

`deploy/test/admin-schema-upgrade.mjs` usa o esquema SQL da produção preservado em fixture com SHA-256 e exige banco de desenvolvimento em loopback/porta explícita. Cria esquema isolado com duas assinaturas fictícias, executa a inicialização real do candidato, reaplica o DDL e verifica:

- adição exata de `admin_users`, `admin_sessions`, `admin_reset`, `admin_stepup`, `admin_acoes` e `contact_replies`;
- definições das tabelas anteriores preservadas;
- todos os campos dos assinantes e configuração de controle preservados;
- bootstrap do esquema anterior continua compatível com o banco expandido.

O ensaio passou e remove seu esquema ao terminar. Não usa registros de produção nem o SQLite de revisão.

Ainda pendentes na Etapa 1: A6 (autoria, estados finais e idempotência), revisão dos demais controles sensíveis, padronização/QA visual e permissões nos seis tamanhos, e conferência final do candidato com a produção mais recente. A aprovação do texto de Minha conta continua pendente. As Etapas 2–7 permanecem no escopo completo; este checkpoint não conclui a integração e não autoriza deploy.

## A6 — autoria e resultado do Terminal

Checkpoint de código: `4ca0273`.

As rotas de correção de e-mail, reenvio e ações em lote agora repassam a identidade da sessão à auditoria, em vez de usar o autor genérico `admin`. O teste atravessa os handlers reais, verifica o autor e preserva nome, CPF em hash, IDs, sequência, código de verificação e horários. O acesso sem autenticação continua recusado.

No Terminal, pedido e auditoria são gravados atomicamente antes de qualquer comando. O pedido começa como `solicitado`, com `ok=false`. Antes de enviar o comando, o app exige que o serviço anuncie o protocolo novo; um serviço antigo é recusado sem receber o comando.

O serviço continua aceitando a interface textual antiga, mas o app novo usa quadros NDJSON internos: saída em base64 e resultado separado. O resultado é assinado com a chave própria do Terminal e ligado ao nonce e ao hash do comando. A página recebe apenas o texto de sempre; stdout não pode fabricar um resultado de sucesso. A chave não é enviada ao navegador ou gravada nos registros.

O resultado final atualiza a ação e a cadeia de auditoria na mesma transação, uma única vez. Sucesso exige código zero, sem timeout, corte de saída ou erro de inicialização. Interrupção, resultado ausente, protocolo inválido e assinatura inválida não viram sucesso. Falha na gravação final não deixa `ok=true`; o registro inicial permanece sem resultado conclusivo.

Validação: suíte cumulativa **244/244**, tipos e build de produção aprovados. Inclui handlers reais com banco fictício, serviço HTTP local, código de saída não zero, recusa antes do envio a serviço antigo, assinatura forjada, saída tentando imitar resultado, fragmentação UTF-8, timeout/corte, cancelamento e rollback se a auditoria falhar. Os comandos de teste foram inofensivos e executados somente no ambiente local; nenhum comando foi enviado ao Terminal da VPS.

Não foram alterados o componente visual do console, avisos da assinatura, dados da petição, cache de CPF ou configurações/segredos da VPS. A atualização futura do serviço deve acompanhar o app; o instalador 22 permanece pendente de autorização e execução.

A6 ainda não está concluído: `docs/A6-RESPOSTAS-PENDENTES.md` registra a falha das reservas de contato que expiram após dois minutos e o contrato para a fila durável. Controles sensíveis, QA visual/permissões e Etapas 2–7 continuam no escopo. Não publicar este candidato parcial.


## A6 — fila durável de respostas de contato

O candidato agora reserva atomicamente texto e card e os retoma pelo agendador existente. O selo liga destinatário, origem, conteúdo e cópias; o card só é liberado depois do aceite do texto. Resultado ambíguo não apaga histórico nem provoca outra tentativa automática. A fila dos e-mails públicos conserva sua política anterior. Histórico anterior fica como legado, sem disparo automático.

Validação: **251/251** testes cumulativos e tipos aprovados. O ensaio de atualização do banco também passou com histórico administrativo anterior, preservando IDs, autores, resultados e horários, além dos registros originais de assinatura. Detalhes e limitações em `docs/A6-RESPOSTAS-PENDENTES.md`.

Ainda não concluir A6: rótulos do histórico e aviso de resultado inconclusivo aguardam aprovação do dono; sem eles a interface antiga classificaria estados pendentes incorretamente. Também seguem pendentes a revisão de controles sensíveis (inclusive gestão de usuários sem confirmação extra), QA visual/permissões em seis larguras e as Etapas 2–7. Nenhum deploy autorizado ou realizado.

Checkpoint `5a3cbd6`: backend da fila e regressões preservados no Git. O build de produção também passou (`stage01-build-contact.log`), além dos 251 testes, tipos e migração. O candidato continua parcial e sem autorização de publicação.

### Primeira prévia do shell

Prévia local de produção em `http://127.0.0.1:3031/admin`, banco fictício separado na porta 54345 e transporte de e-mail `dev`. A tela de contato vazia respondeu 200 em 320, 390, 768, 992, 1280 e 1920 px, sem exceções de navegador ou rolagem horizontal. Capturas e relatório: `/mnt/dev/peticao/.cache/admin-audit-20261106/visual/contato-*.png` e `contato-shell.json`; a captura de 390 px foi inspecionada visualmente. Essa checagem é apenas do shell/estado vazio: não prova paridade visual integral, funcionamento do editor, conteúdo extenso, matriz de permissões nem o restante das telas. Essas provas permanecem pendentes.


## A4 — confirmação extra e gestão de usuários

Pedidos de código agora reservam o desafio e sua auditoria na mesma transação, com bloqueio por conta/sessão. A quota de três pedidos por hora é serializada entre sessões. Consumo do código, liberação da sessão e auditoria também são atômicos; o mesmo código não libera a sessão duas vezes. A conta e a sessão são relidas no banco: um snapshot anterior não permite usar sessão revogada/expirada ou de outra conta. O e-mail mantém o texto existente e usa o endereço atual da conta; nenhum envio acontece se a reserva falhar.

Gestão de usuários passa pelo fluxo de confirmação extra já existente: a página redireciona antes de exibir os formulários, e o POST exige novamente a confirmação. Não foram introduzidos avisos ou rótulos. Os testes de handler incluem os quatro níveis, origem externa, expiração, ausência de efeitos antes da autorização e autoria real.

Verificação específica: **24/24** testes de contas/step-up/handler e tipos aprovados (`stage01-stepup-atomic.log`, `stage01-typecheck-stepup.log`). A regressão cumulativa passou **256/256** (`stage01-cumulative-stepup.log`); o build de produção desta revisão também passou (`stage01-build-stepup.log`). O status de convite/redefinição que é exibido após falha de transporte ainda precisa ser revisto; não declarar todos os controles de conta concluídos. O aviso de Minha conta, os rótulos de contato, QA completo e Etapas 2–7 continuam pendentes.


### Regressão de navegador do editor de contato

`tools/admin-qa/contact.mjs` foi promovido ao repositório com alvo exclusivo de QA local (servidor 3031, banco 54345, e-mail dev). A ferramenta preserva linhas existentes e usa apenas uma mensagem fictícia marcada. Nas seis larguras (320, 390, 768, 992, 1280, 1920), passou: abrir editor, preencher assunto/corpo, abortar uma única requisição de prévia, preservar rascunho, liberar botão e obter a prévia na tentativa seguinte. Sem exceções de navegador, HTTPs de erro ou falhas de rede não injetadas; sem rolagem horizontal. Nenhum botão Enviar foi acionado.

Relatório: `/mnt/dev/peticao/.cache/admin-audit-20261106/visual/contact-editor.json`; capturas `contact-editor-*.png`; log `stage01-contact-browser.log`. A captura de 320 px foi inspecionada. As capturas de página inteira conservam a posição de rolagem provocada pela interação; não devem ser usadas como prova de posição do cabeçalho no topo. Essa prova funcional não substitui comparação estética integral, teste de card/entrega real ou matriz de páginas por nível. A prévia foi reiniciada somente depois de o build terminar.

Checkpoint funcional da confirmação extra: `aada17c`. Continuam pendentes os avisos já submetidos à aprovação, o resultado de convites/redefinições na interface, demais controles, QA das outras telas e Etapas 2–7. Nenhum deploy nesta rodada.

## A4 — reserva de convites/redefinições e resultado interno

`pedirReset` agora bloqueia a conta antes de contar os pedidos e grava token em hash + auditoria na mesma transação, antes do transporte. Convites e redefinições compartilham a quota de três pedidos/hora; nove chamadas simultâneas no teste reservaram somente três links distintos. Falha na reserva impede o envio; falha posterior conserva a reserva para auditoria/quota, sem alterar senha ou sessões existentes.

O retorno interno distingue `sent`, `queued` e `skipped` (quota/conta indisponível). O transporte padrão passa a devolver o resultado real da fila; os testes legados com transporte injetado sem retorno continuam compatíveis. O registro de resultado inclui o estado, sem token em texto. A resposta pública de recuperação ignora esse detalhe: conta ausente, quota e falha de reserva produziram o mesmo status, redirecionamento e corpo. Esse ensaio não é uma prova de tempos idênticos.

Validação: **260/260** testes cumulativos, tipos e build aprovados (`stage01-cumulative-reset.log`, `stage01-typecheck-reset.log`, `stage01-build-reset.log`). A suíte específica passou 27/27 antes da revisão final da fixture de segredos vazia; a rodada cumulativa inclui essa revisão. Tudo com dados fictícios, transporte injetado e sem chamadas reais de e-mail/Turnstile.

Ainda falta consumir o resultado na interface administrativa: o handler antigo continua exibindo sucesso genérico em situações em que pode haver fila ou ausência de envio. Os dois novos avisos foram submetidos ao dono e ainda não foram inseridos. Não liberar com essa inconsistência. Continuam pendentes os demais avisos já propostos, controles e QA restantes, e Etapas 2–7.

### Conferência atual da VPS

Inventário por SSH somente leitura: 333 arquivos de código, sem diferenças desde a referência após a restauração dos formulários. Sete arquivos críticos do candidato foram comparados por SHA-256 com a VPS: formulário, consulta/cache CPF, identidade, assinatura e handlers de assinar/confirmar; todos idênticos. Evidência: `/mnt/dev/peticao/.cache/admin-audit-20261106/production-contract-reset.json`. Isso confere código, não dados de assinantes, valores de configuração ou compatibilidade integral de todos os módulos. Nenhuma alteração remota foi realizada.

### Achado do QA por nível (a corrigir)

A captura de Leitura em 1280 px (`visual/access-leitura-1280.png`) mostra o aviso existente de nível insuficiente após acesso direto recusado. Porém, a página inicial e o menu ainda exibem atalhos para funções de nível superior e o formulário “Liberar CPF”. O POST é protegido no backend, mas a apresentação precisa ser condicionada ao nível real para evitar controles que não podem ser usados. Não há motivo para mudar rótulos ou estética nessa correção. O ensaio de páginas está em andamento; não considerá-lo aprovação integral do painel.

### Resultado da matriz de páginas por nível

`tools/admin-qa/access.mjs` passou **120 verificações** (quatro níveis × cinco páginas × seis larguras), sem exceções de navegador: Assinaturas, Contato, E-mails, Lotes e Usuários. Também conferiu a ausência de sessão e o redirecionamento de Total sem confirmação extra para o fluxo existente. O cenário posterior usa uma sessão fictícia liberada diretamente no banco; não é ensaio de envio/digitação de OTP.

Evidências: `/mnt/dev/peticao/.cache/admin-audit-20261106/visual/access-pages.json`, `access-<nivel>-<largura>.png` e `stage01-access-browser.log`. O servidor temporário 3032 foi encerrado após os testes, e as sessões emitidas pelo roteiro foram revogadas. A prévia 3031 permanece ativa. A ferramenta verifica status/redirecionamento das páginas e exceções do navegador; não afirma inspeção completa de todos os endpoints assíncronos.

O achado de controles/atalhos indevidos para Leitura permanece aberto: a matriz demonstra o bloqueio das páginas, não corrige a visibilidade dos controles. Os avisos submetidos ao dono estão reunidos em `docs/ADMIN-AVISOS-PARA-APROVACAO.md`, todos pendentes de aprovação. Continuam pendentes QA das demais telas e Etapas 2–7; não publicar este candidato parcial.

## Visibilidade dos controles por nível — implementação local

A regra dos quatro níveis foi extraída para `admin-levels.ts`, sem banco/segredos e segura para componentes do navegador; `admin-users.ts` reexporta a interface existente. Níveis desconhecidos passam a ser recusados explicitamente. O menu usa o nível completo da sessão, em vez de apenas Total/não Total: Leitura vê consultas permitidas, Edição/Exclusão incluem funções de edição e Total conserva todos os itens.

No painel inicial, atalhos incompatíveis e “Liberar CPF” deixam de aparecer para níveis sem acesso. “Ver pendentes” acompanha a permissão do painel de e-mails. A barra inferior mantém as sete posições; atalhos indisponíveis usam espaços sem foco/sem conteúdo acessível para preservar Menu à esquerda e Filtros à direita. Não foram alterados CSS, fontes, ícones, rótulos ou avisos.

Verificação inicial: três testes de UI/permissões e tipos aprovados (`stage01-role-menu.log`, `stage01-typecheck-role-ui.log`). A suíte cumulativa passou **261/261** e o build de produção também passou (`stage01-cumulative-role-ui.log`, `stage01-build-role-ui.log`). O roteiro de navegador foi ampliado para verificar controles e gaveta por nível, posições da barra, erros HTTP/rede e rolagem horizontal; ainda não declarar este achado corrigido no runtime antes dessa execução.

### Ajuste do isolamento do roteiro de navegador

A primeira execução ampliada parou após 23 casos aprovados: ao reutilizar a página, uma navegação cancelou consultas da página anterior (`dashboard?janela=all` e `alertas`, `net::ERR_ABORTED`). O relatório de falha foi preservado em `visual-role-ui/access-pages.json` e `stage01-role-visibility-browser.log`; não houve exceção JavaScript registrada nesse trecho. O roteiro passou a abrir uma página por caso e conferir todos os erros antes de encerrá-la deliberadamente. Nenhum filtro genérico de mensagem de erro foi introduzido. A repetição isolada está em andamento, com evidências em outro diretório (`visual-role-ui-isolated`) para preservar a primeira execução.

### Visibilidade por nível validada no runtime

Checkpoint de código: `c169f57`. A execução isolada passou **144 casos**: quatro níveis × seis larguras × (controles do painel/menu + cinco páginas). Comprovou atalhos/formulários por nível, gaveta abrindo/fechando, Menu à esquerda/Filtros à direita, bloqueios de acesso direto, ausência de rolagem horizontal e ausência de exceções/erros HTTP/rede durante cada caso ativo. O cenário Total sem confirmação extra e o cenário sem sessão também passaram.

Relatório: `/mnt/dev/peticao/.cache/admin-audit-20261106/visual-role-ui-isolated/access-pages.json`; log `stage01-role-visibility-isolated.log`; 24 capturas `access-<nivel>-<largura>.png`. A captura de Leitura em 1280 px foi inspecionada visualmente: atalhos incompatíveis e liberação de CPF ausentes, mantendo as consultas e o padrão visual. O CSS do painel permanece sem alteração; isso não é prova de paridade por pixel de todas as telas.

O achado específico de controles indevidos para Leitura está corrigido no candidato local. A primeira execução com cancelamentos de navegação foi preservada; a repetição usa páginas separadas, sem filtro de mensagens de erro. O servidor de QA 3032 foi encerrado e suas sessões foram revogadas; a prévia 3031 continua ativa.

A Etapa 1 ainda não está liberada: avisos/estados de contato e convites, aviso de Minha conta, revisão de outros controles/telas e conferência final continuam pendentes. As Etapas 2–7 permanecem no objetivo; este checkpoint não conclui a integração nem autoriza deploy. Nenhuma alteração da VPS ou da revisão local de CPFs nesta rodada.

## Configurações e curadoria de domínios — próxima revisão local

Achados: a preferência era persistida antes da auditoria; decisões de domínio e atualização de metadados também eram separadas da auditoria; a rota usava autor de configuração/genérico e `in` para aceitar tipos, incluindo propriedades herdadas. O candidato passa a salvar preferência/auditoria atomicamente, registra o autor da sessão e usa apenas tipos próprios do catálogo. Tipos desconhecidos mantêm o fallback existente para `outro`; não foram alterados rótulos ou avisos.

Cada decisão manual de domínio usa transação e trava no banco, com atualização dos três metadados institucionais e auditoria. A classificação continua usando a função existente; regras são lidas na própria transação, sem publicar estado não confirmado no cache do processo. Invalidação de cache ocorre depois do commit. O comportamento anterior de rejeição foi preservado; o lote por fonte ainda é uma sequência de decisões por domínio, não uma transação única do lote.

Os testes iniciais passaram para rollback de auditoria/metadados, preservação de todos os demais campos dos assinantes, autor real, tipos herdados e regressão institucional. A suíte cumulativa inclui também duas decisões simultâneas sobre domínio/subdomínio e permissões de curadoria para Leitura/Edição. A interface de configurações bloqueia ambos os interruptores durante uma gravação pendente; o QA de navegador correspondente está preparado, ainda não executado. Tipos, suíte cumulativa **265/265** e build aprovados (`stage01-typecheck-settings-domains.log`, `stage01-cumulative-settings-domains.log`, `stage01-build-settings-domains.log`).


### Configurações validadas no navegador

O teste `tools/admin-qa/settings.mjs` passou nas seis larguras: mantém ambos os interruptores bloqueados durante uma requisição pendente, preserva os estados após aborto deliberado da requisição exata e recupera com gravação real pelo handler/auditoria. Autor confirmado pela sessão, sem exceções, erros HTTP inesperados, falhas de rede não injetadas ou rolagem horizontal.

Evidências: `/mnt/dev/peticao/.cache/admin-audit-20261106/visual-settings/settings.json`, `settings-<largura>.png` e `stage01-settings-browser.log`. A captura de 390 px foi inspecionada visualmente. A preferência fictícia modificada foi restaurada ao valor anterior; a sessão do teste foi revogada. O servidor temporário 3032 foi encerrado; a prévia 3031 permanece ativa.

A correção de domínios foi exercitada em testes de handlers/banco com dados fictícios, não em curadoria real da VPS. O classificador público e seus critérios não foram reescritos. A rejeição preserva o comportamento anterior; a operação por fonte continua sendo uma sequência de transações por domínio. Não afirmar atomicidade de lote por fonte.

Próximo contrato a revisar: `acoes/index.ts` ainda registra ação/auditoria depois do efeito, com gravações separadas. Isso é distinto do journal/protocolo do Terminal já corrigido; a Central ainda exige revisão antes da liberação. Avisos em aprovação, demais telas/contratos e Etapas 2–7 continuam pendentes. Nenhum deploy ou alteração da VPS/SQLite de revisão nesta rodada.


## A6 — registro durável da Central

Ações de escrita passam a registrar admissão/ator/parâmetros/pedido com auditoria antes do efeito. Efeitos de reenvio e lease do Terminal usam a mesma transação do resultado final; pedidos externos têm aceite/indeterminação separados da conclusão. A trava é por grupo e esquema. O identificador do sinal de publicação já está persistido antes da escrita. O aviso do Terminal ocorre depois do commit e não mantém a trava ocupada; desligamento continua possível durante a espera.

Validação: **277/277** cumulativos, 27/27 específicos, tipos, build e migração com histórico anterior aprovados. O navegador passou nas seis larguras em consultas/simulações com falha de rede e recuperação, sem executar publicação, reenvio ou Terminal. O servidor temporário 3032 foi encerrado e a sessão revogada; prévia 3031 preservada.

Contrato/evidências/limites em `docs/A6-CENTRAL-JOURNAL.md`. A6 continua parcial: faltam vínculo único simulação/execução para retries HTTP, histórico/fluxo controlado de conciliação e avisos em aprovação (AV-5/AV-6). A descrição estática e as dicas da janela não foram alteradas antes da aprovação; não mudar a janela/público-alvo. As Etapas 2–7 e demais pendências permanecem no objetivo. Nenhum deploy ou alteração da VPS/SQLite de revisão nesta rodada.


## A6 — uma execução por simulação e recuperação de resposta

A rota exige intenção emitida pela simulação e vinculada a ação/parâmetros/administrador; a reserva admite uma única execução. Retentativas devolvem resultado persistido, inclusive após expirar o prazo de admissão. O navegador preserva intenção/parâmetros antes do envio e, ao recarregar, apenas consulta. Publicação liga o ticket ao SHA retornado na simulação. Efeitos externos incertos não são repetidos.

Validação: **283/283** cumulativos, tipos, build e migração legada aprovados. Seis larguras passaram no navegador com resposta perdida depois do efeito, repetição explícita ou recarga sem execução automática, sem erros HTTP inesperados/exceções. Configuração fictícia restaurada e sessão revogada. Evidências e limites em `docs/A6-CENTRAL-JOURNAL.md`; log principal `stage01-cumulative-intent-isolated.log`. A primeira rodada foi preservada: duas falhas resultaram de variável de transporte imposta à suíte; a repetição retirou essa variável sem alterar os testes.

CSS, rótulos, avisos, regras públicas e dados de revisão de CPFs preservados. Permanecem histórico/conciliação controlada, AV-1–AV-6 aguardando resposta, demais controles/telas e Etapas 2–7. Este checkpoint não conclui a integração nem autoriza deploy. Prévia 3031 retomada após o build; servidor temporário 3032 encerrado após QA.

## A6 — backend de histórico/conciliação por comprovante

O candidato inclui consulta paginada Total + step-up e conciliação que aceita apenas comprovante final do executor para o mesmo pedido e candidato. O publicador proposto preserva comprovantes por identificador sem sobrescrita/replay; a situação global mutável não serve como prova. Efeito/auditoria da conciliação são atômicos; autoria original, ID e horário do pedido são preservados. Recusa antes do deploy permite nova intenção; qualquer falha do executor permanece indeterminada para não presumir recuperação de deploy parcial.

Validação: **292/292** cumulativos finais, tipos/build e oito testes Python aprovados. Regra conservadora conferida também no artefato compilado. Regressão de navegador nas seis larguras aprovada, sem efeitos duplicados, erros HTTP inesperados ou exceções; preferência fictícia restaurada, sessão revogada e servidor temporário 3032 encerrado. Prévia 3031 retomada após o build.

Detalhes, evidências e limites em `docs/A6-CENTRAL-JOURNAL.md`. Interface de histórico/conferência aguarda aprovação de AV-7; falhas parciais/sem prova ainda exigem procedimento operacional controlado, sem edição SQL ou veredito livre no navegador. AV-1–AV-6, demais telas e Etapas 2–7 continuam pendentes. Nenhuma instalação remota, modificação de dados reais/revisão local ou autorização de deploy.


## Continuidade — primeiro backend da Etapa 2

A integração prossegue além da Etapa 1. Implementados no candidato a classificação por regras, coleta parametrizada por campos permitidos em transação de leitura, proposta de campus e fila durável/versionada de triagem. O agendador existente autentica antes do processamento. A análise não altera assinaturas, listas de campus ou decisões humanas e não envia respostas. Fontes insuficientes não viram aprovação; aceite de transporte não vira prova de entrega.

**307/307** cumulativos, tipos, build, migração de sete tabelas aditivas e teste HTTP do app compilado aprovados. Contrato, evidências e pendências em `docs/ETAPA-02-TRIAGEM.md`; base observada para a Etapa 3 em `docs/ETAPA-03-BASE-MENSAGENS.md`. A interface de triagem aguarda AV-8 e não foi ativada. Etapa 2 e integração integral ainda incompletas; nenhuma autorização de publicação foi inferida.

## Continuidade — base inicial da Etapa 3

Adicionadas no candidato a identidade de mensagem/pedido, cópia criptografada opcional, versões e tentativas duráveis. Vínculo de fila verifica conteúdo exato; resultados repetidos não duplicam logs e incerteza não vira recusa. A política de conteúdo não foi escolhida automaticamente: foi perguntada ao dono. O transporte e a fila atuais ainda não chamam essa biblioteca; conexão, eventos, consultas autorizadas e interface continuam pendentes.

**318/318** cumulativos, tipos/build e migração de nove tabelas aditivas + duas colunas opcionais aprovados, preservando dados legados. Contrato/evidências em `docs/ETAPA-03-BASE-MENSAGENS.md`. Nenhum deploy, aviso alterado ou rotina nova de arquivo automático instalada. Etapas 2/3 e integração integral continuam incompletas.


## Continuidade — conexão inicial de mensagens ao envio/fila

`sendMail` e o worker agora usam identidade/journal; contato conserva reserva, tentativa única e ausência de fila automática. A fila preserva a identidade e o envelope observado e pode recuperar aceite conhecido sem enviar de novo. Conteúdo só é copiado mediante política explícita; nenhuma opção foi ativada. Contrato/limites em `docs/ETAPA-03-TRANSPORTE.md`.

**326/326** cumulativos com paralelismo limitado e sem build concorrente, tipos/build/migração e HTTP do app compilado aprovados. Os logs anteriores foram preservados, incluindo a sonda local que ultrapassou 300 ms por carga. Nenhuma regra pública foi relaxada. Permanecem recuperação operacional, eventos/IDs reais dos provedores, política completa, consultas autorizadas, prévia segura, interfaces e demais etapas. Nenhum deploy.

## Continuidade — rollback protegido das filas correlacionadas

O candidato inclui guard root fixo e SQL transacional antes de retornar ao worker anterior. Aceite comprovado recupera a fila sem envio; demais itens correlacionados ficam retidos para investigação. Falha do guard impede iniciar o código antigo, preservando app.old; nova publicação recusa recuperação anterior não resolvida. Payloads, mensagens, tentativas e assinaturas permanecem preservados. Contrato e limites em `docs/ETAPA-03-ROLLBACK.md`.

**331/331** cumulativos, cinco testes SQL específicos, **17/17** Python, tipos, sintaxe shell e diff sem erros. Systemd/root foram simulados; SQL usou PostgreSQL fictício isolado. Não houve alteração de componentes/textos/estilos, nem build novo: o build anterior permanece referência do código aplicativo inalterado, não certificação da integração integral. Nenhum guard instalado/executado na VPS, deploy ou mudança da revisão de CPFs. Continuam pendentes consultas administrativas, recuperação operacional normal, IDs/eventos reais, interfaces e demais Etapas 2–7.

## Continuidade — consulta autorizada de mensagens/tentativas

O candidato inclui GET de metadados por Edição ou superior, com lista paginada, filtros exatos e detalhe limitado. Mensagens novas e tentativas legadas sem vínculo mantêm fontes distintas; log correlacionado não duplica mensagem. O cursor preserva microssegundos/desempate. Conteúdo, tokens, payloads, ciphertext, fingerprints e erro livre não integram a resposta; leitura não renova nem expurga arquivo. Contrato em `docs/ETAPA-03-CONSULTAS.md`.

**335/335** cumulativos, quatro específicos, tipos/build e HTTP compilado aprovados. O roteiro preserva assinaturas e registros de envio, usa apenas contas fictícias e revoga sessões. A primeira asserção de cache foi corrigida para conferir a diretiva no-store composta pelo Next, sem alterar o endpoint ou relaxar proteção. Prévia 3031 retomada, temporário 3032 encerrado. Não houve deploy, novo texto/interface ou migração. Prévia segura de conteúdo, recuperação operacional, IDs/eventos reais, conversas/editor, triagem visual e demais Etapas 2–7 continuam pendentes.

## Continuidade — backend da prévia protegida

Endpoint separado exige Total + confirmação extra e audita o autor real antes de liberar somente HTML transformado, texto/assunto mascarados e metadados de anexos. Credenciais de autenticação ficam restritas. Parser HTML com emissão por lista permitida remove conteúdo ativo/rede; a futura interface deverá usar sandbox vazio. Arquivo original e templates enviados são preservados. Contrato e limites em `docs/ETAPA-03-PREVIA.md`.

**343/343** cumulativos, oito específicos, build, tipos e HTTP/navegador nas seis larguras aprovados. A máscara foi corrigida após teste detectar código adjacente entre blocos; evidência da falha foi preservada. Duas dependências novas, sem alterar/remover as 150 versões anteriores, em instalação isolada do candidato. Sessão revogada, temporário 3032/navegador encerrados, prévia 3031 retomada. Nada publicado na VPS. AV-9/interface, retenção completa, IDs/eventos reais, recuperação, conversas/editor e demais Etapas 2–7 continuam pendentes.

## Continuidade — captura de recibos dos provedores

Brevo, MailerSend, SendPulse, Mailrelay/conta presidente e SES documentado passam seus IDs disponíveis ao journal da tentativa. SMTP genérico/dev não fabricam ID. Metadado ausente/inválido/quebrado após aceite não aciona failover. Mailrelay conserva o recibo do principal quando a cópia posterior falha, sem marcar o conjunto como confirmado. Contrato/limites em `docs/ETAPA-03-RECIBOS.md`.

**351/351** cumulativos, oito novos (23 direcionados), tipos/build e HTTP compilado aprovados. Dados e respostas de provedores fictícios; HTTP só dev. O teste de marketing exigiu configuração correta da fixture, sem relaxar a guarda. QA usou banco novo separado do banco da prévia anterior, retomado depois; temporário 3032 encerrado e sessão revogada. Nenhum deploy, schema, aviso/interface, assinatura real ou revisão de CPF alterado. Eventos por mensagem/conta, recuperação, retenção, interface/conversas/editor e demais Etapas 2–7 permanecem no escopo pendente.

## Continuidade — primeiro vínculo de eventos, SES/SNS

Adicionados escopo opcional de tentativa e journal de fatos mínimos; recibos agora capturam o escopo usado sem copiar credenciais. Eventos só se associam por provedor/escopo/ID/destinatário inequívocos. Recibo tardio concilia atomicamente; colisão posterior retira vínculo. SNS exige tópico/assinatura antes de processar. Falha do journal permite retry pelo HTTP 500 existente, conservando supressão já aplicada. Delivery específico da cópia não marca o principal; Open/Click com vários destinatários não é atribuído a todos. Contrato em `docs/ETAPA-03-EVENTOS.md`.

**363/363** cumulativos, doze novos (28 direcionados), build, tipos, migração e roteiro de HTTP compilado aprovados. O fluxo positivo usou criptografia/certificado fictícios pelo helper, sem publicação AWS; a rejeição HTTP e a leitura protegida foram verificadas no app compilado. Sessão revogada, temporário 3032 encerrado e prévia 3031 retomada. Nenhum deploy ou dado real/revisão de CPF alterado. Coletores dos demais provedores, política real SNS/IAM, recuperação, retenção, interfaces/editor e demais Etapas 2–7 seguem pendentes; avisos não aprovados não foram ativados.
