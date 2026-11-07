# Contexto do Vigia

O proprietário é a ADUNIR e as notificações são exclusivamente para operator-78ffa47eeb@example.invalid`, em HTML. Informar início, retomada, interrupção e término; consolidar andamento a cada 30 minutos. Aceite de provedor não comprova entrega. O canal WhatsApp/WAHA está desativado; existe somente contrato de extensão.

Esta ferramenta monitora a petição sem alterar o aplicativo por conta própria. Código principal: `/mnt/dev/peticao`. Admin-v2 isolado: `/mnt/dev/peticao/.cache/admin-integration/candidate-stage01` (último checkpoint aa29ea6 e WIP de resiliência em PendentesTable). Não publicar esse checkout integralmente. Produção está na VPS em `/opt/peticao/app`, stage em `/home/adunir/peticao-stage/site`. Os logs de diagnóstico e ajustes de foco/textos/filtros já publicados têm relatórios próprios em docs/.

A revisão de CPFs é local: `http://127.0.0.1:8765/`, também acessível pelo gateway Tailscale, usando `/mnt/dev/cpfs/revisao/revisao.sqlite`. Aprovações de CPF e de nome são independentes. Nunca sobrescrever essas decisões, hashes, datas ou inscrições; nunca promover decisões locais automaticamente para a VPS. A revisão recebe dados por pipe somente leitura. Filtros/editor foram corrigidos em af44aac/53a057b/f61e7ff.

Regras obrigatórias: ler AGENTS.md; preservar alterações existentes; commits por etapa; dados fictícios e entrega dev nos testes; não enviar mensagens a assinantes ou autoridades; não ler/revelar `.env`, `secrets/`, `preview-state/`, cofres ou chaves SSH; nunca mudar HASH_PEPPER. Não alterar estética, avisos, privacidade ou validações fora da solicitação. Deploy de admin-v2 depende de autorização final específica.

Este resumo não é todo o histórico do chat. Cada tarefa tem sua própria conversa Codex. Histórico, etapas e execuções ficam no SQLite privado do monitor. O processo do chat externo não pode ser observado como se fosse um subprocesso local: atualizações do agente são declaradas; processos, serviços e alterações de arquivos são evidência observada separadamente. Ausência de atualização não comprova que uma tarefa parou.
