# Dispersão: integração e critérios de aceite local

## Problema e comportamento pretendido

A consulta anterior limitava a base a5000 registros na tela e50000 no CSV, interrompia o cálculo após20 gerações e omitia componentes sem raiz. A árvore da interface também cortava profundidade. Esses cortes não comprovavam cobertura completa.

O novo núcleo analisa todos os registros da fotografia consultada, iterativamente. Código desconhecido, vínculo pessoal sem titular e ciclos permanecem contados com a situação original da assinatura. Geração e alcance indeterminados ficam nulos; os diagnósticos descrevem vínculos, sem invalidar assinaturas. Nomes de quem indicou são resolvidos na base global, mesmo fora da página atual.

## Decisões registradas

- Pergunta que seria feita: criar um snapshot persistente/job de exportação? Decisão: consulta completa por REPEATABLE READ, sem novas tabelas ou jobs, com horário próprio por resposta. A navegação informa que páginas podem refletir momentos diferentes. Custo O(N) por consulta; não alegar revisão congelada entre páginas.
- Pergunta: ocultar anomalias ou assumir geração0? Decisão: manter todos os IDs, geração/alcance nulos quando não comprovados e cobertura explícita. Confirmados continuam confirmados.
- Pergunta: limitar o total por volume? Decisão: orçamento explícito de recursos e tempo, falhando a leitura inteira quando excedido. Nunca truncar um resultado bem-sucedido.
- Pergunta: baixar CSV em streaming? Decisão: preservar19 colunas e nome do arquivo, materializar completamente, conferir contagem/IDs/bytes/SHA256 e reautorizar antes de retornar HTTP200. Auditoria em transação separada READ COMMITTED, após fechar a fotografia, registra preparação do arquivo, não recebimento.
- Permissões preservadas: Edição ou superior, porque a base interna inclui e-mail. Consultas de árvore/diagnósticos não incluem e-mail.
- Preservar classes/fontes/estética do painel; a navegação em árvore passa a consultas de raízes/filhos, sem DOM recursivo. Novos textos reversíveis identificados com MUDAR AQUI.

## Evidências já obtidas

- Núcleo puro:10 testes, incluindo floresta e cadeia de50001 registros. Primeira rodada integrada grafo/contrato/CSV:14/14, sem omitidos; exportação inclui a linha50001. Essa rodada precede a integração final da interface e não substitui o aceite final.
- Tipos globais aprovados com fontes/runtime estáveis em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/types-1794313451515272479/result.json` para backend inicial. A interface e os testes PG ainda serão incorporados.

## Pendências antes de declarar conclusão

- Integrar interface e adapter legado sem preservar os cortes antigos.
- Validar banco fictício: permissões/sessão vigente, contagens completas, paginação, ciclos e vínculos, mais de50000 registros, exportação/auditoria e ausência de alterações cadastrais.
- Repetir tipos no conjunto final e executar build/Next compilado com PostgreSQL fictício.
- Conferir interface, erros, resposta tardia/troca de ator e larguras de tela; preservar as evidências e atualizar critérios do Vigia somente após passar.

Nenhum deploy, merge, sincronização com a VPS ou envio de mensagens integra esta etapa.

## Coorte integrada: regressão com banco

30/30 testes passaram, sem omitidos, fontes/HEAD/runtime estáveis, em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/dispersion-1794313996752309522/result.json`. Inclui os casos anteriores de campanha, interface pura, grafos e CSV, mais consultas reais PostgreSQL: autorização atual Edição/sessão, paginação137/136filhos, diagnóstico de ciclos/legados, expiração durante processamento e exportação50001 com auditoria reautorizada/rollback. A primeira rodada29/30 falhou somente porque a fixture criava dois códigos pessoais para o mesmo titular, violando UNIQUE(signature_id); corrigido somente o titular do segundo código fictício, sem alterar schema/regra de produção.

Tipos globais com interface passaram em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/types-1794313638813536589/result.json`; o build seguinte revalidará a coorte final com o novo teste PG. O aceite completo aguarda build e navegação Next compilada.
