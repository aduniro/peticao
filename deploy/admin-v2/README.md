# Admin-v2 separado da aplicação pública

Este diretório prepara a nova instância; não altera nem publica serviços por si só.
O domínio principal e seu `/admin` continuam no `peticao.service` atual.
O subdomínio administrativo aponta para um processo próprio, na porta loopback 3001.

Produzir um runtime da composição final, verificar o manifesto e os hashes antes
de montar o contexto `runtime/`. Nunca incluir `.env`, banco, chaves ou dados reais.
Não reutilizar como runtime final o artefato f555 após alterar fontes.

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

`ADMIN_IMAGE` deve identificar uma imagem local imutável por digest SHA256;
`app.env` fica privado, no host, fora do repositório. Validar a configuração
Compose e o fragmento Caddy antes de aplicá-los. Copiar o fragmento não autoriza
substituir os blocos do domínio principal.

Publicação: gerar manifesto concreto com commit/imagem, compatibilidade de banco,
fixtures/testes, backup, retorno e destino; obter revisão independente real e
lease crítico. Verificar o novo upstream antes de ativar somente o hostname novo.
Retorno remove o encaminhamento/instância nova, preserva banco e reconcilia
intenções pendentes; nunca restaura dados antigos sobre assinaturas recentes.
