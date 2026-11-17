# Etapa 2 — curadoria de referência de campus

07/11/2026. Backend no candidato local. Não conecta novos textos/controles à interface nem publica campus ou aplicação.

## Contrato

`GET /api/admin/contato/campus?contato=<id>` exige Edição e lista até 20 decisões recentes com indicação de truncamento. Não expõe a impressão da intenção ou o relato original. `POST` aceita exclusivamente `{modo:"preview",input}` ou `{modo:"record",input,proof}`, com corpo limitado a 4.096 bytes, mesma origem e respostas sem cache.

`input` contém `contato`, `proposal:{institution,cityIbge,campusName,sourceUrl}`, `decision` (`approved`/`rejected`), `sourceReviewed` e `expectedDecisionId` (ID da decisão substituída, ou `null`). A prévia exige conta real de Edição ou superior e é somente leitura. Registrar exige Total + confirmação extra na API e rechecagem da conta ativa/nível/e-mail dentro da transação.

## Evidência e intenção

Instituição e município precisam existir nas bases atuais. Nome do campus é normalizado e limitado a texto simples. A URL precisa ser HTTPS, sem credenciais, porta alternativa, query ou fragmento, com hostname de domínio; IPs e nomes locais/de teste são recusados. Nenhuma URL é buscada pelo servidor. Isso valida sintaxe, não existência, propriedade ou qualidade da fonte. A aprovação exige que o revisor declare ter conferido a fonte; não há alegação de conferência automática.

A intenção HMAC vincula fatos normalizados, classificação pública atual do município, contato, última triagem concluída da categoria campus/motor atual, entrada do contato, revisor, decisão, conferência da fonte e decisão anterior esperada. A revisão de referência não depende de eventos de entrega de e-mail e não é prova de identidade ou CPF. Mensagem alterada, triagem nova/pendente/incompatível, proposta modificada ou outro revisor invalidam a intenção.

## Preservação

`contact_campus_reviews` é a 11ª tabela aditiva sobre o snapshot de produção. Guarda fatos de referência públicos, ligação à triagem, decisão, autoria e histórico por versão; não copia nome/CPF ou conteúdo do contato. A gravação trava o contato como o fluxo de reanálise e acrescenta versão, sem atualizar decisões anteriores. `expectedDecisionId` impede sobrescrita concorrente; repetição da mesma intenção ainda atual é idempotente. Intenção antiga não revive após outra decisão. Inserção e auditoria são atômicas.

Uma decisão aprovada é uma referência revisada: `published:false`. Não altera JSON público de IFES, cadastro de assinante, município/região de assinatura, PDFs, fila ou mensagens. Publicação de referências e integração visual continuam etapas explícitas; não apresentar este backend como integração completa.

## Correção encontrada nos testes

O marcador `[cpf]` produzido pela ocultação de um número incidental estava sendo interpretado como tópico CPF e desviava pedidos de campus. A classificação agora ignora marcadores de ocultação; a palavra CPF realmente escrita continua sendo considerada. O diagnóstico antigo é preservado e a atualização normal por análise recalculada pode criar nova revisão.

## Validação

Regressões cobrem validação, prévia sem escrita, autoria, permissão revogada, intentos modificados, reanálise, idempotência, correção por nova versão, concorrência, rollback por falha de auditoria, mesma origem, confirmação extra e preservação de assinaturas/fonte pública. A rodada inicial revelou o problema dos marcadores; após a correção passaram **30/30 direcionados e 422/422 cumulativos**. Também passaram migração sobre esquema antigo, build, typecheck serial e HTTP compilado com banco fictício.

O HTTP comprovou Edição/Total, confirmação extra obrigatória, prova ligada ao revisor, prévia sem escrita, repetição idempotente, correção que preserva a anterior e recusa de intenção antiga. Não houve escrita de assinatura, fila, resposta ou JSON público de IFES. Sessões de QA foram revogadas. Evidências `stage02-campus-*.log` e `runtime-campus/campus.json` na cache de auditoria, fora do Git. O primeiro log direcionado com falhas foi preservado. Não é prova de funcionamento de uma interface ainda não conectada ou de deploy na VPS.

Minutas humanas persistentes, informes operacionais duráveis, interfaces, conversas/editor e demais etapas do plano continuam pendentes. AV-10 aprovado; demais avisos e retenção sem aprovação inferida. Deploy final exige autorização do dono.
