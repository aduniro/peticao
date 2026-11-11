# Materiais — helper cliente sem interface visual

Checkout: `/mnt/apps/peticao-final/_ops/drafts/materials-client-20261111`.
Branch: `feat/materials-client-state-20261111`. Base: `10dc8d27aa033b0e7232651cd709603a6cfd39b5`.

## Entrega

`/mnt/apps/peticao-final/_ops/drafts/materials-client-20261111/site/src/lib/materials-client.ts` contém parsers e um controlador específico para os dados estruturados de Materiais. Importa somente tipos do contrato Node. O código emitido não contém imports de runtime, `node:crypto`, `Buffer`, acesso ao banco ou APIs de storage persistente.

Os parsers verificam campos exatos, objetos e arrays sem getters, catálogos fechados, limites UTF-8, UUIDs, revisão, autoria, formato de hash/data, ordem/cursor da biblioteca e histórico, vínculo entre head e versão, além do resultado do pedido. Os catálogos expostos ao consumidor são congelados. Os hashes são validados pelo servidor; este helper verifica o formato e o vínculo de contexto, sem alegar nova verificação criptográfica no navegador.

## API e fluxo

- Criar `MaterialsClient` com `{actorId, actorScope, materialId}` conhecido pelo SSR e, nos testes, transporte injetado. `actorScope` representa a sessão/contexto público, nunca uma credencial.
- `seedHead` recebe a versão atual conhecida. `setDraft` conserva o conteúdo local. `getState` devolve uma cópia sem expor referências internas.
- `loadLibrary` lê uma página de até 50 heads, com filtro ativo/arquivado e cursor UUID. `loadHistory` lê a página de versões e o head atual com cursor ordinal. Cada chamada retorna uma página; não há agregação infinita implícita.
- `save` aceita um intent estruturado de criação, revisão ou arquivamento. UUID vem do chamador; o helper não o inventa. Revisão e arquivamento exigem o material/head/revisão conhecidos. O corpo enviado não inclui ator, autoria ou campos extras.
- Um pedido em envio impede duplo submit. Depois de erro de transporte, timeout, resposta inválida ou indisponibilidade, o mesmo intent permanece pendente em memória. Não há retry automático de POST.
- `recoverPending` faz somente GET para o requestId pendente. Uma resposta 404 de recuperação não prova que a transação anterior nunca poderá concluir; por isso, não libera silenciosamente outro pedido.
- Conflito mantém o texto local. Exige uma leitura nova de head/histórico e `reviewHead` explícito antes de permitir outro intent. UUID já usado não é reenviado pelo mesmo contexto.
- `receipt` e `head` são campos diferentes. Confirmação, replay ou GET de recuperação não substituem o head por uma versão antiga. O head só avança por `seedHead`/leitura de histórico validada, e uma versão inferior ou divergente na mesma revisão é recusada.
- A troca de ator, sessão ou material cancela leituras em andamento e invalida respostas tardias por geração. Repetir o mesmo contexto não descarta um pedido válido. `dispose` cancela o consumidor; se havia mutação, conserva a descrição do pedido como incerta, sem permitir novas operações nesse objeto.

As falhas anteriores a qualquer envio são retornadas pelo método sem iniciar pedido ou substituir dados já carregados. O consumidor deve tratar o resultado retornado e a snapshot de estado; não há componentes, assinaturas de eventos de UI ou mensagens visuais embutidas.

## Transporte limitado

Todos os endpoints são caminhos relativos fixos de Materiais. UUIDs e cursores são validados antes de montar a URL. As chamadas usam credenciais de mesma origem, `cache:no-store` e `redirect:error`. O corpo JSON tem limite de 1 MiB, suficiente para as páginas limitadas de conteúdo estruturado. MIME, tamanho declarado, UTF-8, shape e contexto são conferidos.

Há prazo padrão de 15 segundos, com cancelamento tanto de fetch quanto do leitor de corpo. O prazo também encerra a espera quando o transporte simulado ignora o AbortSignal. Os códigos próprios `error` e os erros dos guardas existentes em `erro` são normalizados sem inserir textos novos no aplicativo.

## Limites explícitos

O estado e o conjunto de requestIds vivem apenas na memória da instância. Não há localStorage, sessionStorage, IndexedDB, arquivo ou sincronização entre abas. Recarregar a página não é homologado como retomada de um pedido pendente. O consumidor futuro deverá manter a instância enquanto houver resultado incerto ou receber outro escopo explícito de persistência.

O helper não concede permissões e não substitui a checagem de sessão, nível e CAS do backend. Não integra menu, página, editor, prévia ou exportação. Não altera HTML, layout, fontes, textos visíveis, assinatura, IA, Contatos ou R16. Não agenda solicitações sozinho.

## Validação observada

Arquivo de testes: `/mnt/apps/peticao-final/_ops/drafts/materials-client-20261111/site/src/lib/materials-client.test.ts`.

Passaram 27 testes puros, sem skips, com transporte simulado. Cobrem contrato/UTF-8/getters/cursores, vínculo de recibos, submit único, perda de resposta, GET de recuperação, 404/503 e JSON inválido, timeout de fetch/corpo, rascunho após conflito, head mais recente versus replay/recibo, troca de ator/sessão/material, filtro obsoleto, imutabilidade de snapshots, erros de autorização/rate limit, arquivamento e dispose.

TypeScript 5.9.3 fez typecheck estrito transitivo de helper e testes: zero diagnósticos, 162 entradas. Versões de TypeScript, tipos Node e undici coincidem com o lockfile; hashes das entradas permaneceram estáveis. A transpilação também confirmou que o helper emitido não carrega módulos de servidor nem APIs de storage.

Provas: `/mnt/apps/peticao-final/_ops/drafts/materials-client-20261111/.cache/materials-client-validation/`. O guard dos testes bloqueia fetch real, TCP, DNS, TLS, UDP, listeners e processos filhos; registrou zero tentativas. Nenhum aplicativo HTTP, PG, Chrome, build, merge, integração ou deploy foi executado.

Próximo passo: revisão independente deste commit, adaptação a uma UI de Materiais em escopo separado e validação HTTP/navegador somente com as autorizações correspondentes. Os testes puros não qualificam essa integração futura.
