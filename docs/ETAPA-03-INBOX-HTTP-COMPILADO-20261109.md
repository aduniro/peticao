# Etapa 03 — HTTP compilado das consultas INBOX

Continuação do backend `079ca7a`, sem código de aplicação alterado nesta unidade. O QA usa fontes commitadas em worktrees limpas, configuração fictícia vazia e PostgreSQL próprio54362. O servidor Next escuta exclusivamente127.0.0.1:3047 e é encerrado em finally, antes da remoção do schema fictício/encerramento do banco. Não há UI, browser público, deploy, relay real, modelo, envio ou leitura de dados reais.

## Artefatos e runtime separados

- Primeira prova: `079ca7a`, cópia limpa `candidate-inbox-http-079ca7a-20261109`. O runtime do caminho primário foi conferido durante a execução como Node **v24.22.1**. A indicação inicial de Node20 foi corrigida no chat/Vigia; essa rodada não é prova Node20. Build e HTTP têm logs próprios.
- Por determinação do principal, a prova Node20 passou a usar a integração mais recente **8cdd97a0484d22cb5e7907e956bdcf42f0f851fe**, em `candidate-inbox-http-node20-8cdd97a-20261109`. A cópia Node20 antiga de079 foi somente criada; nenhum build redundante foi executado nela.
- Node20 já instalado: `/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node`, versão **v20.19.2**, SHA-256 `b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac`. Não houve instalação ou troca de conta/modelo.
- O manifesto somente leitura de Contact em `candidate-cumulative-8cdd97a-20261109/.cache/accepted-cumulative-node20/plan.json` foi comparado integralmente:1231 fontes iguais por hash;102 manifests instalados iguais por versão/hash;50 opcionais ausentes iguais. SHA-256 do manifesto `cf58eb899d2250dce514a15396a40ffae17d2bfdba769183e0ab185d380ca20c`. Ele não foi modificado. As verificações se repetem no runner antes/depois do build/HTTP.

O limite de workers usa a configuração já suportada pelo Next14: `CIRCLE_NODE_TOTAL=2` resulta em um worker. Heap1536, telemetria desligada e ambiente filtrado. Nenhum arquivo de Next/config foi modificado. Build coordenado com Contact e principal para evitar sobreposição pesada.

## Comandos reproduzíveis

Da worktree `candidate-inbox-read-20261109`:

```
python3 tools/admin-qa/inbox-http-local.py build
python3 tools/admin-qa/inbox-http-local.py http
python3 tools/admin-qa/inbox-http-local.py build node20
python3 tools/admin-qa/inbox-http-local.py http node20
```

Os dois primeiros selecionam a cópia079/runtime primário; os dois últimos fixam latest8cdd/Node20/hash. O runner recusa cópia suja, ambiente local presente ou portas já ocupadas. Exige BUILD_ID da própria cópia no modo HTTP e verifica estabilidade das fontes. As dependências/symlink ficam fora do Git. `inbox-http-compiled.mjs` executa somente os GETs em loopback contra o artefato compilado e fixtures locais; não substitui os handlers por mocks.

## Provas HTTP

Cinco grupos de provas, com usuários e mensagens fictícios:

1. Quatro GETs retornam401 sem sessão e403 para Leitura; Edição/Exclusão/Total funcionam. Stepup, papel atual e expiração da sessão são efetivos por requisição.
2. Conta/thread ficam separados; cursores não podem ser transferidos entre contas/conversas. Microssegundos da última captura sobrevivem à paginação, limites e parâmetros repetidos são recusados.
3. Prévia é JSON de documento transformado, sem imagem remota/script/código/anexo bruto. Download explícito retorna bytes exatos com attachment, application/octet-stream, nome fixo.bin, nosniff e no-store. IDs/índices inválidos são recusados.
4. Revogação de papel/sessão fecha a consulta. Ciphertext ainda não expurgado, mas vencido, resulta410 sem conteúdo/anexo. Corpo retorna somente estadoexpired.
5. Os GETs não modificam a linha cifrada da mensagem. Assinaturas, filas, mensagens de saída e respostas continuam vazias; cadeia de auditoria válida. Mutações de expiração/roles feitas pelo fixture são separadas da comparação de preservação.

A primeira execução HTTP24 parou em uma expectativa estrita do roteiro: o Next compõe `Referrer-Policy: strict-origin-when-cross-origin, no-referrer` (global+rota), em vez de uma string única. O teste foi corrigido para verificar o último valor `no-referrer`, preservando a ordem segura; a aplicação não foi alterada. Não se aceita a ordem inversa com política mais fraca no fim. O valor real é guardado no relatório das rodadas atuais. A falha inicial e a rodada posterior foram preservadas separadamente. Não se tratou de recusa de segurança ou erro da autenticação.

## Cobertura e limites

É QA funcional dos GETs INBOX no artefato real; não certifica visual/iframe futuro, respostas ou todo o admin. A rodada Node20latest amplia a prova de integração da unidade, sem repetir a cumulativa inteira: o principal/Contact mantêm suas próprias evidências de unidades/schema. Não ativou dados, credenciais ou qualquer gate real. Fontes públicas/formulários/CPF/textos permanecem os do commit fechado; nenhuma fonte foi trazida da VPS.

Evidências originais/cópias e resultados finais serão registrados abaixo. Arquivos runtime/fixtures e logs privados ficam fora do Git; o commit inclui apenas o roteiro, runner e este relatório, sem cookies de sessão ou conteúdo pessoal.

## Resultado final observado

- Node24/079: build saída0 (`/tmp/admin-inbox-compiled-gbqo7dzv`); HTTP inicial saída1 apenas pela expectativa de header (`/tmp/admin-inbox-compiled-18uo63j0`); HTTP corrigido saída0/cinco grupos PASS (`/tmp/admin-inbox-compiled-6lc9cqt6`). Nenhuma alteração no app.
- Node20/latest8cdd: **build saída0 e HTTP saída0/cinco grupos PASS**, em `/tmp/admin-inbox-compiled-755kfymg` e `/tmp/admin-inbox-compiled-j2o0d80p`. O relatório confirma Nodev20.19.2 e o SHA pinado. As1231 fontes permaneceram iguais ao manifesto após ambos os comandos.
- Referrer-Policy real da rodada latest: `strict-origin-when-cross-origin, no-referrer`; o último valor obrigatório é no-referrer. Nenhuma ordem que termina em política mais fraca foi aceita.
- O build contém aviso existente de Autoprefixer em `admin/v2.css:206` sobre `end`/`flex-end` e aviso de serialização de cache associado. São avisos, não falhas; nenhuma mudança visual/CSS foi feita para removê-los.
- Cópias privadas dos logs/manifest checks em `.cache/qa-inbox-compiled-20261109/`, separadas por runtime/base/fase. Ambas as worktrees de aplicação continuaram limpas. Portas3047/54362 verificadas livres após finally, e janela pesada liberada a Contact.

O commit desta unidade contém somente três arquivos de QA/documentação. Ele não altera a aplicação, os headers de produção, os modelos de dados ou a fonte recebida. O resultado HTTP é evidência do snapshot8cdd, não de commits futuros nem de todo o escopo admin-v2.
