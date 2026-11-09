# Auditoria e plano de continuidade do admin-v2

Data: 06/11/2026. Solicitação: reconstruir o trabalho do Claude, preservar a estética aprovada e planejar integração com o backend efetivamente publicado.

**Resultado:** o painel visual e o primeiro conjunto administrativo existem localmente; a expansão pedida depois não foi implementada. A VPS ainda utiliza o painel anterior. A continuidade exige integração controlada, e não publicar integralmente o checkout local ou repetir os comandos antigos.

## 1. Escopo, método e limites

- Inventário de 616 arquivos textuais, aproximadamente 51.797 linhas, abrangendo aplicação, ferramentas, deploy, documentação e referências. Mapeamento estático de 407 arquivos de `site/src`, com imports, exports, chamadas de rede e referências SQL.
- Inspeção dos 23 arquivos de página do admin, 41 handlers de API administrativa e 28 componentes administrativos, com leitura aprofundada de autenticação, permissões, ações, terminal, publicação, consultas, e-mail, cadastro, cache, confirmação e PDFs.
- Consulta dos históricos JSONL das três sessões do projeto em `/home/barre/.claude/projects/-mnt-dev-peticao/`, planos pertinentes em `/home/barre/.claude/plans/`, oito documentos de memória/instrução do Claude, `AGENTS.md`, log original, histórico de problemas, documentação de deploy/preview e roteiros locais de QA.
- Conferência do Git, cópias preservadas e capturas históricas do painel; leitura da referência `analises/shiny_app/www/apuracao.css`.
- Nova captura sanitizada do código atual da VPS, hashes de produção/stage e metadados de esquema por transação PostgreSQL `READ ONLY`. Não foram consultadas linhas com dados de assinantes para esta auditoria.
- Credenciais, `.env`, `secrets/`, `preview-state/`, bancos/exportações de assinantes, dependências e binários não integram a auditoria de fontes. Não foram alterados aplicação, serviços, configuração ou banco da VPS.
- Esta é auditoria estática e documental com verificação de estado. Os testes antigos são evidência histórica; não certificam o futuro candidato integrado. Não foram repetidos testes destrutivos, envios, migrações ou QA que modifica cadastros nesta inspeção.

Evidências técnicas privadas: `/mnt/dev/peticao/.cache/admin-audit-20261106/` (`source-inventory.json`, `source-map.json`, `api-contracts.json`, `vps-schema-and-services.txt` e fonte sanitizada em `production/`). Inventário remoto e diferenças: `/mnt/dev/peticao/.cache/admin-integration/vps-inventory-audit-current.json` e `audit-diff.json`.

Matriz legível dos 41 handlers: `docs/ADMIN-V2-MATRIZ-ROTAS-20261106.md`. Histórico principal da interrupção: `27aba71a-61a6-44d3-8ac0-5bd0427f19a8.jsonl`; a sessão `5fb28946-1326-4272-adbc-4d0ce907d93b.jsonl` registra o `resume` sem saldo. Fontes de planejamento: `LOG-2026-11-04-planejamento-admin-v2.md`, `steady-marinating-pumpkin.md` e `replicated-tumbling-star.md` no diretório de planos do Claude. Os registros originais foram preservados.

## 2. O que aconteceu e onde o Claude parou

1. `4c0efaa`: shell v2, dashboard, mapa único, botões e primeiras verificações visuais.
2. Etapas A/B/C: usuários e sessões, Central de Ações, confirmação extra e Terminal separado. Há commits equivalentes em ramos diferentes por cherry-pick; não reaplicar ambos.
3. `82f1406`: união dos componentes administrativos no shell v2.
4. `3ea9ef1` e `66a057f`: tema escuro global, login com olho, barra inferior; correção expressa para **Menu à esquerda e Filtros à direita**.
5. `54ed82d`, `2247636`, `c5231f5`, `d5db958`: rankings, calendário, popups, abas e regiões expansíveis.
6. `a2b349d` e `9d3f100`: padronização das telas e página de Configurações dos popups.
7. `171b198`, `9dc8abb`, `9784afe`: triagem externa no Vigia, aviso ao ligar Terminal, histórico da versão e merge local no ramo `producao`.
8. Às **06:34 UTC de 06/11** o Claude declarou esse conjunto concluído localmente, com tipos/build, 221 testes do site e 31 de ferramentas. Declarou explicitamente que não publicara na VPS.
9. Às **06:56 UTC**, houve NOVO pedido: triagem no app, campus ausente, IA de minutas, painel transacional gráfico, edição/exclusão, assinatura de documentos e editor rico. Às 06:57 ele começou a leitura e enumerou sete etapas.
10. Às **06:58 UTC (02:58 em Porto Velho)** surgiu `Credit balance is too low`. A orientação seguinte — manter as outras IAs e acrescentar a IA de e-mails — também recebeu esse erro. As mensagens sobre centralizar um título dentro de um retângulo, às 08:56 UTC, tampouco receberam implementação. O `resume` posterior voltou a falhar por saldo.

**Não foi identificado nos registros consultados um crash do site como causa dessa interrupção:** a evidência é indisponibilidade por saldo do provedor do assistente. A memória “tudo pronto” refere-se ao conjunto anterior; não cobre o pedido das 06:56.

## 3. Versões e ambiente atual

| Local | Estado verificado |
|---|---|
| `/mnt/dev/peticao` | Ramo `integracao-admin-vps`; reúne admin local e correções posteriores do site público. |
| `/mnt/dev/peticao-parcial` | Ramo `producao`, commit `9784afe`; é candidato antigo com admin novo, não retrato da produção atual. |
| `main` / `admin-v2` | Pontos anteriores preservados; não representam o conjunto publicado hoje. |
| `/opt/peticao/app` | Código realmente em execução na VPS. |
| `/home/adunir/peticao-stage/site` | Mesmo inventário de código da produção nesta inspeção; ainda sem admin-v2. |
| Git da VPS / clone de trabalho | Não encontrados `/srv/git/peticao.git` nem `/home/adunir/peticao`. Os instaladores locais não foram instalados. |
| Terminal / Publicar | Unidades `peticao-terminal.service` e `peticao-publicar.path`: `not-found`. |
| Banco da VPS | 26 tabelas públicas; não existem as seis tabelas novas de usuários/ações/respostas do admin-v2. |

Comparação: 332 arquivos no inventário sanitizado de produção, **78 arquivos existentes diferentes** e **101 novos arquivos em `site/src`** no checkout local, incluindo testes e módulos de outras tarefas. Estas contagens não são uma lista de arquivos que devem ser publicados.

As árvores `site/src/app/admin` e `site/src/components/admin` continuam iguais ao merge `9784afe`. Já `cpf-name.ts`, `sign-flow.ts`, `sign-request.ts`, `cpf-cache-crypto.ts` e `cpf-check.ts` coincidem com a produção atual. Não retroceder esses arquivos ao estado do Claude.

Há diferenças públicas ainda não publicadas: confirmação de pendentes, acesso do assinante, rascunhos opcionais, normalização/deduplicação de e-mail e retenção das tentativas. O cache cadastral criptografado de 30 dias não deve ser confundido com a retenção de `identity_attempts`, ainda de sete dias na VPS.

Backups históricos encontrados: `/mnt/dev/backups/peticao-admin-v2-pre-visual-2026-11-05.tar.gz`, `/mnt/dev/backups/peticao-producao-pre-visual-2026-11-05.tar.gz`; cópia v1 em `/mnt/dev/peticao-v1-2026-11-04`. Não substituem backup fresco antes de uma futura publicação.

## 4. Estética que será preservada

A decisão posterior substituiu a proposta inicial de páginas internas claras: **todo o admin usa o verde escuro “vidro”**. Fontes e screenshots confirmam:

- Verde `#00391a`, `#00602a`, `#009c3b`, amarelo `#ffdf00`; cartões translúcidos, bordas discretas, texto claro e números tabulares.
- Fontes do sistema, sem depender de download de fontes no build. Componentes em `components/admin/ui/`, tokens em `app/admin/v2.css`, escopo `.adm.v2`/`.v2-escuro`.
- Desktop: topo fixo, trilho lateral de 78 px, submenus por hover/clique; identidade e nível no topo.
- Mobile: barra inferior principal, Menu à esquerda, Filtros à direita, gavetas e respeito à área segura do aparelho.
- Dashboard: cartões de UFs, indicadores, mapa SVG, distribuição por categoria, regiões e atualização ao vivo. Escala vermelha→azul para quantidade; verde/amarelo para identidade visual.
- Mapa interativo único com camadas; isolamento de empilhamento para nunca cobrir navegação. Preservar `/admin/mapa/tela`.
- Popups de estado e região configuráveis; ranking fechado inicialmente; abertura recolhe resumo; abas Servidores/Apoiadores e respectivas subdivisões; abrir uma região recolhe a anterior.
- Tabelas, botões, formulários, modais e telas novas reutilizam a mesma família visual. Não importar a estética vermelha do projeto `analises`.

Referências visuais inspecionadas: `.cache/qa/shots/f7-configuracoes.png`, `f7-configuracoes-mobile.png` e `f4-popup-estado-ranking.png`. São capturas históricas, não prova de publicação. O último pedido sobre título centralizado não identifica inequivocamente qual tela; registrar esse ponto e confirmar o alvo visual antes de espalhar a mudança por todo o portal.

## 5. Matriz do que existe e do que falta

| Módulo | Implementação encontrada | Continuidade necessária |
|---|---|---|
| Shell, dashboard, mapa, rankings, configurações | Implementados localmente | Integrar e validar com produção atual, sem redesenhar. |
| Login, quatro níveis, convite, recuperação | Implementados; transição da senha única | Migração, bootstrap do dono e provas de concorrência/revogação. |
| Central de Ações e reenvios | Implementados com simulação e auditoria | Corrigir consulta de saúde e completar vínculo da publicação ao candidato. |
| Terminal | Executor HTTP separado, ticket por comando, limites | Instalação e teste de isolamento; não é shell root nem terminal interativo completo. |
| Contato | Lista, situação cadastral, histórico de respostas, resposta texto + card | Triagem dentro do app, fila de atendimento e edição rica ainda ausentes. |
| Vigia | Regras externas, retomada por cursor e relatório por e-mail | Não roda continuamente hoje; migrar núcleo para serviço persistente sem depender da sessão. |
| Painel transacional | Entregas/aberturas/cliques por endereço e metadados | Falta arquivo de cada mensagem e prévia fiel de HTML/texto/anexos. |
| Caixa de entrada | Ponte do dono e formulário de contato | Não há mailbox robusta com recebimento de respostas, threads, editor e anexos. |
| Editar/Salvar/Excluir em tabelas | Correção de e-mail de pendente e ações específicas | Não existe CRUD geral ou exclusão recuperável universal. |
| Base de conhecimento e IAs | Proposta e referências | Não encontrados módulos implementados de KB, assistente ou geração. Manter todas as funções propostas. |
| PDFs e assinatura | Geração de lote, upload e verificação estrutural + validador ICP plugável | Assinatura automática não implementada; fluxo gov.br, presidente e documento final incompletos/ausentes. |
| Resolvedor de nomes | Política e ferramenta de revisão local | Ainda não ligado à geração oficial dos PDFs. Decisões locais não devem ser promovidas automaticamente. |

## 6. Achados que exigem correção antes da liberação

### A1 — Consulta de saúde incompatível com o esquema real

`site/src/lib/acoes/estado.ts` consulta `mail_log.created_at`; o esquema real possui `mail_log.ts`. A exceção é convertida silenciosamente em lista vazia. Corrigir a coluna e distinguir “sem envios” de “consulta falhou”. Não interpretar o instante de importação do módulo como horário real de inicialização do servidor.

### A2 — Falhas de rede ainda escapam em componentes administrativos

`Acoes.tsx` e `ResponderContato.tsx` usam `try/finally`, mas não capturam a rejeição de `fetch`; `Confirmar.tsx` também depende de uma função de envio sem tratamento completo. O mesmo tipo de erro corrigido no formulário público pode aparecer no admin. Preservar texto, filtros e rascunhos, liberar botões, apresentar erro e não repetir envio automaticamente. Não reutilizar o contrato específico de `/api/assinar` para todos os endpoints.

### A3 — Publicação não está vinculada ao commit aprovado

`publicar.pedir` valida parâmetros vazios e exige a palavra PUBLICAR; o sinal contém id, autor e horário, sem SHA do candidato. `VERSAO`/`MUDANCAS` descrevem a versão/stage, mas não garantem que a versão simulada seja a executada depois. Vincular proposta e execução a manifesto/hash exato, conferir imediatamente antes da troca e recusar stage alterado. Serializar com o mesmo mecanismo dos demais publicadores, não só uma trava própria da Central.

### A4 — Controles de conta precisam de atomicidade e revogação

`alterarNivel()`/`definirAtivo()` contam os usuários Total antes de alterar, sem transação que serialize mudanças concorrentes. A garantia de “último dono” pode falhar com duas operações simultâneas. A redefinição de senha consulta e consome tokens em comandos separados. `trocarMinhaSenha()` não encerra outras sessões, embora documentação anuncie revogação ao trocar senha. Corrigir e testar concorrência/uso único. Rever exigência de confirmação extra para concessão de Total e mudanças sensíveis.

### A5 — Histórico de e-mails não contém o conteúdo completo enviado

`mail_log` registra tipo/provedor/destino/status/erro; não assunto, HTML/texto ou identificador estável de mensagem. `mail_outbox.payload` atende a fila, não um arquivo completo de todos os envios. Não prometer recuperar o HTML exato dos envios antigos sem evidência do provedor. Para o futuro, arquivar versões com controle de acesso e proteção; mascarar links de confirmação, tokens e códigos na prévia administrativa. Mostrar claramente quando uma prévia histórica é reconstruída, em vez de original.

### A6 — Respostas e tentativas precisam de identidade e idempotência completas

O handler de Terminal grava `ok=true` antes de saber o resultado do comando; faltam resultado final/código/encerramento vinculados ao registro. Resposta texto e card têm passos externos e persistência separados: falha entre envio e gravação pode permitir repetição. Usar outbox/idempotência por mensagem e estados claros. Correção/reenvio de pendentes precisa propagar o usuário real na auditoria, em vez do autor genérico `admin`.

### A7 — Triagem deve usar campos permitidos e retomar sem perder falhas

O coletor externo usa `to_jsonb(s)` com exclusões pontuais, o que é frágil quando surgem novas colunas sensíveis. Para migrar ao app, selecionar explicitamente campos necessários; parametrizar consultas; separar coleta, diagnóstico, revisão e envio. Persistir estados por mensagem, erros e tentativas, sem avançar o cursor sobre item não tratado. Não atribuir falha ao usuário sem evidência suficiente.

### A8 — Recorte regional perde candidatos antes de agregar

`resumoPorUf(10)` limita listas por estado antes de `juntarUfs()` formar a região. Uma IFES fora do top 10 de cada estado pode ter soma regional relevante e ser omitida. Fazer a agregação regional antes do limite e validar também as diferenças entre totais e registros sem localização. “Campus” é município + IFES; não distingue dois campi na mesma cidade.

### A9 — Roteiros de QA e documentação contêm condições antigas

Roteiros críticos estão só em `.cache/qa`, com porta 3012, caminho `/mnt/dev/peticao-parcial`, perfil de navegador compartilhado e SQL que apaga/altera usuários de QA. Alguns ignoram `NetworkError`/`ChunkLoadError` no coletor de erros. Promover testes úteis ao repositório, tornar ambiente explícito, usar banco isolado e não mascarar falhas de rede. `AGENTS.md` ainda diz que não há histórico Git, apesar de o repositório ter histórico e ramos. Documentos alternam status antigo de preview e produção: reconciliar antes do uso operacional.

### A10 — Edição, exclusão e assinaturas não podem ser atalhos de escrita arbitrária

O pedido de botões por linha precisa de contratos por entidade; tabelas de rankings agregados não são registros editáveis. E-mails enviados e documentos assinados são históricos imutáveis; editar significa criar nova versão/rascunho. Alteração de CPF deve ser fluxo dedicado, com validação/deduplicação e decisão sobre evidências originais; nunca edição manual de `cpf_hash` ou troca do pepper. Exclusão recuperável precisa propagar filtros a listas, contagens, exportações e lotes sem reescrever documentos já emitidos. Assinatura do app, ICP e gov.br são mecanismos distintos: não marcar um como outro nem remover silenciosamente a guarda atual de envio.

## 7. Plano de execução proposto

### Etapa 0 — Congelar referências e fechar o contrato

Criar checkpoint e checkout de integração isolado. Registrar hashes do código publicado, esquema, configuração por presença/digest e recursos ativos, sem valores secretos. Preservar revisão local e fontes originais. Consolidar matriz de requisitos incluindo o pedido das 06:56 e corrigir documentação desatualizada, com commits identificáveis.

**Aceite:** cada requisito tem origem, arquivos envolvidos, estado real e teste de conclusão; nenhuma modificação remota. Estimativa: 2–4 horas.

### Etapa 1 — Integrar o admin existente ao backend atual

Tomar a produção capturada como base e portar alterações administrativas completas. Mesclar `db.ts`, autenticação/API, rankings, filtros, monitor, contatos e helpers por dependência; preservar regras nome/CPF, cache, hotfix de rede, e-mails e confirmações publicados. Não incluir por acidente acesso do assinante, rascunhos ou outras mudanças públicas. Manter as seis tabelas administrativas como migração aditiva, explícita e ensaiada.

Corrigir A1–A4 e A8 no candidato; completar autoria, estados e contratos necessários de A6. Módulos privilegiados ficam indisponíveis até instalação e validação próprias. **Aceite:** regressão pública sem diferenças indevidas, APIs por nível e payload, migração em banco isolado, build e prévia do visual existente. Estimativa: 1–2 dias incluindo QA.

### Etapa 2 — Triagem e campus ausente dentro do app

Extrair/reutilizar `triagem-lib.mjs` sem levar SSH root para dentro do processo web. Job persistente no servidor coleta evidências por consultas controladas, grava caso/versionamento e exibe situação, motivos, atualização e minuta no Contato. Retomada após desligamento, reprocessamento manual e status de falha. Campus ausente: normalizar instituição/município, consultar base existente e produzir proposta com evidência, sem inclusão silenciosa. Informes pelo e-mail autorizado.

**Aceite:** casos fictícios por categoria, retomada e reexecução sem duplicação; diagnóstico inconclusivo quando faltar evidência; resposta externa depende da aprovação humana. Estimativa: 1–2 dias.

### Etapa 3 — Transacional, conversas e editor

Criar mensagem estável, tentativas por provedor e eventos correlacionados; separar aceito pelo provedor, entregue, devolvido, aberto e clicado. Arquivar versões futuras de assunto/corpo/anexos conforme política definida. Lista e detalhe com prévia gráfica isolada, bloqueio de scripts/rastreadores e edição só de rascunho/nova mensagem. Importar metadados antigos, marcando conteúdo indisponível.

Adicionar threads, recebimento autenticado do provedor, deduplicação de entradas, anexos controlados e editor Markdown/HTML sanitizado com texto alternativo. A Ponte do dono continua distinta das mensagens de participantes. Não presumir que o encaminhamento existente dá acesso à caixa Proton ou a todos os corpos históricos.

**Aceite:** responder e receber no mesmo caso, HTML seguro, permissões, identidade do remetente, outbox e recuperação de falhas. Estimativa: 2–3 dias; webhook/domínio do provedor é dependência externa.

### Etapa 4 — Edição e exclusão recuperável

Listar campos editáveis por entidade e nível; componente de ações por linha com Editar, Salvar, Cancelar e Excluir quando aplicável. Histórico antes/depois, validação do backend e concorrência por versão. Exclusão com modal, confirmação da senha, permissão e prova de intenção vinculada ao registro; arquivamento recuperável, sem DELETE físico automático. Preservar ID, inscrição, criação/consentimento/confirmação e documentos publicados. CPF, identidade e mudanças de categoria usam fluxos específicos e compatíveis com a revisão local.

**Aceite:** nenhuma escrita arbitrária de coluna; nenhuma perda de histórico; conflitos e alterações simultâneas tratados; listas/PDFs/contagens coerentes. Estimativa: 1–2 dias, ajustável à quantidade de entidades.

### Etapa 5 — IAs preservadas e base comum

Manter uma base de conhecimento e três funções: assistente do painel, geração de divulgação e atendimento de e-mails. Podem compartilhar infraestrutura; a função de e-mail não substitui as demais. Seleção configurável de provedor/modelo/esforço, sem presumir disponíveis os modelos citados no plano antigo. Começar com ferramentas de leitura e minutas, dados mascarados, fontes rastreáveis, aprovação humana para envio e limites de custo. Histórico de decisões alimenta conhecimento após curadoria; texto de mensagens não recebe autoridade para executar comandos.

**Aceite:** fonte das respostas verificável; nenhum envio ou alteração decidido pelo modelo; degradação segura sem credencial/serviço. Estimativa: 2–4 dias para primeira versão utilizável; indexação ampla e avaliação contínua são trabalho adicional.

### Etapa 6 — Assinatura dos lotes e documento final

Adicionar portal no padrão v2 com documento, versão, resumo/hash, responsável, método, estado e resultado da validação. Separar assinatura própria do app, upload ICP validado e integração/fluxo gov.br. Reutilizar `batches.ts`, `pdf.ts`, `signed-pdf.ts` e códigos de verificação; definir o fluxo do presidente e documento final antes de publicar. Arquivar bytes assinados de forma imutável e versionar correções. A disponibilidade de integração gov.br e os requisitos de aceitação precisam ser verificados na documentação oficial e com o responsável; não há implementação pronta no repositório.

**Aceite:** fluxo real comprovado por método, revisão da guarda de envio coerente com a política aprovada, layout e verificação dos PDFs preservados. Estimativa: 1–3 dias para fluxo local/upload; integrações/certificados externos podem ampliar o prazo.

### Etapa 7 — Validação cumulativa e publicação controlada

Por etapa: commit, testes unitários/de integração no banco fictício isolado, tipos, build e QA das telas alteradas. Matriz de desktop/mobile: 320, 390, 768, 992, 1280 e 1920 px; níveis Leitura/Edição/Exclusão/Total, teclado, foco, contraste, mapas, filtros, tabelas, erros de rede e preservação de dados. Separar provas de backend real das de mocks visuais.

Regressão pública inclui servidor/apoiador, nome/CPF, cache 30 dias, desafio de identidade, confirmação antiga, deduplicação, falha de rede, fila e ausência de envios indevidos. Nenhum teste com destinatários governamentais ou proibidos. Ensaio de migração e rollback de código sem sobrescrever novas assinaturas. Manifesto identifica o candidato final; backup fresco; publicação após autorização específica e conferência interna/externa. HTTP 403 da VPS via Cloudflare exige checagem externa, não prova de sucesso isolada.

Entregar primeiro admin integrado e validado, depois módulos adicionais por releases. A estimativa total é **aproximadamente 8–16 dias úteis de trabalho**, com entregas intermediárias; não é prazo garantido e depende de credenciais, decisões sobre edição/assinatura e resultados dos testes. O visual/admin existente pode chegar à revisão antes dos módulos novos, em cerca de 1–2 dias após início da integração.

## 8. Decisões e dependências a resolver na execução

1. Identificar a tela exata do título centralizado dentro de retângulo, pedido final não atendido pelo Claude.
2. Definir o fluxo de correção de CPF sem contrariar a preservação dos hashes/evidências originais e a deduplicação.
3. Confirmar quais entidades/campos admitem edição ou arquivamento; não oferecer edição de SQL/auditoria por célula.
4. Estabelecer retenção/acesso para conteúdo de mensagens, anexos e links sensíveis; metadados existentes não recuperam conteúdo inexistente.
5. Confirmar provedor de entrada de e-mail e os acessos externos necessários; conferir modelos disponíveis quando chegar à etapa IA.
6. Definir a política de assinatura e envio por método, certificado do responsável e integração gov.br viável. Não desativar a guarda ICP no escopo desta auditoria.

Esses pontos não impedem iniciar checkpoint, integração do admin existente e correções confirmadas. Alterações de avisos ao público continuam dependendo da revisão do responsável; a auditoria não altera os textos existentes.

## 9. Próxima ação recomendada

Executar Etapas 0 e 1 primeiro, apresentar o admin-v2 integrado em ambiente local isolado com a estética preservada e relatório de validação; depois seguir triagem, painel transacional e edição. Manter IAs e assinaturas na matriz de continuidade, sem declarar esses módulos concluídos antes das evidências.

O envio deste plano por e-mail conclui a auditoria solicitada. Não constitui deploy nem início automático das implementações descritas.
