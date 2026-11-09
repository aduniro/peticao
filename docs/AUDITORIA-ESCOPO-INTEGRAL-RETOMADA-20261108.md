# Admin-v2 integral — auditoria de escopo na retomada

Inspeção estática em08/11/2026, candidato
`/mnt/dev/peticao/.cache/admin-integration/candidate-stage02-domains`.
Referência inicial observada: `23f80493ce52fcb0de7ae292c2d75b6bfec074c5`;
há alterações simultâneas autorizadas em desenvolvimento. Este documento registra
o estado inspecionado, não congela a árvore nem certifica alterações posteriores.

**Conclusão:** existe uma base administrativa extensa, com controles de backend
e provas específicas preservadas. Ainda não é demonstrável a conclusão do painel
integral. Testes verdes de lotes, senhas ou migração não provam a existência de
assistente, divulgação, caixa de entrada, editor rico ou portal do presidente.

Não executei testes, build, migração ou consultas à VPS; não li credenciais,
bancos, exportações de assinantes ou decisões de CPF/nome. A auditoria consultou
somente planos, fontes, testes como texto e documentação técnica. Evidências de
execução citadas nos documentos anteriores continuam pertencendo aos respectivos
commits; não foram revalidadas por esta inspeção.

## Origem e limites do escopo

- Plano integral vigente: `/mnt/dev/peticao/docs/PLANO-INTEGRACAO-ADMIN-VPS.md`,
  oito etapas, inclusive módulos incompletos do histórico, revisão visual e
  entrega identificável, sem autorização de publicação.
- Pedido original preservado em
  `/mnt/dev/peticao/LOG-2026-11-04-planejamento-admin-v2.md`, seções1–2:
  usuários/níveis, contato individual/em conjunto, base de comunicação,
  divulgação editável, assistente do painel, conhecimento comum e presidente.
- A expansão posterior e os critérios das Etapas0–7 estão em
  `AUDITORIA-CONTINUIDADE-ADMIN-V2-20261106.md`, seções2,5,7 e8. O conjunto
  visual anterior à expansão não é o escopo completo.
- A estética posterior prevalece: verde escuro/vidro em todo o painel, Menu à
  esquerda e Filtros à direita no mobile, mapa isolado da navegação, componentes
  e tokens existentes. Não copiar a estética vermelha da referência antiga.
- O plano prevê serviços externos desativados quando faltarem credenciais.
  Isso permite concluir adaptadores e estados locais verificáveis; não permite
  chamar uma tela ausente de funcionalidade pronta nem afirmar homologação real.

## Matriz requisito → fonte atual → prova ainda necessária

| Requisito integral | Evidência de fonte observada | Estado e critério verificável |
|---|---|---|
| Base isolada compatível com produção e preservação dos fluxos públicos | Candidato separado; fixtures de esquema06/11 e diagnósticos07/11; `deploy/test/admin-schema-upgrade.mjs` | Há ensaios históricos. A entrega deve comparar o candidato final e seus contratos com a referência autorizada, identificar diferenças administrativas e preservar CPF/cache/confirmação/hash/datas. Não incorporar outro checkout integralmente. |
| Visual uniforme, navegação, mapas, tabelas e filtros | `app/admin/v2.css`, `components/admin/shell/`, `painel/` e primitivas `ui/` | Implementação existe. Revalidar todas as telas afetadas nas seis larguras do plano, inclusive overlays, teclado, foco e níveis. Não usar screenshot de outro commit como comparação final. |
| Login, convite, recuperação, quatro níveis e revogação | `admin-users.ts`, rotas de conta/usuários, páginas de conta/redefinição | Senha mínima8 está em trabalho por agente dedicado. Verificar criação/troca/redefinição, revogação, último Total, convite, resultados reais de envio e visibilidade por nível. AV4 já aprovado não equivale a handler/interface atualizados. |
| Central com descrição correta e resultado incerto legível | Backend `acoes/history.ts`, `acoes/journal.ts`; `Acoes.tsx` ainda usa `a.efeito` na descrição | Falta integrar AV5/6/7: descrição da simulação, histórico paginado e conferência por recibo, sem executar novamente. Conferir conflito, resposta perdida e autoria. |
| Terminal privilegiado separado e publicação vinculada ao candidato | Fontes `lib/acoes/terminal.ts`, módulos de publicação e instaladores de deploy | Há contrato local. Verificar versão/manifesto, provas e guardas do pacote final; instalação real é gate externo. Não ativar Terminal nem publicar como parte desta auditoria. |
| Triagem de contatos e fila de atendimento | `ContactTriage.tsx`, `contact-triage/jobs.ts`, `refresh.ts`, `analyze.ts` | Backend/triagem existem; completar apresentação AV14, filtros/paginação/fila operacional e retomada. `listContacts(limit=200)` é corte fixo, não fila paginada completa. |
| Rascunho compartilhado, autoria, versão e30dias | Nova frente autorizada em `contact-drafts.*`, rota e `ResponderContato.tsx` | Em trabalho por agente dedicado. Provar CAS, concorrência, retenção, descarte/novo ciclo e preservação do texto em falha. Salvar não pode enviar. Não confundir este incremento com editor rico/thread prontos. |
| Editor rico e resposta individual/em conjunto | `ResponderContato.tsx` usa assunto e textarea, prévia texto/card; backend de resposta durável | Falta editor Markdown/HTML sanitizado com alternativa textual e fluxo em conjunto por destinatário/intenção, quando aplicável ao pedido. Preservar texto/card e aprovação humana. História atual em `contato/page.tsx` ainda reduz resultados a agendada/enviada/falhou; integrar estados AV2/3 sem presumir entrega. |
| Histórico transacional gráfico de cada mensagem | `mail/history.ts`, arquivo/journal, APIs de mensagens/prévia/recuperação | Backend existe; página `admin/emails` ainda é principalmente estatística/agregados. Integração de recuperação e prévia está em trabalho pelo principal. Completar lista/detalhe com metadados, tentativas/eventos e origem legada explícita; original ausente não pode ser reconstruído como se arquivado. |
| Recebimento e conversas de e-mail | APIs atuais de mail/eventos e webhooks tratam eventos de entrega; Ponte do dono é separada | Não encontrei na árvore inspecionada modelo/rota/interface de mailbox/thread de mensagens recebidas. Planejar entrada autenticada, deduplicação, correlação, anexos limitados e respostas no mesmo caso. Estatísticas do Email Routing e eventos de abertura não são caixa de entrada. |
| Base de comunicação e divulgação para contatos adicionados | Cadastro de assinaturas, contatos e `referrers` são estruturas distintas | Não encontrei uma base administrativa de comunicação com adicionar contatos, procedência, elegibilidade e descadastro própria. Criar contrato separado; não converter assinatura/contato recebido em autorização automática de campanha. Fluxos existentes e guardas de envio precisam ser mantidos. |
| Base comum de conhecimento e perfis por finalidade | `knowledge/catalog.ts`, `search.ts`, APIs `conhecimento` e `ia/{configuracao,contexto,gerar,uso}` | Backend versionado existe. Configuração atual só admite provedor `openai`; disponibilidade real é gate separado. Falta UI de fontes/configuração/uso e curadoria durável de aprendizado previsto. Não tratar índice estático e busca lexical como toda a base que aprende. |
| Assistente do painel no canto inferior esquerdo | Três usos existem no backend; nenhuma chamada às APIs IA/conhecimento foi encontrada nos componentes/páginas administrativos consultados | Falta componente integrado, consulta com citações/fontes, estados indisponível/incerto, revisão de contexto e limites. Não confundir APIs testadas com assistente visível funcionando. |
| Geração de divulgação editável | Finalidade `divulgacao` no backend; gerador de cartaz existente é outro fluxo | Falta tela com campos/presets, prompt, geração revisável, edição, prévia e exportação do material previsto, sem envio automático. Não substituir pelo cartaz fixo ou pelo editor de resposta de contato. |
| Atendimento assistido e aprovação pelo dono | Triagem, sugestão de resposta e executor IA existem; Ponte externa recebe pedidos do dono | Falta ligar minutas aprovadas ao editor e completar o ciclo durável de revisão/aprovação pelo dono quando ocorrer por e-mail. Uma mensagem recebida não deve autorizar comandos. Provar uma conversa do caso com revisão, versão e ausência de envio indevido. |
| Campus ausente: pesquisar fonte oficial, propor e revisar | `contact-triage/campus-review.ts` valida proposta/cidade/fonte, encadeia revisão e declara que nunca busca URL | Curadoria humana existe. Pesquisa oficial e informe ao dono não estão comprovados. Implementar aquisição de evidência controlada, fonte/proveniência e proposta geográfica; aprovação não pode publicar campus silenciosamente nem alterar assinaturas. |
| Edição/arquivamento recuperável por entidade | Matriz `ETAPA-04-MATRIZ-ENTIDADES.md`; remetentes possuem versão/arquivo; indicações têm criação idempotente | Não há CRUD universal pronto, nem ele seria correto para auditoria/documentos. Completar campos/ações aplicáveis, versão e restauração para indicações/domínios conforme contratos. Listas/contagens/exportações devem refletir arquivamento; registros publicados continuam imutáveis. |
| Portal de assinatura do presidente e documento final | `admin/lotes/page.tsx` oferece upload/código; `signer.ts` implementa somente `none`; `signed-pdf.ts` usa validador plugável | Autoria da criação manual está em trabalho, além de controles já testados. Ainda faltam portal do responsável, desafios/documento/versionamento/QR, estado/resultados e fluxo final. Credencial/certificado/gov.br são dependências de homologação; não marcar assinatura própria como ICP nem retirar a guarda de envio. |
| Nome oficial no PDF e independência da revisão local | `batches.ts:LIST_SQL` lê `signatures.name`; não há nessa consulta promoção de decisões locais | Verificar a origem efetiva do nome armazenado e a política central no candidato final. Não afirmar que decisões da ferramenta local já chegam ao PDF nem promovê-las automaticamente. Esta auditoria não autoriza um novo fluxo público de alteração de CPF/nome. |
| Entrega integral verificável e reversível | Roteiros em `tools/admin-qa/`, testes e docs por etapa; múltiplos checkpoints | Falta matriz final requisito/teste, commit fechado, cumulativa desse commit, tipos/build, QA integrado, manifesto e instruções de publicação/reversão. Aprovação do plano não autoriza deploy. |

## Nove próximas ações de execução

1. **Fechar as frentes já atribuídas**: senha8, rascunhos30dias, autoria de lotes,
   recuperação e prévia. Cada uma entrega commit e evidência própria; uma pessoa
   coordena build e alterações de esquema para impedir corridas entre agentes.
2. **Conectar a Central aprovada**: AV5/6/7, histórico/recibo, erro incerto e
   descrição atual da simulação. É uma frente independente de credencial real.
3. **Concluir a UX transacional**: lista/detalhe/preview/journal e estados do
   contato. Reutilizar backend pronto; provar UI real e resposta perdida, não
   montar uma cópia do componente só para o teste.
4. **Entregar IA visível nas três finalidades**: configuração/fontes/uso,
   assistente no shell e gerador editável; depois ligação ao atendimento. Testar
   serviço desarmado e retorno simulado validado, sem chamada paga automática.
5. **Concluir contato como fluxo operacional**: paginação/fila, histórico,
   editor rico e operação em conjunto com revisão por destinatário. A extensão
   de rascunho não deve deixar o estado antigo de envio enganoso.
6. **Implementar entrada e base de comunicação**: contrato de provedor,
   recebimento autenticado/deduplicado, threads/anexos e contatos externos com
   procedência/descadastro. Separar as mensagens do dono das dos participantes.
7. **Completar curadoria e entidades**: evidência oficial de campus e proposta
   revisável; concluir edição/arquivo/restauração aplicáveis de domínios e
   indicações com versões e intenção. Não disponibilizar SQL por célula.
8. **Completar o módulo de documentos**: preservar snapshot/recuperação de
   preparo, portal do presidente, documento final e assinatura por métodos
   distintos. Qualquer adaptação da política ICP exige decisão explícita própria.
9. **Executar aceite integral** sobre um único commit consolidado: níveis,
   seis larguras, erros de rede, preservação, esquema/rollback e fluxos públicos;
   produzir manifesto/relatório. Publicação permanece etapa separada autorizada.

## Dependências externas reais e limites das provas

- Entrada de e-mail requer escolher um provedor/conta e configurar sua entrega
  autenticada. Esta auditoria não verificou credenciais; não afirma que estejam
  ausentes. Pode haver adaptador completo e testado localmente antes de ativação.
- IA real exige habilitação, credencial própria e modelo/limites disponíveis;
  `ai/execution-gate.ts` não usa automaticamente a autenticação deste chat.
  Resposta fictícia ou API acessível não provam acesso de uma conta real.
- Assinatura depende do certificado/método e da validação admitida. A consulta
  oficial e seus limites já constam em
  `ETAPA-06-ASSINATURA-INTEGRACAO-20261108.md`; não foi feita nova pesquisa ou
  envio de documento nesta auditoria.
- Serviços privilegiados, migração e deploy na VPS requerem autorização própria
  e validação remota na etapa adequada. A ausência dessa ativação não justifica
  deixar interfaces e contratos locais do escopo sem implementação.
- Informes duráveis ao dono e o ciclo de aprovação por e-mail precisam de prova
  específica. Uma aprovação em chat, o aceite HTTP do provedor de e-mail e uma
  mudança do estado no monitor representam fatos diferentes.

## Prova de conclusão a exigir

Para cada linha da matriz, registrar origem, responsável, commit, arquivo de
teste/roteiro, execução atual e resultado. Onde o serviço real deva permanecer
desligado, testar e documentar explicitamente o estado desarmado e o que falta
para homologá-lo. Classificar como incompleto aquilo que só possui proposta,
backend sem fluxo visível ou evidência de outro snapshot. Não calcular um
percentual de conclusão por quantidade de testes ou arquivos.

O candidato deve chegar ao dono com diferenças administrativas revisáveis,
prévia preservada, decisões anteriores intactas e nenhuma escrita silenciosa na
VPS. Somente depois dessa auditoria final há base para declarar o painel integral
concluído e solicitar a autorização de publicação.
