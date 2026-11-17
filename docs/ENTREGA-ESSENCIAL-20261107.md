# Admin-v2 — entrega essencial

Escopo selecionado pelo dono em 07/11/2026: versão essencial hoje e demais módulos em etapas seguintes. A meta é um candidato local revisável, condicionado aos testes, e não promessa de publicação automática.

## Incluído nesta entrega

- Estética verde escura e navegação admin-v2 existentes, desktop e celular.
- Sessões, níveis de acesso, permissões e controles administrativos já implementados.
- Consulta de assinaturas, filtros, pendências e correção de e-mail protegida contra concorrência e falha de rede.
- Compatibilidade com os diagnósticos de cadastro e com as interações dos formulários efetivamente publicados na VPS em 07/11.
- Testes cumulativos, tipos, build, ensaio de migração aditiva e QA dos fluxos afetados.

## Próximas entregas

Curadoria ampliada, interfaces e ativação dos assistentes de IA, conversas, editor completo e fluxos adicionais de documentos continuam no plano integral. A infraestrutura parcial existente não será apresentada como funcionalidade concluída. Credenciais e provedores permanecem desativados onde não estão configurados.

## Preservação e liberação

**Não fazer deploy sem permissão explícita do dono.** Não executar migração na VPS nesta etapa. Não alterar assinaturas de produção, hashes, datas, decisões locais de CPF/nome, segredos, avisos públicos ou política de privacidade.

Candidato isolado: `/mnt/dev/peticao/.cache/admin-integration/candidate-stage01`. Fonte atual capturada somente para leitura: `.cache/admin-integration/production-resume-20261107T2017/`, com 680 arquivos sanitizados. Dezessete arquivos das publicações recentes conferidos por SHA-256 antes de importar; a rota administrativa de diagnóstico adapta somente a autorização para `exigirNivel(req, "edicao")`, preservando contrato/paginação e ausência de cache. A integração precisa passar pelos testes antes de ser considerada pronta.

## Validação observada

- 471/471 testes cumulativos aprovados, sem ignorados, com quatro arquivos concorrentes; `essential-resume-cumulative-controlled.log`. Uma expectativa antiga do menu foi atualizada; a execução concorrente com build teve contenção de lock no teste de IA. A rodada controlada passou sem alterar locks/timeouts do aplicativo.
- Build e tipos: `essential-browser-build.log` e `essential-browser-typecheck-serial.log`; aprovados. O mesmo artefato foi reutilizado após ajustes somente nos roteiros/ambiente de QA.
- Migração: `essential-browser-schema.log`; preserva esquema original, assinaturas fictícias, fila/históricos e tabela de diagnóstico publicada, inclusive microssegundos, expiração, cifra fictícia e índices.
- Pendentes: seis larguras, falha de rede, rascunho/seleção, salvamento posterior real na API local, bloqueio de cliques duplicados, sem envio.
- Diagnóstico: seis larguras, paginação, contato oculto/solicitado, leitor recusado e nenhuma mutação HTTP do navegador. Exibição cifrada exige a chave fictícia no QA em modo produção; uma pré-condição impede repetir o teste sem ela.
- Navegação: primeira passagem em 100 combinações (20 rotas, quatro níveis; Total também no celular) aprovada, preservando os assinantes fictícios e sem mensagens/fila novas. A conferência visual levou ao reforço do roteiro: esperar dados carregados e mapa, além de HTTP200, para não aceitar imagem ainda em carregamento. O resultado dessa passagem reforçada deve ser registrado antes da liberação do candidato.

Capturas e relatórios estão em `.cache/admin-audit-20261106/`. Esses resultados não comprovam entrega de e-mail, disponibilidade de provedor externo, funcionamento de IA real ou publicação na VPS. Nada foi instalado, reiniciado ou migrado em produção por esta etapa.

### Encerramento da rodada reforçada

Passaram **100/100 cenários de navegação**, incluindo44 verificações de dados efetivamente carregados nos painéis/mapas/listas. Nenhum HTTP de API com erro, exceção de página, POST do navegador ou transbordamento horizontal foi observado. Assinaturas fictícias preservadas e nenhuma mensagem/fila criada. Prévia3031 restaurada no banco/configuração fictícios originais, com HTTP200. A conferência adicional do painel carregado confirmou mapa e APIs de painel/dashboard/explorador/alertas com200. Evidências: `runtime-essential-browser-dataready-20261107/essential-smoke.json`, `essential-browser-dataready-supervisor.log` e `essential-preview-live-1280.png`.

**Limitação de escopo:** esta entrega preserva o backend nome/CPF efetivamente publicado. Não integra o resolvedor do nome oficial aos PDFs, não promove decisões da revisão local e não incorpora o fluxo local de recuperação de confirmação antiga. Essas pendências foram identificadas na auditoria de políticas solicitada pelo dono e precisam de release próprio. O deploy desta entrega essencial permanece sem autorização.
