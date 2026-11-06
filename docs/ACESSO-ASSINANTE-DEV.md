# Acesso do assinante — implementação em desenvolvimento

Esta implementação é separada do painel administrativo e dos tokens de cartaz/QR.
Permanece **desabilitada por padrão**: `SUBSCRIBER_ACCESS_ENABLED=1` habilita a página
`/minha-assinatura` e `/api/assinante/*` somente no ambiente em que for configurada.
Nenhuma publicação decorre da criação dos arquivos. Não altera os avisos existentes.

## Credenciais e sessão

O primeiro pedido usa exclusivamente o e-mail já vinculado a uma assinatura
confirmada por e-mail. Assinaturas pendentes e confirmações apenas por WhatsApp não
recebem credenciais por um endereço cuja confirmação não esteja comprovada.
A resposta pública é neutra; não revela participação nem afirma envio concluído.

Uma senha aleatória de 16 caracteres é enviada ao endereço registrado. Somente o
hash scrypt é persistido. A senha ativa não vence e sua troca é opcional. Repetir o
pedido inicial nunca substitui uma credencial ativa. A URL de acesso é fixa e não
contém senha. Login aceita e-mail+senha ou nome+CPF+mesma senha. O nome atual e o
nome original capturado ao emitir a credencial são aceitos normalizados; um nome
cadastral também pode ser comparado se já existir no cache. Isso não consulta a API.
O desaparecimento do cache não invalida nome original+credencial correta.
Nomes aprovados apenas no SQLite local não são enviados à VPS por este recurso.

A sessão tem 30 minutos, cookie dedicado `HttpOnly`, `SameSite=Strict` e `Secure` em
produção. Escritas exigem autenticação nos últimos dez minutos. IDs enviados pelo
navegador não autorizam acesso a outra assinatura. Todos os POST exigem `Origin`
igual à origem canônica de `APP_URL`; o corpo é limitado durante a leitura a 8 KiB.
Os limites de IP e identificador persistem no PostgreSQL, guardando HMACs.
A credencial é vinculada ao e-mail/CPF e à confirmação de origem. Mudança administrativa
desses dados invalida senhas/sessões antigas. O novo canal não recebe acesso automático:
é necessária recuperação assistida e revogação explícita da credencial anterior.
Credenciais de uma versão de desenvolvimento sem essa vinculação também falham fechadas;
não se infere retroativamente quem era o titular.

## Recuperação e alterações

A recuperação envia ao endereço confirmado uma autorização aleatória, de uso único,
válida por 30 minutos, específica para redefinir senha. A URL usa fragmento; GET não
consome a autorização. A escolha exige duas senhas iguais, de 15 a 200 caracteres;
frases, espaços e colagem são permitidos, sem composição ou troca periódica.
A senha anterior continua válida até concluir. Redefinir ou alterar senha revoga as
sessões e autorizações anteriores atomicamente. A autorização é vinculada à versão
da credencial e ao canal cadastrado; troca administrativa de e-mail a invalida.

Categoria e seus campos profissionais/geográficos podem ser propostos após login.
São validados pelas mesmas regras geográficas do formulário. O validador interno
recebe o CPF **em hash da linha autenticada**, sem reconstruir seu número; o
validador público continua exigindo CPF e ignora qualquer tentativa de bypass no
corpo. O e-mail de confirmação mostra antes/depois dos valores exatos. Aplicar a
mudança exige sessão recente, autorização de uso único e revisão de origem intacta.

São preservados ID, inscrição, CPF/hash, nome, e-mail, criação, consentimento e
confirmação originais. Os nomes da revisão local continuam independentes. Alterar
nome/e-mail/CPF ou converter cadastro brasileiro em estrangeiro exige atendimento.
Apoiador pode corrigir categoria para servidor com e-mail pessoal confirmado; isso
não concede confirmação de vínculo institucional. WhatsApp permanece fora deste
acesso enquanto não houver configuração e canal previamente confirmado.

## Entregas e limites operacionais

Nenhuma chamada de e-mail permanece dentro de transação ou segurando conexão do
banco. Reservas aditivas guardam apenas hash da senha, revisão e lease de dez
minutos. A credencial é ativada somente após entrega bem-sucedida e nova conferência
da reserva e da assinatura. Falhas e pedidos concorrentes não alteram senha ativa.

O despacho usa até quatro envios em andamento e 32 trabalhos em memória. O prazo
de 30 segundos invalida a autorização/reserva de entrega; como nem todo provedor
permite cancelamento, a vaga permanece ocupada até a chamada de rede terminar.
Assim, um provedor travado não gera chamadas órfãs ilimitadas nem esgota o pool do
aplicativo. Os pedidos HTTP não aguardam o SMTP. Retornos tardios após timeout não
ativam a senha reservada. A fila não é durável e não armazena mensagens em claro.

**Reiniciar o processo perde entregas ainda em memória.** Não revoga senhas ativas;
um primeiro acesso ainda não entregue pode ser solicitado novamente após o lease.
Uma recuperação pode ser solicitada novamente dentro dos limites. A robustez desta
opção não equivale a uma fila durável de entrega garantida. Para tanto seria preciso
um cofre/chave exclusiva e fila cifrada, fora desta implementação.

O transporte padrão usa `queue:false` e recusa o provedor `dev`, pois ele gravaria
senhas/tokens em arquivos de saída. Testes injetam um transporte fictício em memória.
Uma validação de entrega real requer configuração separada e destinatários de teste
autorizados; não foi executada para esta etapa.

## Retenção e validação

`purgeSubscriberAccess()` remove sessões vencidas, tokens usados/vencidos, reservas
encerradas, limites com mais de 24 horas e eventos de segurança com mais de 30 dias.
Pode rodar com o recurso desligado; consulta existência das tabelas e não as cria.
Mantém a credencial ativa e o evento `signature_changed` com antes/depois para
proveniência. A integração ao cron deve chamar essa função no fluxo de manutenção.

Teste isolado, sem o banco principal de desenvolvimento:

```sh
cd /mnt/dev/peticao/site
DEV_DB_PORT=54335 DEV_DB_DIR=/mnt/dev/peticao/.cache/subscriber-db node scripts/with-db.mjs ./node_modules/.bin/tsx --test src/lib/subscriber-access.test.ts
```

Os 26 casos cobrem emissão concorrente, falhas/timeout, limite de quatro provedores,
pool disponível, original sem cache, cookie/CSRF, streaming, redefinição concorrente,
canal alterado, propósito/expiração/reuso, imutabilidade e revisão da correção,
bypass do formulário, geografia, retenção e limites persistentes.
