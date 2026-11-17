# Domínios: inventário e contrato antes da gestão recuperável

Inspeção somente leitura após `ccaaa8a`. Não implementa este módulo e não altera
esquema, decisões, cache, interface, formulários ou VPS. O esquema está reservado
à frente do portal de documentos; nenhuma tabela foi criada nesta etapa.

## Escritores e efeitos observados

| Fonte | Escrita atual | Efeito a preservar |
|---|---|---|
| `institutional.ts:decideDomainInTransaction` | decisão, tipo, instituição, evidência, decisor/data; aprovação por fonte chama esse mesmo núcleo | Aprovação pode atualizar selo/instituição de assinaturas existentes, sem mudar nome/CPF/categoria. Rejeição não faz a mesma propagação retroativa. Não transformar arquivo em decisão. |
| `institutional.ts:notePendingDomain` | candidato ou contador/data de candidato pendente | Contadores de observação não devem invalidar revisão de metadados sem necessidade. |
| `db.ts:seedIfesDomains` | insere/promove pendentes IFES; preserva decisão manual; pode atualizar selo ainda ausente | Uma versão administrativa precisa detectar promoção concorrente da semente; preservar backfill já existente. |
| `db.ts` bootstrap | insere UNIR e completa sigla ausente | Não resetar decisão, versão ou arquivo ao iniciar/reaplicar DDL antigo. |
| `university-check.ts` | candidato estrangeiro e contador de pendente | Não alterar a validação de estrangeiro neste trabalho; nenhuma chamada externa no QA. |
| `domain-import.ts` | candidatos novos pendentes; não sobrescreve conhecidos | Preservar origem e evitar ampliar aprovação automática. |

`approvedDomains` e `classifyDomain` consideram aprovados/rejeitados, precedência
por domínio/subdomínio, bloqueios e cache60s. `institutionInfo` usa o nome efetivo
da instituição para novos registros. A página de domínios lê todos os registros;
a interface atual ainda possui decisões unitárias sem versão/intenção. Aprovação
em lote usa snapshot/HMAC por fonte, mas não equivale a ledger de intenção.

## Contrato recomendado

1. **Arquivo administrativo não revoga regra**. Adicionar estado de organização
   separado; não remover registros de `approvedDomains`, sugestões/validação ou
   classificação. Código do domínio, origem, primeira data e decisões históricas
   permanecem. Desarquivar somente retira esse estado de organização.
2. **Separar metadados de decisão**. Evidência pode ser corrigida com versão e
   auditoria. Alterar instituição efetiva, tipo ou status deve ser uma operação
   explícita do fluxo de decisão, com impacto previsto e resultado real. Não
   apresentar essa alteração como inofensiva organização do catálogo.
3. **Não renomear domínio**. Uma nova chave passa pela curadoria própria; não
   reescrever o histórico de outra chave nem converter subdomínio silenciosamente.
4. **Versão observável por todos os escritores semânticos**. A versão deve mudar
   em decisões e promoção de semente; contador/seen_count isolado não precisa
   mudar essa versão. HMAC dos campos relevantes ajuda a detectar legado, mas
   sozinho não substitui geração monotônica em sequências de editar/restaurar.
5. **Ledger próprio**. Não reutilizar `admin_referral_mutations`: sua chave
   estrangeira e resultado pertencem a códigos de indicação. Usar tabela própria
   para domínio/intenção/ator/fingerprint/resultado exato, sob transação e travas
   compatíveis com gestão de contas e `institutional-domain-decision`.
6. **Controles**. Ator/sessão atual, CAS, UUID por ator, replay exato e409 para
   reuso divergente; Edição para editar/decidir e Exclusão+confirmação extra para
   arquivo/restauro. Não aceitar credencial, SQL ou endpoint do navegador.
7. **Sem efeitos laterais na recuperação**. Reconciliar uma resposta perdida
   consulta ledger e retorna resultado; não decide/propaga selo novamente. As
   alterações de selo, auditoria e resultado precisam ser atômicas no primeiro
   aceite. Cache só é invalidado após o commit bem sucedido.
8. **Listas e integração**. API nova oferece ativos/arquivados/todos, versão e
   paginação; interface e migração das decisões antigas entram em marco próprio.
   Não declarar proteção universal enquanto a rota antiga continuar escrevendo
   sem versão e intenção; compatibilidade de formulário legado será explícita.

## Critérios de aceite e próxima ordem

- Provar em banco fictício que arquivo/restauro não alteram classificações,
  assinatura/CPF/nome/categoria, contagens, regras ou sugestões vigentes.
- Provar versão atualizada por decisão e promoção concorrente IFES; contadores
  não causam conflito desnecessário. Estados rejeitados e regras de subdomínio
  continuam com precedência idêntica.
- Duas revisões concorrentes: uma aceita, outra409, sem perda de proposta. Mesma
  intenção após uma edição posterior retorna resultado original; entrada
  divergente com mesmoUUID409; ator revogado não acessa replay.
- Falha de auditoria/ledger/propagação reverte decisão, selo, arquivo e versão;
  não limpar caches como se o commit tivesse acontecido.
- Repetir ensaio de esquema real anterior, DDL idempotente e bootstrap antigo
  preservando registros, precisão temporal e ledger; aumentar a lista estrita de
  tabelas só após coordenar a nova base do esquema.
- HTTP: origem, sessão, nível, confirmação extra, limite de corpo, campos fixos,
  paginação e rejeição de chave renomeada; zero envio/provedor/consulta externa.
- Integrar fluxos unitário e lote ao cliente com a mesma versão/intenção; manter
  estética/textos existentes e submeter textos novos ao dono antes de adicioná-los.

Próximo marco permitido no momento: fechar contrato/arquivos e aguardar liberação
coordenada de esquema. Decidir se o primeiro patch faz somente catálogo/evidência
ou também decisões versionadas antes de implementar. A escolha não é autorização
de deploy e não deve ser inferida como mudança da política pública de domínios.
