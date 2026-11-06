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
