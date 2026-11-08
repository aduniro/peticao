# Contexto do Vigia

Decisão adicional de08/11: novos cadastros Servidor somente com domínio aprovado
como IFES; outros órgãos públicos não bastam. Recuperação do honeypot, essa política
e dois textos foram aprovados e implementados isoladamente na branch
`signup-honeypot-recovery-20261108`: implementação f4f3528, evidência f8b7368, em
`/mnt/dev/peticao/.cache/signup-honeypot-20261108/candidate`.194 testes e4 cenários
de navegador aprovados, build/types aprovados. Ainda NÃO publicado. Integrar
localmente no admin-v2 somente entre etapas, preservando mudanças existentes e
revalidando o conjunto; sem merge/deploy com VPS. Política e evidências em docs/
do candidato. Não reintroduzir o frontend antigo durante essa integração.

Continuidade persistente autorizada em08/11: seguir
`/mnt/dev/peticao/docs/VIGIA-CONTINUIDADE.md` e o checkpoint atual em
`/mnt/dev/peticao/docs/ADMIN-V2-CONTINUIDADE-SUPERVISIONADA.md`. O plano registrado
é verificável por etapa; fim de turno não significa fim de tarefa. O candidato
atual é `candidate-stage02-domains`, preservando o essencial e o espelho live.

Política central obrigatória: [prioridade e execução](../../docs/POLITICA-CENTRAL-EXECUCAO.md). **NUNCA PARAR UMA TAREFA DADA COMO PRIORITÁRIA, A NÃO SER QUE SEJA SOLICITADA A INTERRUPÇÃO.** O admin-v2 completo é a prioridade número1 até concluir o plano integral; a prévia isolada somente leitura já foi concluída e deve permanecer disponível para avaliação. Perguntas e tarefas secundárias não autorizam interrompê-lo. Após uma interrupção solicitada, retomá-lo imediatamente do checkpoint, sem aguardar novo pedido. Mostrar patches, comandos e resultados reais no chat e atualizar o Vigia. Não confundir prévia ligada ou etapa antiga com desenvolvimento efetivamente em execução. Registrar interrupções externas e impedimentos com checkpoint e estado fiel. Deploy e qualquer merge/integração de código com a VPS, em qualquer direção, exigem permissão explícita.

O proprietário é a ADUNIR e as notificações são exclusivamente para operator-78ffa47eeb@example.invalid`, em HTML. Informar início, retomada, interrupção e término; consolidar andamento a cada 30 minutos. Aceite de provedor não comprova entrega. O canal WhatsApp/WAHA está desativado; existe somente contrato de extensão.

Esta ferramenta monitora a petição sem alterar o aplicativo por conta própria. Código principal: `/mnt/dev/peticao`. Admin-v2 isolado: `/mnt/dev/peticao/.cache/admin-integration/candidate-stage01` (candidato essencial 94c9cc0: 471 testes e 100 cenários de navegador aprovados, sem deploy). Não publicar esse checkout integralmente. Produção está na VPS em `/opt/peticao/app`, stage em `/home/adunir/peticao-stage/site`. Os logs de diagnóstico e ajustes de foco/textos/filtros já publicados têm relatórios próprios em docs/.

A revisão de CPFs é local: `http://127.0.0.1:8765/`, também acessível pelo gateway Tailscale, usando `/mnt/dev/cpfs/revisao/revisao.sqlite`. Aprovações de CPF e de nome são independentes. Nunca sobrescrever essas decisões, hashes, datas ou inscrições; nunca promover decisões locais automaticamente para a VPS. A revisão recebe dados por pipe somente leitura. Filtros/editor foram corrigidos em af44aac/53a057b/f61e7ff.

Regras obrigatórias: ler AGENTS.md; preservar alterações existentes; commits por etapa; dados fictícios e entrega dev nos testes; não enviar mensagens a assinantes ou autoridades; não ler/revelar `.env`, `secrets/`, `preview-state/`, cofres ou chaves SSH; nunca mudar HASH_PEPPER. Não alterar estética, avisos, privacidade ou validações fora da solicitação. Deploy de admin-v2 depende de autorização final específica.

Este resumo não é todo o histórico do chat. Cada tarefa tem sua própria conversa Codex. Histórico, etapas e execuções ficam no SQLite privado do monitor. O processo do chat externo não pode ser observado como se fosse um subprocesso local: atualizações do agente são declaradas; processos, serviços e alterações de arquivos são evidência observada separadamente. Ausência de atualização não comprova que uma tarefa parou.

Em 07/11 o dono priorizou a versão essencial do admin-v2 para revisão hoje: visual, acesso/permissões, assinaturas, pendências e diagnósticos. Demais módulos permanecem para releases seguintes. Nenhum deploy sem permissão explícita. Não interpretar a meta de hoje como autorização de publicar nem como conclusão dos módulos futuros. Estado atual e evidências em docs/ADMIN-V2-PROGRESSO-20261106.md.

Prioridade reafirmada: retomar sempre o admin-v2 após uma tarefa temporária. Preservar o candidato essencial94c9cc0 durante a avaliação do dono e continuar módulos seguintes em checkout separado. Auditoria de publicação nominal em docs/AUDITORIA-PUBLICACAO-NOMES-CPF-20261107.md: resolvedor/PDF e confirmação antiga ainda não publicados; validação quantitativa v6 já publicada. Auditoria de estrangeiros está na fila, abaixo da continuidade do painel.
