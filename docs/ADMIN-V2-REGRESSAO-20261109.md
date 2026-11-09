# Regressão cumulativa do candidato

## Rodada preservada

Commit c306185d558cad953b7ce179b682544fef937b04: 784 testes, 775 aprovados e 9 falhas, sem mudança das fontes durante a execução. Evidência local: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/full-1794267303974002012/result.json`.

## Correções em validação

- QA passa explicitamente as bases GeoIP existentes e registra seus SHA-256; teste de recuperação respeita o diretório configurado.
- Referências administrativas históricas usam o catálogo integral. Isso não concede elegibilidade ao formulário Servidor(a), que continua restrito pelo vínculo MEC. AMAN, ITA e IME cobrem essa separação.
- Índice de campi regenerado a partir das oito fontes atuais, preservando os aliases históricos e os dados originais do CSV. Não há pesquisa ao vivo nem publicação automática de campus.
- Histórico de PDFs verifica proteção contra TRUNCATE CASCADE, além de UPDATE e DELETE. A FK nova pode impedir TRUNCATE simples antes do gatilho.
- Expectativa do menu atualizada para o Inbox já integrado, mantendo restrições por nível.
- Instruções livres da IA não estão integradas. Seu teste de implementação permanece explicitamente pulado com justificativa; o contrato ativo recusa o parâmetro desconhecido e conserva o limite de 4 KiB. A expansão Unicode/16 KiB continua pendente. Não declarar esta etapa completa nem contar o teste pulado como aprovação.

Nenhuma dessas correções altera fontes, layout ou publica o admin-v2 na VPS.

## Reteste dirigido

Commit 46e32cc: 44 testes, 43 aprovados, zero falhas e um teste explicitamente pendente de integração IA. Fontes estáveis. Evidência: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/regression-1794268383738532689/result.json`. Esse reteste não substitui a rodada cumulativa final.

## Incrementos independentes

Contrato puro de pacote v2 adicionado em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/batch-package-contract.ts`: vincula os dois PDFs distintos, versões, hashes, tamanho e chave idempotente do pacote. Cinco testes offline. Não implementa armazenamento, validação gov.br, UI ou envio; integração ainda pendente. Nenhum anexo é descartado silenciosamente.
