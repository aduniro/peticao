# Rascunho isolado — PDF próprio do presidente

Diretório: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-own-store-draft`.
Nenhum arquivo do candidato, banco real, serviço VPS, certificado ou transporte externo foi alterado. Os symlinks de dependências são apenas para leitura/typecheck; **não copiar a árvore inteira** para integrar. Copiar somente os arquivos próprios relacionados abaixo.

## Decisões reversíveis

- Pergunta: substituir o PDF ativo do lote ou criar artefato separado? Decisão: artefato imutável separado, `source='president-own'`. Nenhum `UPDATE batches`, nenhum falso `source=upload/prepared` e nenhuma alteração em `batch_document_versions`.
- Pergunta: como recuperar POST cuja resposta se perdeu? Decisão: intenção persistida por `(requested_by,request_id)` antes da captura/renderização. Repetição retorna metadados pending/completed/failed sem nova geração. GET do nonce é escopado ao ator. Nonce com outro contexto retorna409.
- Pergunta: o que acontece se cair depois da reserva? Decisão: conservar pending e responder consultas sem reexecutar. Não há retomada automática de operação incerta. Uma nova intenção explícita pode recuperar o artefato da mesma prova; a unicidade de receipt/document/evidence impede versões duplicadas.
- Pergunta: renderizar dentro da transação? Decisão: não. Captura do DB e renderização fora da transação final. Antes de persistir: reautenticação Total/stepup e CAS transacional de perfil, conta, emitente, receipt e bytes/revisão do lote, sob os mesmos locks7003 existentes.
- Pergunta: leitura histórica depende do perfil atual? Decisão: histórico permanece consultável por Total/stepup atual, mesmo após troca de perfil/documento. Nova mutação exige contexto vigente. Download verifica SHA dos bytes e digest da evidência.
- Pergunta: a confirmação passa a autorizar disparo ICP? Decisão: não alterar a política de envio. Metadados explícitos `dispatchAllowed=false`, `icpBrasil=false`, `govBr=false`. A ligação A1 é uma próxima implementação explícita; não fica simulada neste rascunho.

## Arquivos próprios para integração

1. `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-own-store-draft/site/src/lib/president-own-document-contract.ts`
2. `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-own-store-draft/site/src/lib/president-own-document-contract.test.ts`
3. `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-own-store-draft/site/src/lib/president-own-document-store.ts`
4. `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-own-store-draft/site/src/lib/president-own-document-schema.sql`
5. `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-own-store-draft/site/src/app/api/admin/presidente/documentos-proprios/route.ts`
6. `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-own-store-draft/site/src/app/api/admin/presidente/documentos-proprios/[id]/route.ts`

Dependências: captura já existente `capturePresidentOwnConfirmation`; renderer do agente principal em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-pdf-next-draft/site/src/lib/president-native-pdf.ts`.

## Esquema e atomicidade

Três tabelas novas: `president_own_document_intents` (nonce), `president_own_document_artifacts` (PDF+prova), `president_own_document_results` (resultado final append-only). Sem migração de dados antigos. Atualização/exclusão/TRUNCATE bloqueados por triggers, inclusive resultados. Criar em transação do bootstrap; o replay não deve apagar registros. Isso eleva o inventário aditivo35→38, se não houver outras alterações concorrentes.

O registro de resultado completed e o artefato são gravados na mesma transação da auditoria. Falha de auditoria faz rollback, conservando intenção pending. Artefato existente da mesma prova só é reutilizado após CAS vigente; os bytes originais desse artefato são verificados, e os novos bytes renderizados são descartados sem sobrescrita.

O helper `revalidateOwnDocumentTx` é dedicado ao CAS final e não abre helpers privados do portal. Ele reproduz deliberadamente as condições da captura existente; na integração, revisar contra a versão vigente do portal ou movê-lo para perto da captura como helper específico para evitar divergência futura. Não remover condições para facilitar testes.

## HTTP

- POST `/api/admin/presidente/documentos-proprios`: JSON limitado1024bytes, somente requestId/batchId/receiptId/expectedDocumentVersion, Total/stepup, guards existentes de mesma origem. Retorna200 metadata,202 pending,400/403/409/503 conforme estado. Não aceita snapshot, PDF, CPF, senha, data de nascimento nem proof do navegador.
- GET mesma rota `?requestId=UUID`: somente um parâmetro único, recuperação de metadados escopada ao ator; não gera PDF.
- GET `/api/admin/presidente/documentos-proprios/UUID`: download autenticado com SHA+sourceSHA em headers e cache privado/no-store. Não existe URL pública de capability.

## Testes efetivamente executados

Dez testes puros de contrato/orquestração: shape fechado e getters, digest de contexto, sequência reserva/captura/render/CAS, replay de três estados sem efeitos, reserva negada, captura negada, render inválido e CAS negado depois da renderização. Incluem corrupção histórica/rehashedcanonical e ligação de colunas. São testes de portas em memória: **não comprovam transações, locks, triggers, rotas HTTP ou consultas PostgreSQL**.

Comando com diretório de execução explícito `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-own-store-draft`:

```sh
/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node --import /home/barre/.cache/peticao-admin-deps-preview-v1/node_modules/tsx/dist/loader.mjs --test /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-own-store-draft/site/src/lib/president-own-document-contract.test.ts
```

## PostgreSQL/HTTP obrigatórios antes de ativar

1. Bootstrap idempotente duas vezes; comparar contagens/bytes de batch original e artefatos. UPDATE/DELETE/TRUNCATE nas três tabelas devem falhar.
2. Dois POSTs simultâneos mesmo ator/nonce: uma captura/renderização e um resultado; segundo pending ou completed. Mesmo nonce/outro documento409. Outro ator não lê requestId alheio.
3. Perder resposta após commit e recuperar GET: mesmos artefato/SHA/nonce, nenhum novo PDF. Reservar e simular encerramento antes de render: GETpending sem execução automática.
4. Embarreirar renderer; alterar perfil/revision, nome/e-mail da conta, desativar emitente, expirar stepup, alterar listHash/bytes/version, aprovar lote ou aplicar assinatura; liberar renderer: nenhum artefato novo, CAS falha. Perfil e conta devem permanecer bloqueados até commit final.
5. Recibo issued/revoked/fora do prazo original, assinatura existente, PDF com ByteRange/Sig, sourceSHA adulterado: negar. Validar receipt consumido depois da expiração de acesso, quando confirmação foi tempestiva.
6. Dois nonces explícitos para mesma prova: um artefato final (unicidade receipt/document/evidence), dois resultados ligados ao mesmo artefato; não reserializar ou sobrescrever bytes históricos.
7. Falha de auditoria ao reservar/finalizar/baixar: rollback e nenhum dado entregue sem auditoria. Falha de DB após render deixa intenção recuperável, sem resultado de sucesso fabricado.
8. Download histórico depois da troca de perfil/documento: Total atual consegue histórico; leitura sem sessão/stepup é negada; bytes/SHA/evidence adulterados negados.
9. Rotas: body excessivo/JSON inválido/query duplicada/CPF ou snapshot extra/cross-origin/preview readonly; headersno-store; resposta perdida nunca dispara retry de POST na interface.
10. Integração visual em seis larguras, gerar e baixar PDF real fictício, renderizar e conferir páginas preservadas; vínculo A1 posterior deve assinar **esses bytes finais**, sem alterar o artefato próprio nem a assinatura depois.

Não contar este rascunho como funcionalidade100% nem somar os10 testes à cumulativa como se fossem disjuntos. Nenhum envio real ou homologação criptográfica ocorreu.

Typecheck isolado final aprovado (exit0) com symlinks de leitura para dependências/dados públicos. Evidência e checksums: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-own-store-draft/draft-verification.json`. A primeira tentativa falhou por ausência dos JSON públicos no espelho; a ligação readonly foi corrigida, sem alterar o candidato.

Revisão cruzada do apoio de interface identificou lacuna de consistência no download/reuse. Corrigida com `ownArtifactConsistent`: JSON canônico fechado, campos/datas/método/estado válidos e ligação explícita às colunas batch/challenge/receipt/document/sourceSHA, além de SHA dos bytes. Reaproveitamento também exige o mesmo canonical da captura. Dez testes finais passaram. Não há hook de renderer exposto em produção; testes DB separados podem observar `PDFDocument.load` por mock isolado com restauração.

## Integração atual e primeira verificação

SchemaTSconst importado pelo bootstrap do candidato; não há dependência SQL sidecar em runtime. Tipos integrados passaram em /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/types-1794299142168426936/result.json. Primeira rehearsal /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/schema-1794299142013958285/result.json falhou exclusivamente no inventário exato: esperava35 tabelas novas e encontrou as38 planejadas, incluindo3president_own. A lista explícita foi atualizada; demais verificações não foram removidas. Nova execução pendente.

## Verificação integrada aprovada

75/75 testes dirigidos, fontes/commit estáveis: /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/president-native-1794299511944721050/result.json. Rehearsal38tabelas aditivas e compatibilidade bootstrapantigo/replay aprovada: /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/schema-1794299800906573000/result.json. SHA atuais conferidos antes do commit. Tipos app haviam passado antes do ajuste da lista de inventário no teste de migração; appTS permaneceu idêntico. Navegador do conjunto novo ainda pendente; não herda aceite da versão anterior.
