# Entrada de mensagens: backend autenticado e persistente

Marco local isolado sobre50e144d, sem ativar provedor, copiar caixa histórica ou misturar a Ponte do dono. A interface de caixa de entrada, anexos e configuração permanece pendente. Nenhuma confirmação de identidade ou execução de pedido decorre do recebimento.

## Protocolo próprio de relay v1

POST `/api/mail/inbound` fica404 por padrão. Exige habilitação explícita, conta e destinatários fixos e segredo de pelo menos32 bytes, fornecido pelos mecanismos existentes. A caixa operator-78ffa47eeb@example.invalid` é recusada como destino para preservar a Ponte. Não há uso automático da conta Proton nem instalação/ativação de Worker.

Headers `x-peticao-timestamp` (epoch em segundos) e `x-peticao-signature` (`sha256=`+hex minúsculo) autenticam HMAC-SHA256 sobre timestampASCII+`.`+bytesUTF8 exatos. Janela5min não substitui deduplicação durável. A autenticação comprova o relay configurado, não a identidade humana do remetente. O relay deve entregar os destinatários reais do envelope em `to`, não inferi-los do cabeçalho To.

JSON estrito: account, externalId, messageId, inReplyTo, references, from, to, subject, text, html, attachments, receivedAt. Identidade externa e receivedAt originais devem permanecer estáveis nas reentregas. receivedAt é ISOUTC canônico. Endereços são normalizados sem remover pontos; IDs de conversa não são inferidos de nomes. Limites: corpo2MiB; texto/HTML256KiB cada; assunto2KiB; até4 anexos,512KiB cada e1MiB total. Anexos usam name/contentType/base64 canônico; nada é extraído/executado/renderizado.

## Persistência e retenção

`mail_inbound_messages` guarda ciphertext com AES-GCM/contexto do ID; endereços, assunto, corpo, anexos e identificadores originais ficam cifrados. Metadados de busca/correlação usam HMAC com domínio próprio, preservando o HASH_PEPPER existente. Admissão e auditoria são atômicas; erro retorna503, sem reconhecer mensagem que não foi confirmada.

Conta+identidade externa deduplicam sob lock; mesma identidade com conteúdo diferente resulta409. Reentrega não renova a retenção de30dias nem restaura conteúdo expurgado. Correlação só usa In-Reply-To único, mesma conta/remetente/destinatários; ambiguidade ou só References cria conversa separada. Isso organiza conversas, não autentica identidade.

Leitura interna do corpo exige conta Edição atual, sessão e confirmação extra; expiração oculta o corpo antes do cron. O expurgo integra a transação já existente de retenção sem mudar seu retorno legado; recibos/hashes permanecem para deduplicação. Nenhum envio, IA, subprocesso, correção de assinatura ou promoção de revisão local ocorre.

## Evidências

37/37 testes dirigidos/integrados com PostgreSQL fictício passaram em `/tmp/admin-mail-history-iftt5giy`. Incluem handlers NextRequest reais, HMAC/BOM, bytes de stream, 404/401/413/409/503, concorrência, rollback, expiração, papéis e regressões dos arquivos/rascunhos antigos. Tipos globais do candidato isolado:0. Ensaio aditivo16 tabelas (15base+entrada) passou em `/tmp/admin-mail-history-4sqkcwy6`, incluindo ciphertext, hashes, thread e microssegundos preservados após replay/bootstrap antigo.

Primeira rodada falhou na senha fictícia que repetia o identificador do usuário; trocada apenas a fixture. Primeiro ensaio do runner de schema omitiu o loaderTS; corrigido o runner e repetido em banco novo. Uma inferência de UUID TypeScript foi anotada como string. Evidências anteriores preservadas; nenhuma alteração em guardas públicas para fazer testes passarem.

Ferramenta local: `python3 tools/admin-qa/inbound-local.py inbound-unit` (também inbound-schema/inbound-types). Usa caminho/portas fixos isolados, configuração vazia e provedordev. Validação HTTP de build compilado, frontend, provedor real e união com o esquema principal ainda pendem; este marco não declara a caixa de entrada completa. Ao integrar, unir listas/asserts aditivos de outras frentes sem descartar provas e repetir migração consolidada.
