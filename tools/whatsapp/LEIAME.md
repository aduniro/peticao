# EXECUTOR e VIGIA por WhatsApp

Fonte local: `/mnt/dev/peticao/tools/whatsapp`.
Estado privado: `/mnt/dev/peticao/.cache/whatsapp-executor/state`.
Configuração privada: `/home/barre/.config/whatsapp-executor/config.json`.

O WAHA roda na VM `sanciona-integral` (100.115.154.25), no Compose
`/home/wa/waha/docker-compose.yml`. O número DDD61 usa a sessão `r93d07b`
como EXECUTOR; o DDD96 usa `r688b96` como VIGIA. O destino e os aliases do
responsável ficam somente na configuração privada.

## Serviços

- `/home/barre/.config/systemd/user/whatsapp-waha-tunnel.service` mantém um
  túnel SSH local `127.0.0.1:13061` para `127.0.0.1:3000` da VM, sem publicar
  a API do WAHA na internet ou na LAN.
- `/home/barre/.config/systemd/user/whatsapp-executor-vigia.service` executa
  `/mnt/dev/peticao/tools/whatsapp/bridge.py` e inicia automaticamente.
- O processamento Codex e a transcrição rodam na `dell3576-zorin`; quando
  ela está desligada, o agente não executa tarefas. O WAHA permanece na VM.
- A antiga `/etc/systemd/system/whatsapp-fila.service` da VM foi parada e
  desabilitada ao reservar os dois números para suas novas funções. Fontes,
  configuração e dados da fila foram preservados.

Consulta local:

```bash
/usr/bin/systemctl --user status whatsapp-executor-vigia.service whatsapp-waha-tunnel.service
/usr/bin/journalctl --user -u whatsapp-executor-vigia.service -n 30 --no-pager
```

## Execução

Somente o chat privado autenticado do dono é consultado. Mensagens de grupo,
outros números, mensagens enviadas pelo próprio bot e histórico anterior à
habilitação não geram tarefas. A chave da API nunca acompanha mídia de origem
externa. Não há endpoint HTTP público para submeter comandos.

Cada mensagem tem recibo único em SQLite. A fila executa um pedido por vez,
em conversa nativa persistente do Codex; o ID fica no banco privado. Os
processos já existentes de outros coordenadores não são retomados pela ponte.
O Codex usa a autenticação já existente do operador; nenhum arquivo de
autenticação foi copiado para a VM e nenhum modelo/provider foi substituído.

Texto e imagens entram na conversa Codex. Áudio é transcrito em CPU com
Whisper small, localmente, e encaminhado como transcrição. A dependência PyAV
está fixada na versão testada porque a versão19 removia um argumento usado
pelo faster-whisper1.2.1. Não foi contratado provedor de transcrição.

Comandos: `/status`, `/ajuda`, `/parar`. O último solicita SIGTERM somente ao
grupo do processo atual criado pela ponte. Resultados, stderr e eventos ficam
em diretórios privados por execução. Um reinício marca execução em andamento
como interrompida; não repete ferramentas automaticamente. Envios sem resposta
conclusiva ficam incertos; não são reenviados sem conferência.

## Relatórios

O VIGIA observa os arquivos originais `latest-report.txt` e `latest-report.html`
em `/mnt/apps/peticao-final/peticao/.cache/relatorios-periodicos-20261109/` e
envia o conteúdo completo como anexos quando surge uma versão nova após a
habilitação. Também acompanha avisos com estado accepted no outbox do monitor,
aberto somente para leitura. O fluxo e o timer de e-mail não são alterados.
Não replica períodos antigos nem trata aceite de API como entrega no aparelho.

## Cluster

Aliases: `cluster-local`, `cluster-sp`, `cluster-santiago`, `cluster-waha`.
A configuração existente foi estendida com chaves públicas distintas e
verificação estrita de host. O host da VM foi obtido pelo SSH confiável do
Proxmox antes de registrar o novo IP. Arquivos alterados têm cópias anteriores.

Preparação idempotente e testes locais:

```bash
/usr/bin/python3 /mnt/dev/peticao/tools/whatsapp/setup_mesh.py
/usr/bin/python3 -m unittest discover -s /mnt/dev/peticao/tools/whatsapp -p test_bridge.py -v
```

A instalação é feita por `/mnt/dev/peticao/tools/whatsapp/install_local.py`.
Ela obtém a chave pelo SSH autenticado e grava com modo0600 sem imprimi-la.
O arquivo de configuração existente é preservado.

## Estado de qualificação

Texto Codex, imagem Codex, transcrição local de áudio, autorização, recibos
únicos e recuperação de efeitos incertos passaram nos testes de11/11/2026UTC.
O mesh teve SSH bidirecional comprovado nos três pares com a VM. O teste do
VIGIA retornou ack2 (DEVICE), e o relatório anexado retornou ack3 (READ).
Isso não comprova um comando recebido e respondido
pelo EXECUTOR: essa qualificação depende da sessão61 novamente pareada e de
um pedido real do dono. Não considerar o serviço completamente habilitado
antes desse teste. Leitura lenta dos arquivos do relatório é isolada em outra
thread para não bloquear a consulta de mensagens e o EXECUTOR.
