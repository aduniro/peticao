# Histórico completo de metadados de e-mail

Coorte posterior ao aceite de Entregas. Escopo: lista e detalhe de mensagens/tentativas legadas, paginação integral das coleções de tentativas/eventos e proteção de respostas antigas no navegador. Não altera conteúdo/HTML/arquivo de mensagens, política de retenção, transporte ou qualquer WIP suspenso de IA/editor/rich text.

## Decisões e funcionamento

- Manter endpoint GET /api/admin/emails/mensagens para lista/detalhe e acrescentar coleções explícitas id+collection+before+limit. Cursores canônicos vinculados à mensagem/coleção e timestamp6µs; IDsbigint de evento em strings sem arredondar.
- Lista tem totais/coverage/asOf e exclui logs já vinculados ao journal; detalhe começa com100tentativas/eventos e continuação explícita, sem afirmar que esse recorte é histórico completo. Legado exibe provedor, remetente e resultado reais. Não cria vínculo ao journal por email/nome.
- Cada leitura RR confere conta/sessão Edição antes e depois, projection explícita sem corpo/payload/cipher/credenciais/hashes. Erros privados/sanitizados com statuscorreto.
- Cliente limitado/timeout/abort/manualretry, actorScope com sessão/nível e capturaSSR; fechar detalhes/preview e invalidar GET antigo em refreshRSC/troca de contexto.401/403limpam conteúdo protegido antes de nova navegação.
- PreviaEmail.open comparada pelo root byte a byte com baseline antes do port: idêntica. Endpoint de preview, HTMLDTO, sandbox/no-referrer/NOTICE, Total+stepup e retenção preservados. Nenhum dado HTML novo por este fluxo.
- CSS/fontes/classes preservados; textos funcionais novos têm MUDAR AQUI e podem ser revisados pelo responsável.

## Proveniência

Backend4fontes: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/mail-history-complete-next-draft/manifest.json`; contratoSHAe9c8c9ea72bb5cd15320272df9315ab41ae4bc6d6b82755c6927a227223d621a. UI4fontes: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/mail-history-ui-next-draft/entrega.json`. Fontes portadas porSHA, UIoriginalopen preservada. Autoria passou2purobackend e8purocliente/tipos/fixtureHTTPfictício251tentativas205eventos/seis larguras;6 testes PostgreSQL executados e aprovados no port (ver evidências abaixo).

## Integração e validação restante

Root migrou SSR/GET para wrappers com ator e montou PreviaEmail com actorScope/asOf/total. Tipos e testes PostgreSQL aprovados; próxima etapa: commit consistente, novo build e Next compilado real. Não aceitar a coorte apenas por arquivos existentes ou por fixture fake.

Sem deploy, merge, sincronização ou alteração VPS. Objetivo admin-v2 integral continua ativo.


## Evidências dirigidas anteriores ao build

- Tipos globais: exit0, fontes/HEAD/runtime estáveis. `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/types-1794329323448417179/result.json`.
- Bateria de28 testes:27 aprovados e1 falha numa asserção antiga que exigia literalmente `no-store`, enquanto a rota passou a emitir `private, no-store, max-age=0`. Os6 testes PostgreSQL novos passaram, incluindo expiração real sob lock, snapshot concorrente, paginação205/µ6 e BIGINT. `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/history-metadata-1794329323461665126/result.json`.
- Correção somente na expectativa do teste: agora exige as três diretivas, no-referrer e nosniff. Reexecução dirigida:1 aprovado/27 não selecionados; não constitui uma segunda bateria integral de28. `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/history-metadata-1794329424106330166/result.json`.
- Driver QA portado de manifests verificados; sintaxe Python/MJS e teste puro de guarda1/1 aprovados pelo revisor. `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/mail-history-compiled-review-next-draft/PORTADO.json`.
- O novo build e o cenário Next com banco fictício ainda são necessários para aceite integrado. Portas exclusivas54391/3079/3080; nenhum envio real.
