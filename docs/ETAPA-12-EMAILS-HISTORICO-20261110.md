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

Root migrou SSR/GET para wrappers com ator e montou PreviaEmail com actorScope/asOf/total. Tipos e testes PostgreSQL aprovados; commit consistente, novo build e Next compilado real também aprovados (evidências abaixo). Não aceitar a coorte apenas por arquivos existentes ou por fixture fake.

Sem deploy, merge, sincronização ou alteração VPS. Objetivo admin-v2 integral continua ativo.


## Evidências dirigidas anteriores ao build

- Tipos globais: exit0, fontes/HEAD/runtime estáveis. `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/types-1794329323448417179/result.json`.
- Bateria de28 testes:27 aprovados e1 falha numa asserção antiga que exigia literalmente `no-store`, enquanto a rota passou a emitir `private, no-store, max-age=0`. Os6 testes PostgreSQL novos passaram, incluindo expiração real sob lock, snapshot concorrente, paginação205/µ6 e BIGINT. `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/history-metadata-1794329323461665126/result.json`.
- Correção somente na expectativa do teste: agora exige as três diretivas, no-referrer e nosniff. Reexecução dirigida:1 aprovado/27 não selecionados; não constitui uma segunda bateria integral de28. `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/history-metadata-1794329424106330166/result.json`.
- Driver QA portado de manifests verificados; sintaxe Python/MJS e teste puro de guarda1/1 aprovados pelo revisor. `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/mail-history-compiled-review-next-draft/PORTADO.json`.
- O novo build e o cenário Next com banco fictício foram concluídos para o aceite integrado local. Portas exclusivas54391/3079/3080; nenhum envio real.


## Aceite integrado local — 10/11/2026

- Aplicação congelada em `4eb9349079fb7e89dd3faee58e78300d7308ada4`; novo build Next14.2.35 aprovado, Node20.19.2 e PostgreSQL QA18.4. Fontes completas, HEAD e202 assets de runtime estáveis. `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/build-1794331953155769278/result.json`.
- Primeiro cenário Next real com PostgreSQL fictício aprovado, commit/build iguais. `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/mail-history-compiled-1794332261638937481/execution.json`.
- Extensão somente QA `b2dce473e382f84d6e3ba97b6d1a817d2ae1c40d`: hard_bounce, soft_bounce e blocked nos IDs1/2/3 dos205 eventos, acessíveis após a primeira página100. API exige pares ID/tipo exatos e navegador exige os três rótulos após paginação. Aprovado com mapa integral de fontes da aplicação idêntico ao build4eb9349. `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/mail-history-compiled-1794332321510117651/execution.json`.
-26 registros navegáveis sem duplicar log vinculado;251 tentativas e205 eventos completos; µ6 e IDs BIGINT preservados. Legado mostra provedor/remetente/status originais sem inventar entrega.
- Navegador com handlers reais: paginação, repetição manual após perda controlada, resposta tardia de registro anterior, refreshRSC no mesmo documento,401/403, seis larguras320/390/768/992/1280/1920. Sem DTO inventado, POST, iframe ou solicitação de corpo da prévia no fluxo Edição. PNG390 revisado visualmente; verificação de limites em todas as larguras, sem alegar comparação visual automatizada com baseline.
- Projeção sem corpo/cipher/requestkey, auditoria íntegra, filas e tabelas de fixture inalteradas, zero tentativas DNS/provedor/mutação. Portas54391/3079/3080 fechadas em ambas execuções. Fixture de assinaturas vazia: comparação bootstrap0 não comprova preservação de assinantes reais.
- Este aceite conclui a coorte Histórico de metadados no candidato local. Não conclui todo o módulo E-mails, classificação/investigação integral de devoluções, Reenvios ou homologação em produção. Não autoriza deploy nem atesta executor Santiago pronto.
