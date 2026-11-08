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

Espelho operacional e validado em 08/11/2026. A proteção HTTP complementa permissões do banco, bloqueio de rede e autenticação externa à aplicação. Este candidato é uma prévia de leitura; não conclui o desenvolvimento integral do admin-v2.

## Checkpoint de 08/11/2026

- Guardas iniciais: commits `3f3c43b` e `52685d2`; oito testes do aplicativo e TypeScript aprovados.
- `tools/admin-mirror/snapshot.mjs`: valida contrato, tabelas, contagens, chaves e checksums antes de abrir a transação; cria uma versão local em staging e publica por troca transacional de schema. Pacotes antigos e importações com erro preservam a versão anterior.
- `bootstrap.sql`: papel de leitura com acesso aos dados espelhados e inserção exclusivamente na auditoria local de acessos.
- `postgres.test.mjs`: PostgreSQL 17 local dedicado, com dados fictícios. Verificadas inclusão, alteração, exclusão, preservação de hash/data, recusa de escrita, rollback real e rejeição de snapshot antigo. Cinco testes de protocolo e este teste integrado passaram.
- Esses itens iniciais foram concluídos nos checkpoints seguintes; o estado final e os limites estão abaixo.

## Validação final

- Contrato de 24 tabelas; exportação SSH em transação consistente `READ ONLY`, incluindo alterações e exclusões. O receptor local sincroniza a cada 30 segundos; ciclos observados próximos de quatro segundos. Falhas conservam a última publicação íntegra.
- Publicação incremental transacional, checksums de arquivos/documentos e conferência integral dos IDs, nomes, hashes e datas das assinaturas. Datas PostgreSQL conservam microssegundos. PDFs são transferidos uma vez por hash de conteúdo.
- E-mails protegidos de diagnóstico são recriptografados com chave exclusiva local. Chaves de produção, sessões, tokens utilizáveis e cache de identidade não são copiados. Senha independente protegida com scrypt no SQLite de acesso.
- Aplicação em rede Docker interna, sem saída para provedores. Banco acessado pelo aplicativo com papel de leitura; apenas a auditoria local de acesso aceita inserções. Rotas mutáveis e cron são bloqueadas. Não há montagem de SSH, cofre ou socket Docker no contêiner.
- Índices locais fixos e ausência de consultas DNS na sugestão de e-mails do espelho evitam consultas lentas sem alterar o comportamento de produção. Atualização da lista conserva os filtros selecionados.
- **480/480 testes cumulativos**, **15/15 testes do protocolo/importação/PostgreSQL/criptografia**, **4/4 testes da autenticação**, TypeScript e build aprovados. A compilação conserva um aviso anterior do autoprefixer em `v2.css`; nenhum CSS foi alterado.
- Navegador: dez telas em 1440 e 390 px, sem exceção de execução ou transbordamento horizontal; busca preservada após atualização. Login, logout, e-mails protegidos, atualidade da sincronização, checksum de PDF e recusa de escrita/cron confirmados tanto em localhost quanto em HTTPS na Tailnet.
- Evidências privadas: `/home/barre/.cache/peticao-admin-mirror-qa/20261108/`, incluindo `browser-results.json`, `final-access-results.json`, capturas e logs cumulativos datados. Dados reais e senha não são incluídos no Git.
- A mesma instância está em `http://127.0.0.1:3031/admin` e `https://dell3576-zorin.tail1a6d71.ts.net:9443/admin`, somente na Tailnet. A configuração Funnel anterior na porta 443 não foi alterada. A VPS permanece ativa, sem deploy, merge, migração ou alteração de registros.

## Limites e continuidade

O computador local precisa permanecer ligado e conectado. Não se trata de replicação instantânea: a leitura ocorre a cada 30 segundos. Funções de envio, edição e reanálise não são exercitáveis nesta cópia. A prévia não importa os dados de autenticação nem os valores do cache de identidade; algumas telas de módulos posteriores podem apresentar dados ausentes. Falhas na sincronização ficam sinalizadas pelo indicador autorizado.

Retomar a integração completa no checkout separado `candidate-stage02`, preservando esta prévia para revisão do dono. A aprovação da prévia não autoriza deploy nem merge na VPS.
