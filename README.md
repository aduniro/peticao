# R9 — protocolo HTTP de código, aprovação e reconciliação de pacote v2

Rascunho privado em `/mnt/dev/.peticao-r0009-local-package-http-qa-20261111`. Preparação somente: não executou aplicação, PostgreSQL, Docker, HTTP, envio, validação criptográfica ou deploy. Não altera o código da plataforma. Exige revisão e nova lease de execução do coordenador.

## Contrato e separação de escopo

Backend fixo `f55595cd348c23ffe559dba2de9150259db9f1e7`; runtime manifesto `7b853db39899691fef6426d0e2dc1b893a48f14c201fc38eedb6f3df9ade2dc3`. Contratos exatos desse commit foram copiados como texto para `/mnt/dev/.peticao-r0009-local-package-http-qa-20261111/contracts/`, com hashes em `/mnt/dev/.peticao-r0009-local-package-http-qa-20261111/PROVENANCE.json`. Não são importados/executados.

O seed SQL é uma precondição sintética de protocolo, como os testes existentes de pacote: PDFs gerados sem assinatura e registros rotulados na base fictícia como `icp-brasil` e evidência base `gov-br-advanced` sintética. **Isso não valida certificado, assinatura, gov.br, CPF ou validador**. Nenhuma função `assertSendable` ou gate do runtime é alterada. Não invoca o fluxo unsigned bloqueado, upload, assinatura, IA, contatos ou qualquer provedor externo. O endpoint configurado para identificar a política fictícia é `http://127.0.0.1:1/validate`; o guard bloqueia fetch/TCP nessa porta. Nenhuma requisição de validação é prevista.

A fixture reconstrói hashes semânticos/canônicos, bindings, seleção e descriptor de dois PDFs por SQL próprio. `seed_contract.cjs` calcula TEXT_VERSION do conteúdo exato pinado com remoções explícitas de tipos em VM sem `require`, `process`, `fetch` ou imports. Esse passo futuro executa apenas conteúdo puro; a preparação só testou uma entrada dummy. Falha de parsing/binding deve encerrar e preservar a tentativa, sem afrouxar o contrato.

## Recursos e reuso

Node20.19.2 pin `b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac`, imagem local PostgreSQL17.11 `sha256:665dc7b37ac52a17e298511414c21d23ffa4e6a6ef6225b3e5d59c7afb35e994`, sem pull. DB somente `127.0.0.1:55489`; app somente `127.0.0.1:31389`. Nova bridge/container R9 exclusivos por nonce, sem volumes/credenciais reais. Sem modificação de firewall/Docker global. Não há isolamento de egress no sistema operacional: o guard protege APIs Node cooperativamente e o cliente Python tem método/path/host fixos.

Runtime reutilizado diretamente: `/mnt/dev/.peticao-r0006-local-history-browser-qa-20261111/runs/af07e86c4964/runtime`. Origem R2 também conferida: `/mnt/dev/.peticao-r0002-production-profile-20261111/export/runtime`. Ambos exigem inventário integral contra manifesto antes/depois. **Não é mount somente leitura**. Nunca modificar/limpar o R6; qualquer divergência encerra e preserva evidências, sem rollback cego. Não há cópia nova de 475MB. Reserva continua 2GiB disponíveis +64MiB de recibos. HOME/TMP/spool/secrets são exclusivamente privados no run do R9.

Unidade fixa `peticao-r0009-local-package-http-qa-20261111.service`: CPU2/Mem3GiB/Tasks256, RuntimeMax720s, orçamento lógico600s, grace120s, RemainAfterExit=yes. Não iniciar antes de conferir portas, ausência de outra execução e nova lease.

## Casos planejados

- Login HTTP real de owner/reader fictícios; cookie Secure/HttpOnly/SameSiteStrict preservado. Step-up semeado após login; não comprova desafio de login por e-mail.
- Código sem sessão, sem step-up, por reader, campos ausentes/duplicados/desconhecidos: recusas sem spool/journal novo.
- POST codigo com requestId/binding v2; verificar mensagem de sucesso em303, um arquivo dev/journal. Código lido somente de spool próprio0600, nunca dos logs.
- Código errado uma vez: contador incrementa, sem aprovação/envio. Mesma intenção preserva validade/hash/tentativas e não transporta outro código.
- Dois POSTs concorrentes deliberados de aprovação: uma aprovação/transporte v2; replay não transporta. Falha/perda de resposta **não** dispara novo POST automático.
- Dois PDFs exatos: metadados do spool não bastam. A fixture decifra somente o archive fictício com pepper fictício e compara os dois buffers aos PDFs seed. Exporta apenas hashes/booleans.
- Segundo lote separado: trigger SQL fictício causa falha em `batch_recipient_result` após aceite dev. Journal accepted sobrevive, batch_sends ausente; remover trigger, GET conciliar e POST proof exato, replay updated0, sem arquivo/attempt de transporte novo.

Pendentes explícitos nesta primeira rodada: expiração e cinco códigos errados no runtime; transporte indeterminate; alterações de gates/config entre aprovação e reconciliação; browser da aprovação; certificado/ICP/validador real; entrega do OTP e e-mail real; destino São Paulo. Os testes R8 existentes são evidência separada, não substituem HTTP.

## Privacidade e recibo de sucesso

Spool/cookies/OTP/proof, server.log e logs de fixture ficam privados0600 fora Git/export/e-mail. Resultados técnicos não contêm corposHTTP, cookies ou OTP. `private-markers.json` privado adiciona bloqueio explícito contra exportar marcadores. A allowlist de exportação exclui logs de servidor/fixture/spool e credenciais. Nenhum relatório deve reproduzir o OTP.

Sucesso futuro exige outer-result exit0, unidade retida Resultsuccess/ExecMainStatus0 da invocação exata, protocolos completos, dois envelopes com bytes exatos, source/runtime estáveis, guard instalado sem denial, Node/cgroup drenados, Docker próprio ausente e ambas portas fechadas. Um result interno isolado não comprova sucesso. MAILdev accepted comprova spool e journal, não entrega/abertura.
