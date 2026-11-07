# Vigia — versão inicial integrada

Comando: `/mnt/dev/peticao/vigia` (alias `vigia`). Ferramenta própria de terminal; o aplicativo da petição não foi republicado por esta entrega.

## Entrega

Abas de tarefas/etapas e subetapas, processos local/VPS, árvore/grafo Git e diffs, prompt por tarefa, IA local/VPS, shell local e jobs persistentes de adunir, aprovações, eventos/testes, diagnóstico técnico das assinaturas, e-mails e contexto. Tarefas e progresso ficam separados da observação de processos. Filtro de tarefas em andamento/concluídas. Planos editáveis; pesos e porcentagens declaradas, sem estimativa artificial por tempo decorrido. Rascunhos do prompt ficam separados por tarefa enquanto a tela está aberta; pedidos enviados e históricos são persistidos.

Coletores locais e remotos instalados em serviços próprios de usuário; alias e cópia anterior do bash_aliases preservados. Linger de adunir habilitado para processos remotos continuarem sem SSH. A revisão 8765 e suas decisões, serviços da petição, CPF/hash/datas e regras do site não foram alterados por esse monitor. A Ponte continua responsável pelo canal de e-mail; WAHA é somente adapter desativado.

Guia completo: `tools/monitor/LEIAME.md`. Contexto resumido: `tools/monitor/CONTEXTO.md`. Banco privado do monitor: `/home/barre/.local/state/peticao-monitor/monitor.sqlite` (diretório 700, banco e sidecars 600). Contratos e limites operacionais estão no guia; o monitor usa as permissões normais da conta, sem funcionar como cofre ou obter root automaticamente.

## Evidências

- **19 testes do painel**, incluindo SQLite/filas/recovery, progresso hierárquico, contexto vinculado, aprovação única/expirada, protocolo Codex simulado, entrada de shell, pausa/retomada/cancelamento, Git/diffs, editores durante atualização, teclas e seleção correta de tarefa/aprovação, replay paginado de diagnósticos e exclusão de valores pessoais.
- **8 testes do vigia-simples** e **11 testes da Ponte/HTML/histórico de e-mail**, aprovados.
- Autenticação real do Codex confirmada local e em adunir, sem imprimir email/credenciais. Um turno real local respondeu VIGIA_OK, sem ferramentas, comandos ou leitura de arquivos.
- Job real e inofensivo da VPS completou após fechar o SSH lançador; segundo start com o mesmo ID não repetiu o comando.
- Fila real do serviço local executou `printf` fictício, retornou 0 e produziu a saída esperada. E-mails de início/término foram aceitos pelo provedor e registrados; aceite não é prova de entrega.
- Diagnósticos reais importados por PostgreSQL READ ONLY, com cursor e replay: disponíveis, sem backlog na conferência. Somente campos técnicos passam para o monitor; valores cadastrais/contatos não são selecionados ou persistidos.
- Cinco vistas exportadas da interface com estado real, três rasterizadas sem fontes externas; tela principal inspecionada. Terminal PTY real abriu/encerrou com Ctrl+Q em 120×40 e 80×24; o coletor permaneceu ativo após fechar a tela.

Evidências locais: `.cache/vigia-qa/{shutdown-release.log,simple-release-final.log,ponte-release.log,ai-smoke.json,remote-ai-auth.json,remote-smoke.json,broker-live.json,diagnostic-live.json,pty-result.json}` e capturas. Não versionar bancos, históricos ou logs de runtime.

Durante a validação foram corrigidos vínculo de contexto/seleção por teclado, associação segura de aprovações, fechamento da tela em disputa com timer, retomada idempotente, offsets de saída remota e falsa detecção de CPF dentro de hashes Git. A falha do harness que consultava um modal na tela base foi corrigida como problema do próprio teste. A primeira rasterização esperou fontes externas; a inspeção final usou renderização local sem essa dependência.

## Limites que não devem ser apresentados como recursos concluídos

Não há conexão automática a todo este chat nem leitura de pensamento/estado interno dos agentes. Agentes precisam registrar etapas/contexto; alterações de arquivos e processos são fontes observadas separadamente. Sem total declarado, a porcentagem fica desconhecida; ETA não é garantia. Forks de hospedagem externa não são consultados sem conector. Valores pessoais dos formulários não fazem parte do diagnóstico técnico. Notificações locais retomam quando o computador retorna; coleta e jobs persistentes da VPS continuam no servidor. WhatsApp não foi instalado ou ativado.

O admin-v2 permanece separado e incompleto, registrado na fila do monitor. A conclusão desta versão do Vigia não constitui conclusão ou deploy do admin-v2.
