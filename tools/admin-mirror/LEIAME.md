# Espelho local somente leitura

Executar a partir de `/mnt/dev/peticao/.cache/admin-integration/candidate-essential-live`. O aplicativo publicado na VPS não é modificado por estas ferramentas.

## Operação

- `systemctl --user status peticao-admin-mirror-sync.service`: receptor persistente; lê a VPS a cada 30 segundos e importa apenas no banco local.
- `systemctl --user status peticao-admin-mirror-web.service`: encaminhamento local para o contêiner isolado.
- `docker ps --filter name=peticao-admin-mirror`: estado dos contêineres. `peticao-admin-mirror-qa` é exclusivamente para testes fictícios.
- `tailscale serve status`: verificar a porta 9443 privada da Tailnet. Não habilitar Funnel para essa porta.
- `cat /home/barre/.local/share/peticao-admin-mirror/sync-status.json`: fase e duração, sem dados pessoais.
- `cat /home/barre/.local/share/peticao-admin-mirror/import-status.json`: revisão publicada e horário local.

Estado privado em `/home/barre/.local/share/peticao-admin-mirror/`, diretório 700 e arquivos 600. Não imprimir `app.env`, `local-config.json`, chaves, capturas nem banco de autenticação. A senha é independente da produção; seu hash scrypt fica em `auth/access.sqlite`.

## Proteções e falhas

O exportador executa no servidor via entrada padrão do SSH e abre uma transação PostgreSQL consistente somente leitura. O contrato local limita tabelas/colunas. O receptor verifica contagens, checksums, identidade e datas antes da publicação atômica. Uma interrupção não substitui o estado publicado. Não executar SQL de correção na origem.

O aplicativo usa rede Docker interna e papel local restrito, sem credenciais da VPS. A saída para internet está bloqueada; consultas a APIs, envios, cron e mutações não são permitidos. PDFs são conferidos pelo hash e armazenados por conteúdo. A auditoria de navegação tem tabela local separada. Os índices de consulta são criados apenas no banco local.

Na falha de um serviço, consultar primeiro seu journal. Restaurar a versão local anterior apenas com seu contêiner e estado preservados; nunca usar o banco de testes para a prévia real. A limpeza conserva os dois schemas retirados mais recentes, três capturas e arquivos recentes; não promete snapshots históricos completos e não toca na revisão de CPFs.

## Testes

`python3 tools/admin-mirror/gateway_test.py` verifica senha, sessão, origem e logout. `node --test tools/admin-mirror/*.test.mjs` verifica protocolo, contratos e arquivos; para incluir o teste integrado, fornecer `MIRROR_QA_DATABASE_URL` exclusivamente para o banco local fictício `mirror_qa`. O teste recusa qualquer outro destino e limpa apenas schemas de teste.

O plano e as evidências estão em `docs/PLANO-ADMIN-ESPELHO.md`. Nenhum comando desta documentação constitui autorização para deploy ou merge de produção.
