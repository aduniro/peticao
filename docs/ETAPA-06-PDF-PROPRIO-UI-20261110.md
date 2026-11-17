# PDF da confirmação própria — interface integrada localmente em10/11/2026

Escopo desta alteração: três arquivos novos de interface/transporte/teste e um slot
no controle administrativo existente. Sem alterações deAPI/store/esquema, certificado,
portal externo, CSS, formulário público, VPS, deploy, merge ou envio. Backend e
persistência pertencem a outra frente coordenada no mesmo módulo.

## Arquivos

- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/components/admin/PresidenteDocumentoProprio.tsx`
- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/president-own-document-client.ts`
- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/lib/president-own-document-client.test.ts`
- `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109/site/src/components/admin/PresidenteAcesso.tsx`

O slot aparece apenas com documento nativo elegível ainda não assinado, perfil sem
resultado incerto e GET administrativo que devolva recibo consumido/current. UUID e
versão vêm do resultado autenticado, nunca de campo livre ou parâmetro deURL.
Um recibo durável pode continuar atual depois de expirarem as credenciais temporárias;
o slot não exige credentialsExpired=false. O backend revalida todas as condições.

## Decisões reversíveis registradas

1. POST somente explícito comUUID. EfeitosReact não consultam nem mutamAPI. Aguardar
   hidratação do contexto salvo antes de habilitar a primeira solicitação evita
   gerar intenção nova antes de reconhecer a anterior.
2. Persistir sórequestId/batchId/receiptId/expectedDocumentVersion emsessionStorage,
   comchave porator/sessão/lote/recibo/versão. Nenhum PDF, CPF, e-mail ou credencial.
3. Resposta perdida mantém UUID. GET explícito recupera metadados;404 permite uma
   repetição explícita da MESMA intenção, sem retry automático.
4. Pending/failed só liberam novoUUID apósGET válido e checkbox explícita; novo clique
   mantém lote/recibo/versão e não cancela nem sobrescreve o pedido anterior. A
   deduplicação do artefato e autorização final são responsabilidades do backend.
5. HTTP202 significa pendente, não PDF pronto. Download exige completed e metadata
   compatível comtodos osbindings, artifactUUID/hashes válidos e flags literais
   president-own/dispatchAllowed=false/icpBrasil=false/govBr=false.
6. Download porlink nativo autenticado comartifactId, semquerystring ou bytes naURL,
   somente quando solicitado. Nenhum disparo, aprovação ou seloICP/gov.br inferido.
7. Textos emCOPY comcomentário MUDAR AQUI. Reutilizadas classes doadmin; nenhuma
   mudança de fonte, tamanho ou CSS/global/formulário público. Textos são decisões
   reversíveis autorizadas peloGoal e ficam disponíveis para revisão posterior.

## Evidência e limites

Rascunho anterior:
`/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-admin-next-draft/DOCUMENTO-PROPRIO-INTEGRACAO-E-DECISOES.md`.

Tipos isolados aprovados,10/10 testes de metadados/transporte e12 cenários de
navegador isolado comAPI fictícia aprovados. Fontes transportadas coincidem com
manifesto privado. Seis larguras320..1920 semoverflow; capturas320/1280 no temaescuro
revisadas. Cenários incluem perda de resposta/reload/GET semnovoPOST, pending/failed
comnovoUUID explícito,404 repetindo mesmoUUID, metadados de outrorecibo recusados,
contexto novo desmontando link e download somente porartifactId.

Evidência:
`/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/president-admin-next-draft/own-pdf-qa-result.json`.

Essa prova isolada não é aceite doNext/PG/PDF real. Após consolidar o backend,
executar tipos/build e integração compilada no mesmo snapshot, com download exato,
autorização atual, perda de resposta, deduplicação, revalidação e preservação dos
bytes originais/assinados. Não somar esses10casos ao total cumulativo sem conferir
sobreposição e revisão de fontes.

## Repetição após portar os arquivos

Executado somente o arquivo puro de testes de cliente no candidato, comNode20.19.2
fixado e loadertsx das dependênciaspreview-v1:10 testes,10 aprovados,0 falhas e0
ignorados; código de saída0. Não iniciaPostgreSQL, aplicativo, provedor ou e-mails.
Nenhum commit ou QAfull foi executado por esta frente. Tipos/build unificados
continuam sob coordenação do agente principal depois de integrar o backend.
