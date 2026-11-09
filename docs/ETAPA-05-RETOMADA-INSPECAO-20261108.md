# Etapa05 — retomada e delimitação das frentes

Estado: **continue**, inspeção somente leitura do aplicativo. Não constitui
conclusão de conhecimento/contexto/assistentes nem validação dos WIPs.

## Estado observado

Checkout exclusivo `candidate-stage02-domains`, branch `admin-v2-domain-actors`,
HEAD observado `bb77965` (histórico de mensagens somente leitura). O marco
`d8d45e5` também existe no histórico local. O handoff supervisionado ainda descreve
base `d8b8bac` e pendências antigas; não foi usado como evidência de atividade ou
resultado atual. Os commits e alterações posteriores foram preservados.

Há WIPs modificados em contexto/rotas IA e `ai-context.test.ts`, além de arquivos
novos em `components/admin/ai/`, `ai/limits.ts` e `rich-text*`. Também há mudanças
de dependências. Não foram modificados, importados por testes ou executados nesta
retomada. Permanecem as restrições específicas transmitidas pelo principal após
interrupção automática. O erro global estático informado anteriormente pelo
principal (`rich-text.ts:34`, namespaceURI) não foi corrigido ou excluído.

Os WIPs anteriores do portal de documentos continuam presentes, sem repetição dos
comandos de QA anteriormente recusados. Não foram acessados outros worktrees,
VPS, configurações reais, cofres, bancos ou dados de participantes.

## Base de conhecimento commitada

Foram lidos AGENTS, política central, handoff, documentos ETAPA05, catálogo de
aprovações e as fontes atuais da rota `/api/admin/conhecimento`, `knowledge/search`
e `knowledge/catalog`. Esses três arquivos não apresentaram diff local na inspeção.

A busca lexical existente é somente leitura e separa painel/divulgação/atendimento.
Usa fontes explícitas do repositório e referências de campus revisadas, com versão
SHA-256; não gera resposta, não chama provedor, não envia nem grava consulta.
A rota exige sessão/origem, limita corpo e mantém permissões por finalidade.
Isso é uma base funcional de consulta, não prova de assistente visível completo.

O grafo estático consultado não importa o WIP IA/editor: search importa db,
campus-review e catalog; catalog importa apenas conteúdo explícito e crypto.
Entretanto, o WIP `AiTools.tsx` já integra consulta/apresentação de fontes junto
com contexto/geração. Uma interface nova não será usada para contornar a
interrupção dessa frente por outro caminho ou ferramenta.

## Evidência e próxima ação

Comandos efetivos: `git status --short`, histórico local, leituras dos documentos,
inventário de arquivos e imports por `rg`, diff restrito da camada conhecimento e
`git diff --cached --name-only`. O índice estava vazio na conferência. Não houve
testes, build, migração, browser ou chamada de modelo nesta retomada; resultados
históricos 37/37, 534/534 e545/545 continuam pertencendo aos respectivos snapshots.

Foi solicitada confirmação de posse/frente: interface independente da base
commitada versus inspeção/documentação enquanto os WIPs permanecem congelados.
Até esclarecer esse limite, manter apenas leitura/documentação, sem reexecutar
`--ai-tests` (que incluiria arquivos modificados) ou build global. Após liberação
específica de uma frente independente, implementar em arquivos sob posse definida,
testar com banco/configuração fictícios e transporte simulado, documentar e commitar.
Não presumir aprovação ou conclusão pelo encerramento de um turno.

Nenhuma credencial foi lida, serviço armado, mensagem enviada ou alteração feita
em estética, textos públicos, privacidade, CPF, produção ou VPS.
