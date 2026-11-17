Estado atual: integração local ao candidato em10/11/2026; QA do conjunto completo ainda pendente. O roteiro abaixo preserva decisões e evidências do draft de origem. Nenhum deploy/VPS.

# Ligação explícita PDF próprio → A1 — rascunho isolado

Pasta: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-own-a1-draft`.
Nenhuma alteração no candidato, migração aplicada, job real, certificado, envio ou VPS.

## Decisões e fatos encontrados

1. O job A1 já contém FK `input_artifact_version_id → batch_document_versions(id)`. O worker recebe o UUID da versão, SHA e os bytes carregados pelo claim. Não é necessário inserir outra coluna no job para mudar a entrada: criar proveniência explícita para o PDF próprio no histórico e manter uma ponte imutável.
2. Decisão do agente principal: usar `variant='signed'`, `signature_kind='own-confirmation'`, `source='president-own'`. A confirmação própria é distinguida de ICP pelo kind/source. O original `variant=original/source=prepared` permanece intacto. Não usar `source=upload` ou `prepared` para encobrir o derivado. Não criar terceira variante para evitar alterações desnecessárias em filtros/DTOs.
3. `expectedOwnArtifactId` é opcional. Ausente: comportamento A1 original atual, inclusive fingerprint legado. Presente: selecionar **somente esse UUID**, validar seu recibo/prova/contexto e congelar os bytes exatos antes do job. Falha não pode voltar silenciosamente ao original ou escolher o mais novo.
4. Há duas revisões distintas: `batches.documentVersion` inclui contagens, hashes e assinatura atual; `presidentDocumentRevision` tem outra composição. O campo `expectedDocumentVersion` da admissão continua sendo o primeiro. A coluna `ownartifact.document_version` deve ser comparada à revisão **presidente** atual, separadamente. Nunca igualar os dois algoritmos.
5. O modo combinado exige lote ainda sem `signed_pdf` e kind none/null, além do CAS do recibo/perfil. O renderer já acrescentou a confirmação; A1 assina esses bytes finais. Nunca acrescentar página ou reserializar depois da assinatura A1/gov.br.
6. Nenhuma guarda de política, credencial ativa, e-CNPJ esperado15883671000115, truststore, titular, validador independente, lease ou autorização é removida. O contrato puro só verifica seleção/integridade e retorna `signingAuthorized=false`; não substitui admissão transacional.

## Arquivos próprios

- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-own-a1-draft/site/src/lib/president-own-a1-contract.ts`
- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-own-a1-draft/site/src/lib/president-own-a1-contract.test.ts`
- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-own-a1-draft/site/src/lib/president-own-a1-schema.ts`
- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-own-a1-draft/site/src/lib/president-own-a1-schema.sql` (referência humana; runtime deve importar a constanteTS)

Os demais links são dependências readonly para tipos/testes. Não copiar a árvore inteira.

## Migração mínima proposta, não executada

- Expandir o conjunto source do histórico para incluir `president-own`, tanto no SQL quanto no tipo e whitelist de `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/batch-document-history.ts`.
- **Preservar o nome `batch_document_versions_source_check_v2`** ao expandir o CHECK. O bootstrap antigo só pula sua criação quando esse nome existe. Renomear para v3 sem manter v2 faria o bootstrap antigo recolocar a restrição antiga no replay. O SQL do draft substitui v2 pelo conjunto ampliado e usa inspeção do CHECK para ser idempotente.
- Criar somente a ponte `president_own_a1_inputs`: ownartifactPK, inputversionUNIQUE/FK, originalversionFK, createdBy e data. Triggers: imutabilidade completa e consistência no INSERT (batch, fonte/kind/variant, bytes/SHA/listHash e originalprepared). Nenhum UPDATE em `batches` durante o congelamento.
- Isso adiciona uma tabela além das três da persistência própria. Nenhum registro legado é reclassificado e nenhum job existente é reescrito. Worker/validador mantêm o contrato atual de binding.

## Admissão — alteração pequena no fluxo existente

Dentro da mesma transação de `admitA1Job`:

1. Validar shape conhecido incluindo o seletor opcional, sem PFX/caminho/chave/bytes do navegador. Reautenticar Total/stepup e verificar política existente.
2. Fingerprint original exato se não houver seletor; modo combinado usa domínio `batch-a1-own:v1` e inclui ownUUID. Replay mesmo ator+nonce precisa conferir esse fingerprint **antes de inserir novo histórico**.
3. Carregar/prevalidar o lote com o `currentDocument` existente: preparação A1versão2, rodapé correto, audit de criação, originalprepared e bytes/SHA ainda exigidos.
4. No modo combinado, carregar ownartifact por UUID e consultar o CAS específico do portal dentro desta transação. Revalidar receiptconsumed e data tempestiva, emitente ativoTotal, perfil/revisão/fingerprint e conta responsável, sourceoriginal/revisão presidente. Usar `ownArtifactConsistent` e `selectOwnAwareA1Input`.
5. Resolver ponte existente do ownUUID; se houver, comparar entrada congelada com `frozenOwnA1InputMatches`. Se não houver, `appendDocumentVersion` com variant signed, sourcepresident-own, kindown-confirmation, bytes do artefato, SHA exato, authorId=responsável do recibo, recordedBy=ator; inserir ponte com originalpreparedversionID. Tudo junto à auditoria e ao job; uma falha faz rollback.
6. Recusar job ativo conforme guarda existente. Inserir job apontando para a versão congelada própria; `document_version` continua versão A1/base do lote. Não alterar pdf/signed_pdf/status para promover a confirmação própria a ICP.

### Ordem de locks

Os stores do presidente usam advisory7003 antes de ator/perfil/lote; A1 hoje trava ator/política e depois lote. Ao adicionar CAS de perfil depois do lock de lote, revisar inversão com configuração do presidente. Opção simples: obter7003 no início das transações A1 que podem operar sobre entrada própria, **antes** de autorizar/travar perfil/lote. Claim/finish precisam seguir a mesma ordem. Nunca manter a transação/lock durante worker ou validador externo.

## Claim e finish

- Continuar revalidando ator/sessão, prazo de autorização, política/credentialfingerprint e preparação/base do lote.
- Se o job aponta para originalprepared, manter as comparações atuais.
- Se aponta para sourcepresident-own, exigir a ponte exata e carregar seu artefato original; refazer CAS vigente e integridade. Comparar UUID/SHA/tamanho/bytes congelados com job. Entregar ao worker **bytes da versão congelada**, sem renderizar novamente e sem buscar latestsigned.
- `documentVersion` do binding continua versão A1/base, enquanto `inputSha256` cobre o PDF próprio final. O binding já diferencia esses conceitos.
- Em finish não terminal, repetir todas as conferências e exigir validação independente existente, inclusive titular/política/hash do output. Só então append sourcea1-worker e atualizar signed_pdf, como hoje. Nenhuma alteração após assinatura.
- **Replay de job já succeeded é histórico:** não exigir que a revisão atual ainda seja a revisão sem assinatura do recibo; o próprio sucesso A1 alterou a revisão do lote. Manter guards atuais de replay (ator/política/prazo, leaseconcluído, outputexato e concordância com signed_pdf) e verificar a ponte histórica, sem tentar assinar de novo.
- Cancelamento/stale/erro não pode converter automaticamente a entrada própria em original. Resultado incerto conserva a política atual de conciliação.

## UI e HTTP

Alterar whitelist fechada em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/app/api/admin/lotes/[id]/a1/route.ts`, tipos em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/a1-job-view.ts` e transporte em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/a1-request.ts`. A escolha é explícita do operador; ausência do campo não ativa o modo combinado.

A resposta/GET de recuperação precisa projetar `ownArtifactId` por join da ponte da versão de entrada e conferi-lo contra o intent. O GET nunca escolhe/cria uma nova entrada. Nenhuma credencial/token é armazenada no navegador. Disponibilidade original não se torna comprovação da prontidão do próprio: o seletor precisa exibir o artefato exato revisado.

## Leituras automáticas de histórico examinadas

`batch-package-store.ts` usa latestsigned, mas exige kindICP, concordância com `batches.signed_pdf` e bytes/SHA/listHash. A entrada própria, congelada antes do outputA1, não satisfaz essas guardas. O A1finish apenda sua saída depois, com ordinal superior. `document-verification.ts` também exige bytes atuais, aprovação e versão sem sucessora. Não remover essas conferências para acomodar a entrada própria; ensaiar que um job pendente não torna a confirmação própria publicável/enviável.

## Testes efetivamente feitos e próximos

Sete testes puros: shape e seletor explícito; default/fingerprint legado; bytes finais e duas revisões distintas; falta/UUID errado sem fallback; alterações de fonte/prova/contexto; lote assinado recusado no combinado; ponte com bytes/source/kind/original exatos. **Não são testes PostgreSQL, HTTP, worker ou homologaçãoA1.**

Obrigatórios na integração:

- Migração/replay bootstrap novo e antigo; sourceown conservado, ponte imutável, INSERT crossbatch/bytes/SHA errado recusado.
- Dois admits concorrentes mesmo nonce e ownUUID: um histórico próprio/ponte/job/audit; nonce usado com outro ownUUID ou sem modo409.
- Worker fake recebe SHA/bytes do PDF próprio (com página) e inputversionFK correto; default continua recebendo originalprepared.
- Revogar perfil/recibo/conta/emitente/ator/política ou mudar PDF/listHash entre admit→claim e claim→finish: stale, nenhum novo signed_pdf.
- Resposta perdida e GET recuperam o mesmo job/ownUUID; replay succeeded não reprova apenas porque A1 mudou signed_pdf.
- Falha de auditoria rollback sem ponte órfã, job órfão ou signed_pdf promovido; upload/prepared falsificado não passa ponte.
- ownhistorypendente não atende package/publication; outputA1 exato entra pacote com original e ownhistory intactos.
- Inspeção visual do combinado fictício e revisão criptográfica independente. Certificado real segue pendente; nada aqui o substitui.

Typecheck isolado final aprovado(exit0), com typeRoots Node explícito. Primeira tentativa encontrou somente @types/node ausente na resolução do espelho; corrigida configuração local. Evidências/checksums: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-own-a1-draft/draft-verification.json`. Sete testes repetidos após ajuste final passaram.

## Implementação real acrescentada ao rascunho

O rascunho agora contém a alteração concreta de `batch-a1-jobs.ts`, histórico, rota HTTP, transporte, reducer e reconciliação. O helper novo `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-own-a1-draft/site/src/lib/president-own-a1-input-store.ts` executa captura de proveniência/freeze e CAS sem abrir transações aninhadas. A ordem7003 foi adicionada às transações A1 antes de ator/política/lote. Metadata resolve ownUUID pela versão histórica do job, sem latestsigned.

A interface original do A1 continua sem seletor obrigatório. A interface combinada deve criar intent com `expectedOwnArtifactId` somente quando o UUID exato foi selecionado/revisado. Não enviar uma chave com undefined/null. A resposta de job projeta `ownArtifactId`UUID/null, sem bytes/credenciais. O cliente confere esse UUID no POST e no GET do nonce.

### Disponibilidade explícita própria

- `getA1Availability(batchId,actor,expectedOwnArtifactId?)`: opcional preserva default; modo próprio valida prova/receipt/perfil/documento atuais, sem gerar/congelar histórico ou job. Auditoria somente IDs e disponibilidade.
- GET `/api/admin/lotes/ID/a1?expectedOwnArtifactId=UUID`: alternativa mutuamente exclusiva a `?requestId=UUID`; duplicados/desconhecidos/UUID inválido recusados.
- `readA1Availability(batchId,fetcher,timeoutMs,expectedOwnArtifactId?)` e `readA1Reconciliation(state,fetcher,timeoutMs,expectedOwnArtifactId?)`: quarto argumento opcional. O segundo encaminha o modo do intent ou do controle; mismatch explícito recusa consulta sem fetch.
- Resposta de disponibilidade própria traz `ownArtifactId=UUID` no nível externo. O cliente exige modo correspondente; metadata de outro modo não é aceita como resultado combinado.
- Um job ativo de outro modo continua bloqueando globalmente. Sua metadata é omitida do `latestJob` próprio; não é ligada ao controle errado. Um job antigo falho de outro modo não bloqueia uma nova intenção própria válida. O GET original mantém a projeção global legada.
- Recibo consumido tempestivamente não expira só porque o acesso ao portal expirou; sessão/stepup do ator A1 e política continuam exigidos ao consultar, admitir, reclamar e finalizar.

### Evidência PostgreSQL já observada

Primeira execução:35/36, falha somente no fixture que tentou revogar um desafio conservando receipt/confirmedAt incompatíveis com CHECK. Corrigido o fixture para limpar campos pareados; **nenhum CHECK foi relaxado**.

Execução seguinte: **47/47**, tipos0, fontes privadas/origens/commit estáveis e porta54381 fechada, sobre origem `a9d1ba0`:
`/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-own-a1-db-1794300223142808159/result.json`.

Essa execução comprova transações A1 originais e combinadas, ponte imutável, bytes exatos no claim, CAS, rollback de auditoria, finish/replay por validador fictício, inexistência de envios e guardas negativas de pacote/publicação. Não comprova certificado/validador real, nem fluxo de navegador completo. Posteriormente foram acrescentados o GET de disponibilidade própria e testes específicos; seu resultado precisa ser consultado na evidência posterior, sem atribuí-lo retroativamente aos47.

### Arquivos mínimos para portar ao candidato pelo agente principal

Novos arquivos em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-own-a1-draft/site/src/lib/`:

- `president-own-a1-contract.ts`
- `president-own-a1-contract.test.ts`
- `president-own-a1-input-store.ts`
- `president-own-a1-schema.ts`
- `president-own-a1-jobs.test.ts`
- `president-own-a1-browser.test.ts`

Substituições cirúrgicas da mesma pasta: `batch-a1-jobs.ts`, `batch-document-history.ts`, `a1-job-view.ts`, `a1-request.ts`, `a1-reconciliation.ts`. Rota: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-own-a1-draft/site/src/app/api/admin/lotes/[id]/a1/route.ts`.

Além disso, o agente principal deve importar/interpolar `PRESIDENT_OWN_A1_SCHEMA_SQL` no bootstrap **depois** do histórico/sourceguard e das tabelas próprias; o inventário aditivo passa de38 a39 se nenhuma outra frente adicionar tabelas. Não modificar a FK existente do job nem sua política de credenciais. Não copiar symlinks/dependências ou os testes antigos idênticos.

Os controles visuais combinados e persistência de intent por ator/modo são autoria de outra frente em draft separado; ainda exigem integração e QA compilado após a união. Este rascunho não altera `A1Assinatura.tsx` e não configura certificado/produção.

## Coorte final53 — resultado observado

53/53 aprovados, tipos0, fontes privadas estáveis, porta54381 fechada. Evidência: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-own-a1-db-1794300795274593904/result.json`. HEAD de origem permaneceu a9d1ba0; durante a execução mudaram intencionalmente renderer, portal do presidente e package.json no candidato. Portanto, esses53 são evidência da coorte privada anterior de renderer/contexto, **não aceite do HEAD atual nem da união com o novo canvas**. Os arquivos próprios A1 não mudaram.

Lista exata de12 arquivos, checksums, alvos e hook SQL: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-own-a1-draft/port-manifest.json`. Patch correspondente: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-own-a1-draft/a1-minimal.patch`. Importar/interpolar a constante do esquema após sourceguard/histórico e três tabelas próprias; inventário39 se nenhuma outra frente acrescentar tabelas. Não copiar o espelho inteiro.

SSR original de Lotes/Presidente agora passa actorScope e hash da fonte como namespace de UI, para recuperar o mesmo nonce depois de reload. Isso não substitui documentVersion A1 do servidor. Job own e original permanecem separados por modo/UUID. Rehearsal agora cria dados fictícios de artefato/histórico/ponte/job e reaplica bootstrap novo e antigo para demonstrar preservação, além do inventário de39tabelas.

## Revisão de integração

O parser visual do histórico ainda recusava sourcea1-worker/president-own, embora o backend já os produzisse. DTO/whitelist/labels foram corrigidos, preservando rejeição de fontes desconhecidas e combinações contraditórias;8testes puros passaram. Evidência: /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-own-a1-migration-draft/history-view-fix-result.json. O conjunto integrado ainda será validado.

## Validação do conjunto e ajuste de tipagem

150/150 testes passaram com fontes/commit e202assetsruntime estáveis em /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/president-native-1794302410300587870/result.json. A rehearsal39tabelas+preservação own→A1 passou em /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/schema-1794302159710179845/result.json.

A verificação de tipos desse snapshot encontrouTS2339noSSRdeLotes: o DTOBatchnãoexpõe signed_pdf_sha256. Foi removida somente essa prop opcional; actorScope/hashdafontepermanecem. A UI original mantém o comportamento de refresh existente e não faz cast paraocultar campo ausente. Rerun tipos/preview compilado pendentes. Dois primeiros comandos foram bloqueados no preflight por registroGit ainda em curso; não executaram testes. Ordemcorrigidaantesdos150casos.

Tipagem GLOBAL do conjunto integrado corrigido, já com paginação gov.br, aprovada: /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/types-1794304139586361750/result.json.1142fontes e202runtimeassets estáveis; SHA atuais conferidos antes do commit.8testes puros do histórico também passaram. 150testes de backend e36da paginação são checkpoints anteriores do escopo indicado; não somar como se fossem casos exclusivos nem substituir validação do navegador atual.

## Primeiro navegador integrado com canvas/own/A1

Build3ebd381 aprovado, fontes e202assets estáveis: /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/integrated/build-1794304615020250598/result.json. Execução /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-compiled-1794305032604742897 validou pixels reais do canvas e geração/download doPDFown (own-pdf-browser-result.json), mas falhou ao esperar botãoA1 porseletor global que encontrava primeirodialogfechado. Seletor ajustado para dialog[open] comdiagnóstico sanitizado; repetição pendente, não declararE2Ecompleto. Nenhumachange noapp/bundle por esseajustedeteste.
