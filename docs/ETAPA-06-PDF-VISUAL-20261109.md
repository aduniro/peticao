# Etapa6 — inspeção visual independente de PDF fictício

Estado: **continue**. Prova do renderizador existente, não conclusão de documentos,
portal externo, build global ou assinatura. Nenhum código do aplicativo alterado.

Na retomada, `06e4792` já continha o portal local validado. O log
`/tmp/admin-batch-local-900tsz5y/validation.log` foi conferido:29/29, saída0.
Durante a inspeção, outra execução commitou `e1abf8e`, snapshot/retomada de preparo;
seu relatório registra42/42, schema e tipos direcionados. Não repeti esses testes
nem assumi seus arquivos. Foi solicitada confirmação de posse para evitar edição
concorrente. O checkpoint inicial que dizia portal apenas em working tree estava
defasado; isso não foi interpretado como autorização para sobrescrever o código.

## Prova realizada nesta execução

Novo roteiro `tools/admin-qa/document-pdf-visual.mjs`, sem bootstrap do aplicativo,
banco, servidor, mail ou provedor. Usa o `buildBatchPdf` commitado, três pessoas
explicitamente fictícias (Servidor/Apoiador/Exterior), origem127.0.0.1 e marca de
prévia em todas as páginas. Não lê cadastros, revisões CPF, ambiente real ou cofre.
Hashes de13 fontes/assets explícitos conferidos antes/depois, sem mudanças.

A skill PDF foi usada para renderizar e inspecionar o resultado. Seu marcador de
criação terminou0 antes da geração. Comando efetivo no diretório `site/`:

`env MAIL_PROVIDER=dev NODE_ENV=test node --import tsx ../tools/admin-qa/document-pdf-visual.mjs`

Saída0. `pdfinfo`: cinco páginas A4, sem JavaScript, sem formulário ou criptografia.
Renderização `pdftoppm -r 90 -png`: saída0. As cinco imagens foram efetivamente
inspecionadas: título, logos, parágrafos, blocos, rodapés, nomes fictícios e matrizes
QR legíveis, sem sobreposição/corte/glifos ausentes visíveis nesta fixture. A página
de dois registros tem espaço restante esperado; nenhuma estética foi alterada.

`pdftotext -layout` e assertions Python conferiram os três nomes, três códigos,
rodapé de QA nas cinco páginas e `NAO ASSINADO (teste)`. QR verificado visualmente,
não decodificado por máquina nem consultado por rede. O PDF não é assinatura ICP.

Artefatos privados, fora Git: `.cache/qa-document-pdf-20261109/`, com PDF,
`page-1.png` a `page-5.png`, texto extraído, `render.json` e `inspection.json`.
SHA-256 do PDF observado:
`7333f5a5c3b0bb8749b3ccca0aa82467944d9ab11a4e4b591cfa79cfe7aaa8ba`.
O renderizador pode incluir data técnica de criação; esta prova não promete
reprodutibilidade binária de arquivo que ainda não existia.

## Limites e continuidade

Não executado build, typecheck global, navegador ou fluxos do WIP IA/editor.
Esses WIPs continuam preservados. Esta geração não importa seus módulos nem
contorna a interrupção; é apenas o renderizador de PDF existente com dados falsos.
Sem alteração de `db.ts`, `batches.ts`, portal, avisos públicos, CPF, outros
worktrees, envio externo ou VPS.

O commit desta unidade identifica apenas o roteiro e o relatório. Após esta
inspeção, o principal informou a integração `6f7a462` do QA compilado `26a1092`,
com build/tipos,11 testes, seis larguras, ICP e bytes. Não repetir essa etapa nem
continuar registrando a janela como pendente. A prova aqui é complementar: cinco
páginas do PDF fictício renderizadas e inspecionadas, incluindo as duas partes.
O relatório integrado inspecionou uma fixture de três páginas e sua página3;
esta unidade acrescenta inspeção de todas as cinco páginas com Brasil/exterior.
As provas integradas pertencem à base isolada descrita em
`QA-PORTAL-PRESIDENTE-20261109.md`, não a um build global verde dos WIPs atuais.

Coordenação vigente: `apoio_pontual` possui o adapter/desafio; outras frentes
possuem triagem/campus. Não editar `db.ts`, `batches.ts` ou portal. A próxima
unidade desta frente requer nova coordenação. Métodos externos, credenciais e
homologação mantêm seus gates; não declarar painel/Etapa6 integralmente concluídos.
