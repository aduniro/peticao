# Contato — backend de histórico para conversas/editor

08/11/2026, candidato isolado `candidate-stage02-domains`, base06fd7cd.
Este bloco prepara consultas para a conversa de UM contato recebido; não altera
interface, textos, transporte, decisões de campus ou regras de assinatura/CPF.

## Contrato implementado

`GET /api/admin/contato/historico?contato=<id>` exige conta real ativa de Edição
ou superior. A biblioteca revalida ID/e-mail/nível em snapshot consistente
REPEATABLE READ, READ ONLY, com timeout3s. Conta de prévia/legado com ID0 não
substitui a autorização real. Mesma origem, limite de taxa e no-store preservados.

Retorna o contato original e páginas independentes de metadados de respostas e
decisões de campus, mais a triagem mais recente. Não agrupa contatos/pessoas por
coincidência de endereço. Não lê payloads de e-mail, cifras, selos, tokens de
tentativa, posse do worker, fingerprints ou erros livres de transporte. A leitura
protegida de corpo de e-mail continua em seu fluxo separado, com confirmação
extra; esta API não cria outro caminho para recuperar conteúdo expirado.

`replyBefore`/`campusBefore` são cursores por ID decrescente; `limit` vai de1 a20,
padrão10. Uma linha extra detecta página seguinte. Campos desconhecidos,
duplicados, números não canônicos e limites fora do contrato recebem400.
Inexistente recebe404; conta sem acesso403; fonte indisponível503 sem erro SQL.
Não devolve sucesso parcial se uma fonte falhar.

Estados duráveis (`prepared`, `blocked`, `sending`, `accepted`, `uncertain`,
`rejected`) e legado permanecem distintos; `legacy_ok`/`legacy_scheduled` não são
reinterpretados como entrega. `delivery:not_evaluated` declara o limite da
consulta. `campus.published:false` não publica a decisão humana. Timestamps UTC
são projetados como texto com seis casas decimais, preservando microssegundos.

## Validação observada

`python3 tools/admin-qa/consolidation.py --contact-tests` passou32/32, zero falhas,
ignorados ou cancelados, saída0. Inclui quatro regressões novas de projeção,
paginação com inserção posterior, autoria/permissões e handler real com falha e
recuperação da fonte. Também exercita os testes existentes de campi, respostas,
sugestões e codec de rascunho. Log completo:
`/tmp/admin-consolidation-0x0_r2mf/validation.log`.

Tipos passaram antes e depois do build (`verify_admin_candidate.py types`, saída0).
Build aprovado, saída0. O contrato HTTP compilado passou em
`/tmp/admin-consolidation-v2x7vwjx/contact-history.json`: conta autorizada,
paginação, microssegundos, projeção sem campos privados, ausência de inferência
de entrega/publicação de campus, falha503 da fonte sem dados parciais, recuperação
e revogação da conta. Originais/auditoria comparados antes/depois, sem alteração;
filas e mensagens vazias. O runner encerrou seu servidor/banco com saída0.

Log direcionado, relatório JSON e log HTTP foram copiados para a pasta ignorada
`.cache/qa-contact-history-20261108/`, preservando originais. Os executores desta
etapa já terminaram; não há alegação de QA autônomo ainda rodando.
Nenhuma migração acrescentada; esquema permanece13 tabelas
aditivas. A cumulativa507 do checkpoint06fd7cd é evidência da base, não deste
endpoint novo. Nenhum envio ou escrita em assinaturas foi feito pelos casos novos.

## AV16 e pendências explícitas

Persistência e interface do rascunho compartilhado aguardam AV16. A implementação
atual possui só o codec cifrado de texto parcial, sem tabela/rota de rascunho ou
autosave. Não criar persistência assumindo compartilhamento, propriedade ou
aprovação de mensagens que o responsável ainda não decidiu.

Pergunta restante de decisão: **autoriza um único rascunho compartilhado por
contato entre administradores, com autoria/versão e conflito explícito, ou o
rascunho deve ser individual? Quais textos de salvar/conflito/expiração da proposta
AV16 estão aprovados?** O handoff registra a pendência, mas os textos exatos
submetidos não constam no catálogo deste candidato; não reconstruir um aceite.
A escolha de30dias já está aprovada e não decide essas outras questões.

A pergunta nativa foi emitida nesta sessão, com opções manter pendente,
compartilhado por contato ou individual por administrador/contato. Ainda não há
resposta observada; nenhum aceite foi inferido. Registro também em AV16 no
catálogo de avisos. O backend de histórico independente já foi concluído e
validado; não justifica encerrar todo o checkpoint Contato como concluído.

Ainda faltam persistência versionada com prazo30dias, conflito e expurgo de
rascunhos; conexão do editor/conversas e apresentação de campi sob textos
aprovados; QA dos controles visuais que vierem a ser conectados. Nenhuma resposta
pode ser enviada automaticamente. Este backend é etapa parcial de Contato,
não conclusão do módulo ou do admin-v2 integral. Sem deploy/merge com VPS.
