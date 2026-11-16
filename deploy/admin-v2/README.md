# Admin-v2 separado da aplicação pública

Este diretório prepara a nova instância; não altera nem publica serviços por si só.
O domínio principal e seu `/admin` continuam no `peticao.service` atual.
O subdomínio administrativo aponta para um processo próprio, na porta loopback 3001.

Produzir um runtime da composição final, verificar o manifesto e os hashes antes
de montar o contexto `runtime/`. Nunca incluir `.env`, banco, chaves ou dados reais.
Não reutilizar como runtime final o artefato f555 após alterar fontes.

## Perfis de runtime e qualificação

`prepare_context.py` mantém `--profile node20` como padrão. Para qualificar Node
22.23.5 isoladamente, escolher explicitamente `--profile node22`; o recibo
registra o perfil e o hash do Dockerfile. Ambos fixam a base por digest. Selecionar
um perfil prepara arquivos e não publica nem comprova a compatibilidade do app.
Verificar a versão efetiva de Node/npm, bibliotecas nativas, backend, PDF e UI
na imagem resultante antes de promover o artefato exato. Preservar a imagem20,
configuração e proveniência anteriores para rollback sem restaurar banco antigo.

Em builds, executar npm a partir de `site/` com `NPM_CONFIG_CACHE` e `TMPDIR`
apontando para diretórios criados dentro do workspace do job. Sobrescrever também
`NPM_CONFIG_TMP` evita o caminho legado de `.npmrc`; `TMPDIR` controla os processos
filhos. A configuração herdada será tratada separadamente, sem misturar mudanças
da aplicação à qualificação. Instalar pelo lock com npm10.9.9, sem atualizar dependências.

O container usa rede do host somente para acessar o PostgreSQL existente em
loopback, sem reconfigurá-lo. Não há publicação de portas e o Next escuta apenas
127.0.0.1. O processo, filesystem, imagem, limites e ciclo de release são próprios.
A rede do host não oferece isolamento de rede entre processos; não confundir isso
com a separação de recursos/processo ou com isolamento dos dados no PostgreSQL.

`APP_URL` continua público; `ADMIN_URL` identifica links do novo painel. Cookies
existentes são host-only. Conferir origens/redirects e sessão em navegador antes
da ativação. Recursos persistentes de assinatura/broker exigem qualificação e
mounts próprios antes de habilitar as respectivas funcionalidades.

Os limites iniciais de 1 CPU/1536 MiB são provisórios e exigem prova de margem
na VPS antes da ativação. Manter uma única autoridade para cron/fila/envios.
Não basta omitir um cron: os runtimes atuais drenam outbox oportunisticamente.
Não ativar v2 contra o banco real antes de qualificar DDL/bootstrap, coexistência
com o legado e propriedade das linhas da fila.

O perfil `PETICAO_RUNTIME=admin-v2` exige `MAIL_QUEUE_SCOPE=v2`: retries ficam em
`mail_outbox_v2`, com o mesmo journal durável e identidade de fila distinta.
Consultas, recuperação e limpeza do v2 usam essa fila; não há cópia ou consumo
automático da fila legada. Resultado de transporte desconhecido bloqueia replay
automático no v2; rejeição comprovada ainda admite a política normal de failover.
Os diagnósticos de pendências consultam metadados de ambas as filas em leitura,
sem expor IDs/payloads misturados; o consumidor continua exclusivo da fila v2.
O papel de runtime precisa ter SELECT na fila antiga e não pode ter privilégios
de inserção, alteração, remoção, truncate ou criação de triggers nela.
O proxy novo recusa `/api/cron` e seus descendentes. A propriedade dos lotes e
o bootstrap de implantação continuam gates separados, não resolvidos pela fila.

O v2 exige `DB_BOOTSTRAP_MODE=verify`, papel dedicado sem propriedade/DDL e
`DB_SCHEMA_SHA256` congelado após a migração revisada. A inicialização compara
catálogo, constraints, índices, triggers, funções, políticas e definições de
sequências sem ler dados de negócio nem incluir valores atuais de sequência.
Não calcula uma configuração esperada automaticamente ao subir o container.
O migrador é um processo separado (`PETICAO_RUNTIME=migration`, modo `apply`),
com os privilégios temporários aprovados. O modo legado padrão é preservado.
`/api/internal/ready` verifica o banco e responde apenas ok/503; fica bloqueado
no proxy público e é consultado por loopback pelo healthcheck.

`ADMIN_IMAGE` deve identificar uma imagem local imutável por digest SHA256;
`app.env` fica privado, no host, fora do repositório. Validar a configuração
Compose e o fragmento Caddy antes de aplicá-los. Copiar o fragmento não autoriza
substituir os blocos do domínio principal.

Publicação: gerar manifesto concreto com commit/imagem, compatibilidade de banco,
fixtures/testes, backup, retorno e destino; obter revisão independente real e
lease crítico. Verificar o novo upstream antes de ativar somente o hostname novo.
Retorno remove o encaminhamento/instância nova, preserva banco e reconcilia
intenções pendentes; nunca restaura dados antigos sobre assinaturas recentes.
