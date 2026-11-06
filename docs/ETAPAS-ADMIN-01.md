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
