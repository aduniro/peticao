# Entidades — aprovação de fonte atômica e versão do estado exibido

Execução a2c08fcae3144ce2b04e21399efc7f20,08/11/2026, candidato isolado
`candidate-stage02-domains`, base1b1f820. Alterações anteriores de e-mail preservadas
separadamente; sua tentativa de commit voltou a ser impedida pelo executor antes
de iniciar (`rejected by user`). Não atribuir causa além do retorno observado.

## Problema e comportamento novo

A rota de aprovação por fonte consultava nomes pendentes e chamava uma transação
por domínio. Uma falha na segunda decisão podia deixar a primeira já confirmada;
o conjunto também podia mudar desde a página exibida. Isso não constituía uma
operação atômica/versionada do lote apresentado.

`approveDomainSource` agora trava/revalida a conta real de Edição ou superior,
serializa com decisões manuais e lê/trava as pendências da fonte. Um HMAC do estado
exibido vincula fonte, conta/e-mail, domínio, tipo, instituição, evidência, autor e
data anteriores. Só o mesmo conjunto/estado pode ser aprovado. A rotina de decisão
individual foi extraída para ser reutilizada na MESMA transação, sem alterar o
classificador ou o comportamento individual/CLI existente. Erro em decisão, selo
ou auditoria reverte o lote inteiro. Cache só é invalidado depois do commit.

O formulário nativo recebe apenas um campo oculto `version`. Rótulos, mensagens,
cores, classes e estilos permanecem os existentes. Versão ausente/alterada/antiga
ou de outra conta retorna409 sem texto novo; conta revogada continua403.
Aprovar uma vez altera o conjunto, portanto repetir aquela versão recebe409 e
não produz outros eventos. Não é ledger de replay de indicação nem promessa de
recuperação transparente da resposta perdida: após conflito, conferir a página.

Novos candidatos anteriores à conferência da versão invalidam o lote; candidatos
inseridos depois da seleção permanecem pendentes e não entram silenciosamente.
Se a fonte contiver mais pendências que as1500 linhas exibidas pela página, uma
assinatura do subconjunto não permite aprovar registros não exibidos. Datas de
visita que alterem `updated_at` também invalidam conservadoramente o estado.

Só a propagação institucional já existente permanece autorizada; o classificador
não foi ampliado. Não editar nome/CPF, hashes, inscrições, datas ou decisões de
revisão. Não integrar hotfixes externos nem publicar referências/campi.

## Validação observada

Helper independente `targeted`:19/19 aprovados, zero falhas/ignorados/cancelados.
Inclui quatro regressões novas: rollback na última auditoria, estado novo/alterado
ou conjunto incompleto, concorrência/autoria revogada e handler com versão opaca.
Os testes existentes conservam classificação domínio/subdomínio, metadados e
guardas. Tipos passaram antes do build. Saída capturada em
`.cache/qa-domain-source-20261108/targeted.log` (runtime ignorado pelo Git).
Build e tipos após build passaram, saída0. Nenhuma tabela ou
coluna acrescentada; esquema continua13 tabelas aditivas.

O roteiro `tools/admin-qa/referrals.mjs` foi ampliado para conferir o HTML real
do campo oculto, versão antiga, rollback na segunda auditoria e dois pedidos
concorrentes pelo endpoint compilado. A execução
`python3 tools/admin-qa/consolidation.py --contracts referrals` NÃO iniciou:
o executor retornou literalmente `Rejected("rejected by user")` antes da criação
do processo. Nenhuma evidência adicional permite atribuir esse retorno a recusa
do dono ou expiração. Não declarar HTTP aprovado para esta nova mudança.

## Pendências desta etapa integral

Isso conclui apenas a proteção do lote, não edição/arquivamento versionados de
todas as entidades. Históricos/campi já possuem versões append-only e consulta
protegida no backend anterior; interfaces e política de arquivamento continuam
explícitas. A pergunta nativa desta sessão solicita distinguir arquivar só na
visão administrativa de retirar regra/fonte de consultas futuras. Ainda sem
resposta observada. Não confundir preservação de histórico com desativação da
curadoria vigente nem aplicar um desses efeitos silenciosamente.

Informes operacionais duráveis somente ao dono continuam não implementados neste
bloco; qualquer integração deve preservar destinatário exclusivo
operator-78ffa47eeb@example.invalid`, HTML, dados mínimos, auditoria e idempotência. Não ativar
envio real como atalho nem tratar um relatório preparado como entregue.
Textos de arquivar/restaurar/conflito/resultado para domínios e campi precisam de
aprovação específica; AV15 do catálogo de remetentes não os aprova. Demais avisos,
AV16, versões individuais, referências/publicação e etapas do painel permanecem
pendentes. Nenhuma alteração de estética, outro worktree ou VPS.

## Checkpoint fiel

Estado **blocked** para o fechamento: ensaio HTTP não executado e commit local
ainda pendente; nada foi registrado em um commit inexistente. As alterações de
domínios estão separadas por caminhos das correções anteriores de e-mail, também
preservadas sem commit, com HEAD1b1f820. Todos os comandos próprios efetivamente
iniciados terminaram (19 direcionados, build e tipos). Não há alegação de teste ou
agente autônomo ainda ativo.

A tentativa específica de commit SOMENTE dos caminhos de domínios/roteiro e deste
documento (`Make domain source approvals atomic and bind them to displayed state`)
também foi impedida antes de iniciar, com o mesmo retorno literal
`Rejected("rejected by user")`. Não houve escrita do índice/commit por esse
comando. O impedimento não foi presumido a partir da tentativa anterior de e-mail.

Próxima ação técnica: autorizar a execução do ensaio HTTP preparado, conferir seu
resultado e criar commits locais separados para e-mails e lote de domínios.
Não repetir testes já aprovados sem nova mudança/falha. Próxima decisão de produto:
definir o efeito de arquivamento e aprovar os respectivos textos antes de alterar
consultas vigentes/interface. Informes duráveis e versões individuais continuam
como trabalho pendente do plano, sem envio ou conclusão inferida.

## Retomada e fechamento do lote

O responsável reiterou que não houve recusa do dono a commits locais, com o
principal acompanhando aprovações técnicas. O commit anterior de e-mails foi
fechado separadamente em `7b4fa11`, sem incluir as alterações de domínios/IA.
Os impedimentos literais acima descrevem as tentativas antigas, não o estado atual.

Executado o HTTP que faltava, sem repetir os19 testes aprovados:
`python3 tools/admin-qa/consolidation.py --contracts referrals`, saída0.
`/tmp/admin-consolidation-7r4aj3l3/referrals.json` foi lido: comprovou versão no HTML,
recusa de estado desatualizado, rollback do lote, concorrência com uma única
aprovação, autor real, origem/nível e preservação das assinaturas. Nenhum envio.
Relatório/log copiados para `.cache/qa-domain-source-20261108/` sem mover originais;
SHA-256 do JSON: `e0bbd38bc3e0eb70598c0ede8c7013b3d2b612d9d1ecaab775aa66cc6a90c170`.
Servidor/banco próprios encerrados. Tipos/build da alteração já aprovados.

O lote atômico/versionado está validado e pronto para o commit local separado
que contém este fechamento. A etapa integral de entidades/campi/informes continua
parcial pelas pendências de produto/backend descritas acima; não se declara
arquivamento, informes ou admin-v2 integral concluídos. Nenhum texto pendente
ativado, regra CPF alterada ou operação na VPS realizada.
