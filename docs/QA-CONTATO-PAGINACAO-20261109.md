# QA compilado da paginação de Contato

Frente independente autorizada após a interrupção do trabalho em rich-text.
Não executou, modificou ou retomou o formatter/sanitizador interrompido. Worktree
`candidate-contact-list-qa-20261109`, branch `qa/contact-list-20261109`, base
`507a63455ff205b559d78e42ef3405324748ac72`. Nenhuma alteração de aplicação foi
necessária nesta rodada; commits desta frente mudam somente QA e documentação.

## Artefato e isolamento

Reutilizado o build fechado da frente Central, saída0 em Node18.19.1, mesma base.
Antes da cópia,879 arquivos rastreados em `site/` foram comparados por SHA256:
idênticos, incluindo package/lock. As duas árvores usaram a mesma instalação
existente `peticao-admin-deps-preview-v1`; nenhuma instalação foi feita.

Cópia própria de `.next` por rsync, seguida de dry-run com checksum/metadados e
delete: saída vazia. Build ID `16RtrGPBE_BUg9IjMmLqv`. A fonte não foi modificada.
Manifesto e identidade em `.cache/contact-list-qa/artifact.json` e
`source-comparison.json`. Prova do build fornecida pela outra frente em
`/tmp/admin-central-visual-build-41_nmvm2/`.

`contact-list-local.py` aceita somente esta worktree, rejeita arquivos `.env` e
qualquer `rich-text*.ts`, usa configuração vazia, porta HTTP3038 e PostgreSQL54358
novos e fictícios. Exige portas livres e lock de execução próprio. O contrato
confere banco inicialmente sem contatos/assinantes/rascunhos/respostas/mensagens/
fila/contas, proíbe destinos externos no navegador e usa entrega dev. Nenhuma
cópia de banco real, segredo, revisão local, VPS ou e-mail real foi acessada.

## Resultados observados

- `python3 tools/admin-qa/contact-list-local.py tests`:3/3 dirigidos, saída0 em
  `/tmp/admin-contact-list-isolated-odx3cbnl/validation.log`.
- `python3 tools/admin-qa/contact-list-local.py http`: saída0 em
  `/tmp/admin-contact-list-isolated-ix1iwjyr/validation.log`, JSON positivo
  `contact-list.json` no mesmo diretório.
- Confirmados: Edição lê sem poder responder; Leitura é recusada; tipo e busca
  são cumulativos; páginas25+5 não repetem registros após nova inserção; filtros
  permanecem nos links; primeira página mostra o novo contato; busca por e-mail,
  vazio e filtro inválido são tratados; falta temporária da tabela é explicitada
  e a consulta volta a funcionar após restauração.
- Contatos originais preservados; nenhuma escrita em assinaturas, rascunhos,
  respostas, mensagens ou fila; nenhum erro não tratado ou requisição externa.
- Capturas320/390/1280px abertas e inspecionadas: controles e conteúdo cabem nas
  larguras e conservam a estética existente. A barra fixa aparece no ponto de
  scroll da captura completa, sem nova regra CSS desta frente.
- Cleanup concluído e portas3038/54358 conferidas livres após o resultado.

## Falhas preservadas, sem mascarar comportamento

1. Rodada `lofm9pm8`: o teste usava `getByLabel("Tipo", exact:true)`. DOM mostrou
   label nativo associado cujo texto inclui as opções; a árvore de acessibilidade
   mostrou corretamente `combobox "Tipo"`. O seletor passou a usar papel/nome
   acessível, mantendo provas explícitas de associação dos dois campos. Não era
   necessária alteração de id/htmlFor, estética ou texto da aplicação.
2. Rodada `s7ve80g8`: o seletor genérico `getByRole("alert")` encontrou o aviso do
   filtro e o anunciador de navegação do Next. A asserção foi delimitada ao `main`
   da página; o aviso e as guardas funcionais foram mantidos. Filtros e páginas
   já haviam passado antes desta falha de fixture.

Logs das falhas, DOM/árvore de acessibilidade, relatório final e três capturas
foram preservados em `.cache/contact-list-qa/`, com manifesto `final-sha256.json`.
SHA256 do relatório final: `4a0f2c5cbb4b55af5e3f437cd9ab0bbd509374bff3490003f801abfa23a213cb`.
O checkpoint para replay do Vigia é `monitor-checkpoint.json`, sem alterar pesos.

Este resultado certifica a paginação desta base. O candidato integrado posterior
precisa de sua própria validação cumulativa; não conclui todo o admin-v2 e não
autoriza deploy ou merge com a VPS.
