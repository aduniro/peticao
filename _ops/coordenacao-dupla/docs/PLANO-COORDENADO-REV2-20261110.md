# Plano coordenado — revisão 2 para aprovação

Estado: PROPOSTA DA REVISÃO 2; execução aguardando aprovação expressa.
Preparado em10/11/2026, após a preservação da sessão e a nova orientação sobre formulários/instituições.

O plano anterior foi aprovado: /mnt/apps/peticao-final/_ops/coordenacao-dupla/docs/PLANO-INTEGRACAO-CUMULATIVA-20261110.md. A aprovação está registrada em /mnt/apps/peticao-final/_ops/coordenacao-dupla/evidence/APROVACAO-PLANO-20261110.json. Esta revisão preserva o trabalho e as autorizações anteriores; reorganiza a retomada e as dependências. Não confundir a revisão nova pendente com revogação da aprovação anterior.

## Objetivo e duas frentes

Entregar uma plataforma cumulativa que una a página pública de assinaturas ao frontend e backend do admin-v2, preservando dados, histórico e versões recuperáveis.

| Frente | Responsável | Escopo |
|---|---|---|
| Admin-v2 | Sessão01a1a4bd-cdf4-7253-88e7-0c9fb9265aa7 | Prioridade documental; revisão de compatibilidade administrativa; integração cumulativa |
| Página de assinaturas | Sessão01a1c0b3-f069-75a0-a2e9-e691094c9bab | Formulários, fluxo público, instituições/domínios e migrações próprias; infraestrutura com subagentes em escopos separados |

A raiz central é /mnt/apps/peticao-final. O roteiro de preservação está em /mnt/apps/peticao-final/CONTINUAR-ADMIN-V2.md. Não excluir nem sobrescrever originais. História privada e dados pessoais ficam fora do Git e dos servidores de prévia.

## 1. Conferir o ponto de retomada

Antes de reativar trabalhos: conferir commits, alterações pendentes, processos e jobs realmente ativos. O fechamento dos terminais não comprova encerramento de serviços. Reconciliar leases incertos pelo protocolo, sem takeover automático.

- Base cumulativa: /mnt/apps/peticao-final/peticao-integrado; baseline0a5f734da4f9b8a35a10a20eaa9fb4fd5adb0e4f.
- Candidato admin preservado: /mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109.
- Candidato público: /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109.
- Drafts/provas: /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109.
- Coordenação única: /mnt/apps/peticao-final/_ops/coordenacao-dupla; protocolo /mnt/apps/peticao-final/_ops/coordenacao-dupla/PROTOCOLO.md.
- Catálogo: /mnt/apps/peticao-final/_ops/releases-admin-publico/r0000/manifest.json.

O build QA passou, mas não equivale a artefato de produção. A1 real/gov.br real continuam com homologações pendentes. Os drafts unsigned têm provas isoladas e não estão integrados. A revisão unsigned bloqueada automaticamente permanece interrompida: esta aprovação não libera nem autoriza repetir a solicitação por outro caminho. Registrar o impedimento e avançar nas etapas independentes permitidas.

## 2. Executar em paralelo sem depender do novo cadastro

Na frente admin, priorizar documentos, PDFs, revisão, assinatura nativa/A1/gov.br conforme disponibilidade, aprovação e envio dos lotes. O caminho explicitamente sem assinatura digital deve ter alerta/aceite humano e preservar as assinaturas coletadas, os PDFs anteriores, a aprovação e a prevenção de duplicidade. Um certificado não disponibilizado não bloqueia partes independentes.

Podem avançar também empacotamento, catálogo de releases, testes isolados, monitoramento e infraestrutura já autorizada, respeitando as reservas de cada autor. Nenhuma tarefa pode reabrir atividade bloqueada por segurança. Não declarar execução em segundo plano sem processo, serviço ou agente observado.

Enquanto os novos campos/regras estiverem em definição, adiar alterações administrativas dependentes do novo modelo cadastral: filtros por novas categorias, rankings, exportações e vínculos instituição/domínio/lotação. Evitar hardcode de regras em transição.

## 3. Especificar e implementar a página pública no outro chat

O responsável apresentará naquela sessão os ajustes de formulários, elementos, fluxo e categorias institucionais. O agente consolida uma especificação e identifica o que já está decidido ou ainda falta definir; não inventa categorias a partir da expressão “mais ou menos o plano original”.

A ampliação deve contemplar instituições além das IFES conforme o escopo definido pelo responsável. A restrição atual ao MEC só muda quando a nova elegibilidade estiver especificada e implementada. Identificar a titularidade de um domínio não autoriza automaticamente sua participação em qualquer categoria.

Tratar frontend, validação backend e migração como uma funcionalidade única:

- Relacionar sigla, nome oficial, instituição e múltiplos domínios/subdomínios, com procedência oficial; resolver desconhecidos sem adivinhar.
- Definir campos de categoria, cargo e lotação aplicáveis; preservar regras válidas de UF/cidade, hospital/cidade e regiões, revisando-as quando houver impacto real.
- Definir seleção pelo e-mail, tratamento de divergências e elegibilidade em cliente e servidor.
- Preservar os cadastros existentes; mudanças de classificação devem ser rastreáveis e ter estratégia de retorno compatível com os dados.
- Modificar fonte, tamanho e aparência somente no escopo solicitado pelo responsável. Preservar o comportamento já aprovado de clique mostrar opções do contexto e digitação filtrar.

O agente público é o autor responsável pelas migrações desse escopo. Não haverá duas migrações independentes para a mesma alteração. Esta sessão revisa o impacto administrativo e integra o conjunto validado.

## 4. Compartilhar contratos e adaptar o admin-v2

Assim que houver proposta estável de campos/regras, compartilhar versões de API, esquema, compatibilidade, backfill e impacto nos documentos e relatórios. A coordenação pode ocorrer durante o desenvolvimento; não precisa esperar a conclusão de toda a página pública.

Cada alteração anuncia commit exato, todos os arquivos, contratos, banco, testes e destino. Obter ACK do par e lease apropriado antes de integrar. Não aceitar uma simples observação automática de arquivo como revisão de compatibilidade.

Adaptar listas, filtros, diagnósticos, rankings, instituições/domínios, documentos e exportações apenas onde o novo contrato exigir. Cobrir usuários e categorias existentes e novas, sem atribuir informação não comprovada a cadastros antigos.

## 5. Emitir versões integradas cumulativas

Branch específica por escopo; integrar funcionalidades concluídas na base /mnt/apps/peticao-final/peticao-integrado. Preservar os recursos já incorporados; não reaplicar o patch público equivalente já contido na baseline.

Por funcionalidade: testes dirigidos de frontend/backend/banco, contratos e build adequado. Por módulo/seção: regressão correspondente. Migrations devem ser ensaiadas também na versão efetiva PostgreSQL17 da produção, sem usar dados reais nos testes. Builds de QA e ensaios sintéticos não são homologação A1/gov.br real.

Cada release registra commit, origens, alterações, concluído/pendente, testes, schema, runtime, hashes e retorno. Só fica pronta após artefato completo e compatível. O empacotamento inicial deve respeitar o contrato next-start-v1 e a unidade efetiva da produção; .next isolada e links para cache não são um runtime portátil.

## 6. Infraestrutura e comunicação

Manter Santiago como coordenador/executor qualificado, com um job pesado por vez e limites iniciais de3vCPU/5GiB. SãoPaulo preserva a produção; uso de prévias leves exige conferir a carga e manter isolamento. Não criar custos adicionais ou expandir publicação pública implicitamente.

Central privada de Versões/Deploy, prévias Tailnet e executor autenticado por e-mail continuam no plano aprovado. São tarefas secundárias à prioridade documental/página pública e podem ser delegadas sem disputar recursos. O executor não recebe autoridade irrestrita de mensagens de terceiros nem contorna pausas ou bloqueios. A prontidão24h é serviço supervisionado, não garantia de disponibilidade contínua do modelo.

Manter um único Vigia/histórico/fluxo de relatórios por e-mail a cada1h, com ambas sessões e subagentes, atividade real, commits, testes, pendências e percentuais por critérios. Não criar outro timer ou repetir envios bloqueados/incertos. Informar estimativas quando houver evidência; não reaproveitar prazos antigos como previsão atual.

## 7. Deploy e continuação

Preparar uma versão não publica a aplicação. Deploy admin-v2 exige autorização específica do responsável para a release exata. Página pública só é publicada diante de pedido acompanhado de deploy, após compatibilidade e provas. Clique autenticado no controle qualificado pode representar essa autorização para a versão vinculada.

Depois do documental operacional, seguir os demais módulos de Campanha, Assinaturas, Comunicação, Mapas e Visão Geral, conservando a ordem de prioridade já determinada. Ajustes de Conta/Acesso necessários a essas entregas acompanham a dependência. Ampliação multiprovedor de IA continua por último; motor atual OpenAI.

## Aprovação e goals

Solicitar ao responsável aprovação desta revisão antes de reativar execução. A aprovação deste documento não define sozinha quais novas instituições/categorias são elegíveis: essas regras serão fornecidas e consolidadas no chat público. Enquanto faltarem, executar somente as partes independentes aprovadas.

Goals para apresentar integralmente nas respectivas janelas, sem criar objetivos nativos duplicados:

- Sessão admin: /mnt/apps/peticao-final/_ops/coordenacao-dupla/docs/GOAL-ADMIN-V2-REV2-20261110.txt.
- Sessão pública: /mnt/apps/peticao-final/_ops/coordenacao-dupla/docs/GOAL-PAGINA-ASSINATURAS-REV2-20261110.txt.

Os textos são propostas para atualizar os objetivos existentes. Até a aprovação e retomada efetiva, não afirmar que o goal nativo foi atualizado, que agentes estão ativos ou que a revisão está sendo executada.
