# R1: rascunho de conferência de contexto

Este documento descreve exclusivamente `context_draft.py`, preservado como
protótipo histórico. A proposta concreta posterior está em ACQUISITION.md e
scoped_acquire.py; sua revisão e seus recibos são independentes deste protótipo.

Somente análise offline e testes. Não é gate de publicação aprovado, substituto do
ledger, recibo real ou autorização de execução. Não inclui comandos SSH, API,
leitura/escrita do ledger, aquisição de lease, alteração de atores/ACKs/dispositions,
publicação, intent operacional ou consumo de token. Mesmo todos os dados válidos
produzem `execution_allowed: false`.

O módulo exige evidências congeladas e referências distintas de Root/Apoio para
este contexto. Aceitar bytes com SHA correto comprova integridade, não identidade
ou veracidade: a origem deve ser conferida independentemente. Os pins são entrada
externa revisada; não podem ser derivados automaticamente de dados não confiáveis.
Todos os dados dos testes são fictícios. Não existe pacote real preenchido: faltam
manifesto final, Native QA concluído, revisões próprias e recibos reais do autor.

O contexto diferencia autorização CURRENT do dono, revisão técnica e aquisição
canônica. A interpretação de Executor61 como canal não altera sua condição no
ledger global nem remove o bloqueio da CLI. O helper recusa afirmar sucesso do
gate canônico. Histórico/NACK é preservado; uma substituição Neon não comprova
workers, cutover ou publicação R1. Não há whitelist por número de aviso.

Histórico concluído usa categoria distinta `archived-completed` com estado
`completed-verified`: exige comprovante exato de execução e revisões técnicas
Root/Apoio, além de falta exclusivamente do canal Executor61. Não é retirado,
reclassificado como não executado nem confirmado no ledger. Propostas retiradas
ou substituídas continuam exigindo estado não executado demonstrado. Estado
desconhecido/timeout e NACK sem prova de correção bloqueiam ambas as categorias.

Próxima etapa, sob responsabilidade Root: conferir origens, congelar manifesto e
recibos, obter revisão independente desta rota, resolver reservas conflitantes e
estabelecer uma aquisição legítima que preserve transação atômica/fencing. Qualquer
rota executável futura exige intent durável de uso único antes de SSH, validação
de token/fence/TTL e estado incerto após timeout, sem retry cego. Estes mecanismos
não estão implementados nem comprovados por este rascunho. Ele também não detecta
replay externo sem histórico completo e fresco. Nenhuma autoridade é criada pelo
relatório de contexto.

Escopo exclusivo: imagem SHA256 completa fixada no módulo, source c472837,
runtime verificado; harness precisa de SHA completo real. Não reutilizar em Neon,
outro R1, outras imagens ou qualquer nuvem.

Fontes de processo: AUTHORIZATION.json em admin-v2-query-r1-20261114,
POLITICA-CENTRAL-AUTORIZACOES.md, PROTOCOLO.md e mensagens Root/Apoio de14/11.
São referências de inspeção, não ACKs antecipados deste helper.
