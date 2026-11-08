# Prévia essencial com dados da produção

## Escopo aprovado

Cópia independente da versão essencial `94c9cc0`, executada localmente em contêineres com banco próprio. Recebe dados por SSH somente para leitura, sem modificar o aplicativo, a configuração ou os registros da VPS. Não autoriza deploy nem merge em produção.

## Etapas e critérios

1. Preservar os candidatos anteriores e registrar esta tarefa no Vigia.
2. Bloquear mutações, inicialização automática do banco, rotinas de envio e consultas externas. Usar papel PostgreSQL com leitura somente para os dados espelhados.
3. Implementar exportação consistente e importação atômica. Sincronizar a cada 30 segundos, incluindo alterações e exclusões; manter a última cópia íntegra em caso de falha. Não transferir credenciais, sessões, tokens válidos nem o cache de identidade.
4. Preparar contêineres isolados, autenticação própria e armazenamento privado. Nenhuma chave de produção deve entrar no contêiner.
5. Testar isolamento, importações, falhas, autenticação, consultas e compatibilidade cumulativa. Validar o painel em desktop e celular.
6. Publicar a mesma instância em `127.0.0.1:3031` e na porta privada 9443 da Tailnet. Manter a produção intacta e notificar o dono por e-mail HTML.

## Interface autorizada

Preservar a aparência da versão essencial. Indicadores aprovados: “Prévia com dados da produção — somente leitura”, “Última atualização” e “Sincronização indisponível”.

## Estado

Implementação em andamento. A presença destes arquivos não significa que o espelho esteja operacional. A proteção HTTP complementa, mas não substitui, permissões do banco, bloqueio de rede e autenticação externa à aplicação.
