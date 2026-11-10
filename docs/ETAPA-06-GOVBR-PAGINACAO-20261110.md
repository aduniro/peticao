Integração local ao candidato em10/11/2026; tipagem/build/navegador do conjunto novo ainda pendentes. Roteiro preserva provas privadas36/36 e decisões anteriores à integração.

# Inventário da petição-base gov.br — paginação explícita

10/11/2026. Continuidade do módulo Documentos, somente em rascunho separado. Candidato, VPS, seleção, PDFs e schema não foram alterados.

## Questões consideradas e decisões reversíveis

- Como buscar os arquivos posteriores aos20primeiros? Keyset descendente por uploaded_at e UUID, com21linhas para saber se há mais e20para exibir. Não usar OFFSET, que repete/pula registros quando entram novos uploads acima da página atual.
- Como preservar precisão? SQL produz uploaded_at por to_char(... AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'). O cursor transporta todos os6dígitos diretamente ao parâmetro timestamptz de PostgreSQL. O DateJS só confere validade de calendário no prefixo de milissegundos; esse prefixo nunca é usado para seek, comparação ou serialização do cursor.
- Formato? pbase1:<timestamp UTC de27caracteres>:<UUID minúsculo>, máximo80caracteres. É coordenada de leitura, não credencial, autorização nem evidência de assinatura; não precisa conter segredo/MAC. Forma inválida, calendário impossível, ano0000, timezone alternativo, UUID inválido e campos extras são recusados.
- API? GET cursor é mutuamente exclusivo de requestId e de qualquer outro campo. Repetições de parâmetros são recusadas. A leitura exata do upload por requestId continua disponível quando uploads/inventário estão desativados, como antes. POST/upload/validação/seleção/preparo e seus vínculos foram preservados.
- Interface? Botão “Carregar mais” explícito; nenhum carregamento automático. Uma tentativa GET por ação; busyref impede clique duplicado. Lista/cursor são preservados se a leitura falhar. Atualizar/reabrir inicia inventário novo e respostas antigas não podem anexar páginas ao estado novo. Seleção e recuperação de mutações continuam independentes.
- Duplicatas? Append mantém ordem e um registro por artefato; metadados divergentes de bytes/tamanho/timestamp recusam a página. Cursor seguinte deve corresponder ao último registro do lote, impedindo loops. Inserções novas acima do cursor aparecem após Atualizar; não se afirma snapshot transacional de toda a coleção.
- Textos? “Carregar mais” e “Não foi possível carregar mais documentos. Tente novamente.”, autorizados pela autonomia do Goal e marcados MUDAR AQUI. Classes/fontes existentes; nenhum CSS global alterado. Não se mudou o texto dos demais controles.
- Índice/schema? Nenhuma migração nova: coleção administrativa pequena, consulta limitada e statement_timeout existente. Eventual índice deve ser justificado por medição posterior.

## Provas executadas

11testes puros iniciais passaram. Na cópia privada completa,36/36 testes passaram, incluindo5novos casos PostgreSQL de microsegundos/UUID, inserções entre páginas, autorização atual, API/cursor/errors e recuperação exata com feature desligada; regressões existentes de upload/validação/seleção/pacote e controles também passaram. Tipos dirigidos dessa frente passaram. Não é declaração de tipagem global do aplicativo.

Evidência: /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/govbr-pagination-qa-1794303423311916980/result.json e tests.log. Fontes privadas permaneceram estáveis; o único arquivo de origem alterado durante o teste foi a página de Lotes, corrigida pelo root em paralelo. Porta54381 foi confirmada fechada.

A primeira conferência global do espelho parou antes do banco: apontou a propriedade Batch.signed_pdf_sha256 da correção SSR do root e arquivos de fixture que não tinham sido copiados. O root foi informado; a segunda conferência foi dirigida ao escopo desta frente. Não se esconde esse resultado nem se afirma aprovação global.

Browser-fixture/result.json: componente React real compilado com esbuild, somente o wrapper Next não usado é substituído. HTTP de leitura é fictício neste fixture; a API real foi coberta pelos testes PostgreSQL separados. Prova45registros, tentativa GET503sem perda da página, repetição explícita do mesmo cursor, nenhum retry automático/POST, refresh para20novamente, resposta tardia ignorada, seleção preservada,6larguras sem overflow e snapshots.

## Integração futura

Copiar somente os8arquivos enumerados em entrega.json. Reexecutar tipos globais/build e fluxo Next compilado sobre o candidato integrado; rascunho não foi publicado nem incorporado ao candidato. Não somar36aos testes cumulativos: esses casos incluem regressões já existentes.
