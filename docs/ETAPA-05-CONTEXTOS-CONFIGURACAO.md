# Etapa 5 — contextos, configuração e contrato de geração

07/11/2026. Registro do checkpoint 03f251c: preparação sem nova tabela ou interface ativa. O complemento posterior está em `ETAPA-05-EXECUTOR.md`: acrescenta executor/reserva durável, mantendo chamadas reais desativadas por padrão. A disponibilidade atual depende das portas de serviço/configuração/credencial, não apenas da preferência solicitada. As limitações e evidências abaixo registram a etapa de preparação.

## Configuração revisável

`GET/POST /api/admin/ia/configuracao` exige Total; gravar exige também confirmação extra. A gravação revalida a conta ativa/nível/e-mail, serializa a configuração e exige `expectedRevision`. Auditoria e mudança são atômicas. Estado inválido não é substituído por padrão silenciosamente.

`settings.admin_ai_profiles_v1` guarda apenas preferências: habilitação solicitada, provedor/modelo/esforço dos três usos e limites de bytes de entrada, tokens de saída, chamadas/dia e tokens de saída/dia. Não recebe chave ou endpoint arbitrário. Padrão desativado, modelo `null` para cada uso. O primeiro protocolo disponível é OpenAI; outros provedores continuam pendentes. Uma seleção não comprova acesso ou compatibilidade do modelo. `executionAvailable:false` permanece explícito mesmo se `enabled:true` for solicitado: limites diários ainda precisam de reserva durável no executor, e não há teto monetário prometido.

## Contextos distintos

`POST /api/admin/ia/contexto` aceita `{modo:"preparar",input}` ou `{modo:"conferir",input,proof}`. `input` é `{uso,consulta}` para painel/divulgação e `{uso:"atendimento",consulta,contato}` para atendimento. Leitura prepara o painel; os demais usos exigem Edição. Corpo limitado, mesma origem e chaves exatas.

Cada função tem instruções próprias e usa fontes permitidas da base comum. Atendimento exige triagem atual e recebe apenas categoria/estado/motivos e a minuta-base genérica: não copia nome, endereço, CPF/hash, token, nascimento, mãe, sexo ou relato do banco. A consulta livre do administrador usa a validação existente; isso não é um anonimizador geral de qualquer texto digitado. Contexto maior que o limite é recusado, sem corte silencioso. Ausência de fonte não vira resposta inventada.

A prova HMAC vincula instruções, entrada, versões das fontes, finalidade, configuração/limites e prova da triagem. Mudança de configuração, referência ou revisão invalida o contexto anterior. Não é autenticação, confirmação de identidade ou selo de envio. A API devolve identidade do contexto e referências, não o prompt/consulta transientes. As leituras têm seus snapshots; o futuro executor precisa revalidar o conjunto e a configuração antes da reserva/chamada e antes de devolver a minuta.

## Protocolo OpenAI conferido

`ai/openai-protocol.ts` apenas constrói/valida o protocolo em memória: não lê credencial, não faz `fetch` e não envia. Usa Responses com estado desativado por `store:false` e entrada/instruções separadas, conforme a [documentação oficial](https://developers.openai.com/api/docs/guides/migrate-to-responses). Isso não comprova a política de guarda de outros componentes.

Mantém o modelo escolhido, omite esforço quando configurado como padrão e não presume que todo modelo aceite todo esforço. O limite de saída inclui raciocínio não visível; respostas incompletas não viram minuta, conforme o [guia de raciocínio](https://developers.openai.com/api/docs/guides/reasoning). O [contrato de saída estruturada](https://developers.openai.com/api/docs/guides/structured-outputs) fundamenta o esquema JSON estrito. Não solicita ferramentas ou histórico persistente.

O parser só aceita mensagem final do assistente, JSON com texto/citações/revisão humana obrigatória, pares de fonte/versão conhecidos e contagem de uso coerente dentro do limite. Descarta raciocínio oculto; recusa saída de ferramenta, recusa/incompletude, citação inventada, conteúdo extra e uso inválido. A minuta aceita é texto simples; isso não comprova veracidade de cada frase ou substitui revisão humana.

## Verificação e continuidade

As duas primeiras rodadas encontraram problemas de fixture (coluna `token` em vez de `token_hash`, senha fictícia contendo o e-mail) e uma propriedade duplicada, corrigidos sem relaxar regras. Depois passaram 23/23 direcionados. A primeira suíte cumulativa passou 438/438, mas o build detectou uma união estrutural mal discriminada na rota: preparação e conferência agora têm ramos separados, sem cast ou relaxamento de tipos. Build, typecheck serial e HTTP compilado passaram após essa correção. A suíte cumulativa final também passou **438/438** sobre o código corrigido. Nenhuma consulta paga, leitura de credencial real ou uso da autenticação deste chat.

O build interrompido removeu o artefato compilado e a primeira restauração automática da prévia local falhou. O mesmo banco de prévia foi preservado; parâmetros fictícios de sua inicialização foram recuperados do histórico da própria execução, verificados por modo preview/provedor dev/diretórios de teste e reutilizados sem imprimir valores. O build corrigido e o HTTP restabeleceram a prévia 3031 (200), com as sessões de QA revogadas. Não houve operação na VPS ou no SQLite de revisão.

O lançador local corrigido guarda um registro protegido da configuração fictícia e passa a copiar um artefato compilado anterior antes de futuros builds, com rotina de restauração. Essa rotina adicional de restauração de cópia ainda não tem ensaio dedicado de falha; a recuperação por reconstrução do artefato foi a executada nesta rodada. Usar como base o lançador privado `run-ai-context-fixed-qa.py`, na cache de auditoria, para não repetir a dependência exclusiva do ambiente de um processo já encerrado. Valores/runtime ficam fora do Git.

Evidências na cache de auditoria: `stage05-context-targeted*.log`, `stage05-context-cumulative.log` (primeira), `stage05-context-build.log` (erro de tipo), `stage05-context-fixed-build.log`, `stage05-context-fixed-typecheck-serial.log`, `stage05-context-fixed-runtime.log`, `runtime-ai-context-fixed/ai-context.json` e `stage05-context-cumulative-final.log`. HTTP comprovou três contextos, níveis/stepup, perfis explícitos, conflito de revisão, invalidação por configuração/triagem e prompt não exposto. Não houve escrita de assinatura, fila ou resposta. Nenhum DDL novo; esquema de onze tabelas permanece o já ensaiado. Não equivale a validação de interface ou de um modelo/conta real.

Próximo bloco obrigatório: reserva durável de quota/idempotência e executor com registro de uso/incerteza, sem repetição automática de chamada paga. Também faltam outros provedores, minutas persistentes/retencão, informes, interfaces e demais etapas. Não ativar IA ou publicar por inferência de aprovação dos textos pendentes; deploy final continua sujeito à autorização do dono.
