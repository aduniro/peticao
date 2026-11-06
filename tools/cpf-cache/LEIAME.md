# Cache de CPF — publicado em 06/11/2026

Publicação autorizada pelo usuário e concluída em 06/11/2026. Foram importados
6.215 retornos históricos válidos, sem novas chamadas à API. A verificação
posterior decifrou todas as entradas, conferiu os quatro campos e o prazo,
confirmou a preservação do pepper e da configuração carregada pelo processo.
Textos e interface permaneceram iguais à versão anterior.

Backup e registros da publicação na VPS:
`/root/peticao-recovery/cache-deploys/cache-20261106T113425Z/`.
Relatórios locais: `/mnt/dev/peticao/.cache/cpf-cache-candidate/deployment-*.json`.

A primeira tentativa retornou HTTP 500 porque a tabela criada pelo usuário
administrativo precisava pertencer a `peticao`. O deploy restaurou a versão
anterior automaticamente; a propriedade foi corrigida e a segunda publicação
passou. A versão anterior, o dump e os logs foram preservados. Os backups de
configuração com segredos permaneceram exclusivamente na VPS, sob root.

O cache persistente guarda **nome, nascimento, nome da mãe e sexo retornados
pela CPF-Brasil**, criptografados com AES-256-GCM. A busca usa somente o HMAC do
CPF; o número do CPF não fica em claro nessa tabela. Não guarda os valores
digitados na janela de identidade nem memoriza seu veredito de aceitação.

O prazo é de 30 dias da consulta original, sem renovação a cada leitura. O
agendador autenticado `/api/cron/fila` elimina vencidos. Não encontrado e erros
do provedor não são armazenados como recusas. Cada envio compara novamente o
nome ou a informação de identidade; cinco erros por CPF em 24 horas continuam
valendo. Assinaturas pendentes continuam exigindo confirmação por e-mail ou
WhatsApp, inclusive quando o formulário é refeito.

## Procedimento de publicação

1. Conferir se o código de produção continua igual à base do candidato e fazer
   novo backup. Publicar somente o ajuste de cache, preservando o painel atual.
2. Criar uma chave exclusiva `CPF_CACHE_ENCRYPTION_KEY` (mínimo 32 caracteres)
   dentro da VPS, sem imprimir seu valor. Ela não substitui `HASH_PEPPER` nem
   `DATA_ENCRYPTION_KEY`. Preservar a chave em backups restritos de configuração.
3. A migração aditiva cria `cpf_lookup_cache`, com hash, conteúdo cifrado e
   horários, e atribui sua propriedade ao usuário `peticao`. Nenhuma coluna de
   `signatures` é modificada por essa migração.
4. Reaproveitar os retornos históricos com `seed-cache.mjs`, primeiro em
   simulação e depois com `--apply`. O comando deve rodar como root na VPS com
   as variáveis carregadas internamente, nunca copiadas para este computador.
5. Validar HTTP, limpeza de vencidos e contagens de cache. Preservar os arquivos
   da versão anterior para reversão. O cache pode permanecer no banco se o
   código anterior for restaurado: a tabela é independente das assinaturas.

`seed-cache.mjs` lê o SQLite de consultas e o mapeamento dos recuperadores,
confere cada HMAC, rejeita CPF retornado divergente, ignora erros/vencidos e
mantém a data original da consulta. Importa os dois grupos (confirmadas e
pendentes), sem chamadas HTTP e sem atualizar `signatures`. Uma entrada mais
nova do cache nunca é substituída por uma consulta antiga.

Não executar a importação real nem a publicação antes da autorização expressa
do usuário. Avisos, traduções, telas, README do site e textos públicos foram
preservados; mudanças futuras nessas informações exigem pergunta prévia.

## Testes

`site/src/lib/cpf-cache.test.ts` cobre criptografia, reinício, prazo exato,
concorrência, correção de dados, tentativas, erros, adulteração, expiração e
reenvio de pendentes. `seed-cache.test.mjs` cobre importação com dados fictícios.

O candidato isolado parte da cópia da produção em
`/mnt/dev/peticao/.cache/cpf-cache-candidate/site/`. Os logs de testes e build
ficam na pasta superior. O banco de teste usa porta 54339 e diretório próprio;
nenhum teste usa o PostgreSQL da VPS ou uma chave real de API.
