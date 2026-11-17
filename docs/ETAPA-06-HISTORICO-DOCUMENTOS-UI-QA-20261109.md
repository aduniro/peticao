# Histórico binário na interface de Presidente/Lotes — 09/11/2026

## Escopo entregue

Candidato local isolado: `/mnt/dev/peticao/.cache/admin-integration/candidate-document-history-ui-20261109`, branch `admin-v2-document-history-ui-20261109`, base `0335b1d`. Código aplicativo em `6321b02ecb3d00061fe5e2bfd3e1a9262fca6f5f`. Nenhuma alteração de produção, PDF, banco de produção, provedor, credencial, política de assinatura ou formulário público.

A interface passa a consumir os endpoints de versões existentes, exclusivamente por ação explícita. O botão “Histórico” aparece no portal Presidente e por lote. Abrir lista metadados, sem obter bytes do PDF; “Baixar” pede somente a versão escolhida à rota protegida existente. O servidor conserva exigências de perfil Total e confirmação recente. Não existe POST novo, pré-carregamento de documentos ou aprovação implícita.

A tabela apresenta versão, tipo, classificação registrada da assinatura, hashes do PDF/lista, data da captura, identificadores de autoria e registro quando conhecidos. Versões observadas do legado conservam autoria desconhecida; não se inventa autor nem se confunde data de captura com data da assinatura. Notas internas da versão não são projetadas para esse componente. “Assinado, NÃO validado” continua distinguível de ICP-Brasil; exibição de metadados não homologa criptografia.

Paginação descendente com 50 registros por consulta, botão de versões anteriores, atualização explícita e preservação dos registros já carregados se a próxima página falhar. Fechar/Esc cancela a consulta pendente, limpa somente o estado desse histórico e devolve foco ao botão. A tabela usa rolagem horizontal interna, com o modal, tokens, fontes e textos neutros existentes do admin-v2.

## Arquivos do aplicativo

- `/mnt/dev/peticao/.cache/admin-integration/candidate-document-history-ui-20261109/site/src/components/admin/HistoricoDocumento.tsx`
- `/mnt/dev/peticao/.cache/admin-integration/candidate-document-history-ui-20261109/site/src/lib/document-history-view.ts`
- `/mnt/dev/peticao/.cache/admin-integration/candidate-document-history-ui-20261109/site/src/lib/document-history-view.test.ts`
- `/mnt/dev/peticao/.cache/admin-integration/candidate-document-history-ui-20261109/site/src/app/admin/presidente/page.tsx`
- `/mnt/dev/peticao/.cache/admin-integration/candidate-document-history-ui-20261109/site/src/app/admin/lotes/page.tsx`

## Validação observada

1. Seis testes unitários passaram; tipos dirigidos concluíram sem diagnóstico. Parser rejeita sequência/cursores inválidos, bytes embutidos e autoria legada inventada; append não modifica páginas anteriores; autenticação/step-up/falhas preservam os contratos. Evidência: `/mnt/dev/peticao/.cache/admin-integration/candidate-document-history-ui-20261109/.cache/qa-document-history-ui-20261109/unit/`.
2. Build de produção terminou 0 sobre `6321b02`, Node 20.19.2, um worker, configuração fictícia sem arquivos de ambiente. Manifesto confirmou todos os arquivos rastreados iguais antes/depois. Evidência: `/mnt/dev/peticao/.cache/admin-integration/candidate-document-history-ui-20261109/.cache/qa-document-history-ui-20261109/build/execution.json` e `/mnt/dev/peticao/.cache/admin-integration/candidate-document-history-ui-20261109/.cache/qa-document-history-ui-20261109/build/build.log`.
3. HTTP/Playwright sobre esse mesmo build terminou 0: larguras 320, 390, 768, 992, 1280 e 1920, ambas as páginas, banco novo exclusivamente fictício. Foram criadas 54 versões PDF válidas de teste, incluindo legado sem autor. Consultas sem sessão retornaram 401; perfis não Total e Total sem confirmação recente retornaram 403. Total confirmado listou e baixou versões.
4. Navegar às páginas não consultou o histórico nem baixou bytes. Abertura, paginação 50→54, atualização 54→50, Esc/retorno de foco e fechamento funcionaram. Falha 503 injetada na segunda página em 390px conservou as 50 versões; repetição manual posterior recuperou as quatro restantes. Não houve repetição automática.
5. Seis downloads escolhidos explicitamente tiveram bytes e SHA-256 idênticos à versão solicitada, com nome de arquivo correto. Houve 24 leituras de listagem e seis de download registradas em auditoria. Nenhuma requisição de escrita pelo navegador ou requisição externa; nenhum erro JavaScript. Snapshot integral dos lotes, versões, assinaturas, mensagens e fila permaneceu igual.
6. Nas seis larguras, tabela mediu 1080px e rolou dentro do modal, sem extravasar a largura da página. Inspeção visual local das capturas de 320, 390 e 1280px confirmou título/fechamento/tabela com os tokens existentes. Capturas do Presidente após “Atualizar” preservam a posição de rolagem alcançada pelo teste; capturas de Lotes mostram a abertura no topo. Não se afirma nova estética nem homologação de PDF assinado real.

Resultado e capturas: `/mnt/dev/peticao/.cache/admin-integration/candidate-document-history-ui-20261109/.cache/qa-document-history-ui-20261109/http/passed/`. JSON principal: `/mnt/dev/peticao/.cache/admin-integration/candidate-document-history-ui-20261109/.cache/qa-document-history-ui-20261109/http/passed/history-ui.json`. Checksums: `/mnt/dev/peticao/.cache/admin-integration/candidate-document-history-ui-20261109/.cache/qa-document-history-ui-20261109/manifest.json`.

## Falhas preservadas e diagnóstico

As primeiras execuções falharam no seletor da própria harness ao abrir o modal dentro da tabela externa de Lotes: `tbody tr` também selecionava o cabeçalho interno por haver um `tbody` ancestral fora do modal. HTTP respondia 200, havia 50 versões visíveis e nenhum erro JavaScript. A seleção passou a usar o `tbody` direto da tabela interna e a contagem usa `HTMLTableElement.tBodies[0].rows`. Não se mudou o aplicativo para satisfazer o teste nem se enfraqueceram as verificações de versões, permissões, hashes e preservação.

Evidências originais preservadas em `/mnt/dev/peticao/.cache/admin-integration/candidate-document-history-ui-20261109/.cache/qa-document-history-ui-20261109/http/failure-a5e07ikg/` e `/mnt/dev/peticao/.cache/admin-integration/candidate-document-history-ui-20261109/.cache/qa-document-history-ui-20261109/http/failure-f9dob94z/`. A segunda inclui screenshot, DOM e respostas HTTP. O servidor, navegador e PostgreSQL próprios foram encerrados pelo cleanup; portas 3036 e 54356 verificadas livres.

## Reprodução e limites

Harness guardada: `/mnt/dev/peticao/.cache/admin-integration/candidate-document-history-ui-20261109/tools/admin-qa/document-history-ui-local.py`; contrato: `/mnt/dev/peticao/.cache/admin-integration/candidate-document-history-ui-20261109/tools/admin-qa/document-history-ui.mjs`; lifecycle: `/mnt/dev/peticao/.cache/admin-integration/candidate-document-history-ui-20261109/tools/admin-qa/document-history-ui-local.mjs`.

Executar a partir de `/mnt/dev/peticao/.cache/admin-integration/candidate-document-history-ui-20261109`:

```sh
/usr/bin/python3 /mnt/dev/peticao/.cache/admin-integration/candidate-document-history-ui-20261109/tools/admin-qa/document-history-ui-local.py http
```

A harness exige o candidato e dependências isolados, ausência de arquivos de ambiente, portas locais desocupadas e build já fechado. O executável Node é `/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node`, SHA-256 `b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac`. Nenhuma instalação ou rebuild implícito.

Conclui a ligação do histórico existente à interface. Não conclui homologação real do e-CNPJ/validador, nova assinatura própria do Presidente, nem implementação da petição-base gov.br separada. Essas frentes e suas decisões/gates continuam separadas. Nenhum deploy foi realizado ou autorizado por esta prova.
