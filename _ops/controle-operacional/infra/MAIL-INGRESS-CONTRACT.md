# Recepção e revisão de e-mail

Fontes:

- `/mnt/apps/peticao-final/_ops/controle-operacional/infra/mailersend_ingress.py`
- `/mnt/apps/peticao-final/_ops/controle-operacional/infra/inbound_processor.py`
- `/mnt/apps/peticao-final/_ops/controle-operacional/infra/ops_service.py`

O ingresso recebe exclusivamente POST `/mailersend/inbound`, em loopback,
atrás do proxy HTTPS externo mínimo. Nenhuma rota de console, terminal ou
Codex é publicada por esse proxy.

O header `Signature` é HMAC-SHA256 dos bytes originais, com o segredo individual
da rota. O serviço confere também inbound_id, data.id e destinatários do envelope
rcptTo contra configuração administrativa fixa. Não autentica pelo header To,
Reply-To ou From. Limite padrão de corpo: 256KiB. Recusa compressão, chunked,
Content-Length duplicado e solicitações ambíguas.

O ping `webhook.test` usa a chave pública de teste documentada pelo fornecedor,
somente com seu schema exato. Não é uma credencial Owner nem gera pedidos.
Nunca autoriza inbound.message. Seu armazenamento e sua quota são separados.
Sem segredo/configuração real, a mensagem real recebe503.

Antes202, corpo, assinatura e recibo são gravados com fsync e rename no spool
durável. Mesmo ID com bytes diferentes é conflito. Retry idêntico consulta o
registro e revalida durabilidade. Os originais permanecem no spool para dedup;
não mover/apagar automaticamente após processamento.

O processo privado revalida assinatura e pareamento com sua própria cópia
protegida do segredo. Extrai somente texto simples, remove formatos reconhecidos
de citação e ignora HTML/anexos. Não é possível garantir reconhecimento de todos
os formatos de resposta: por isso o texto resultante sempre exige revisão
explícita Owner, com hash congelado, autenticação recente e CSRF/Origin.

Prefixos do assunto: `[Admin-v2]`, `[homepage]`, `[GERAL]`, `[STATUS]`, `[LISTAR]`.
Aliases anteriores permanecem compatíveis. GERAL precisa de plano explícito
coordenado e filhos rastreados; não significa enviar o mesmo comando às duas
sessões. A execução global real permanece pendente enquanto esse contrato não
estiver integrado e qualificado.

Somente operator-78ffa47eeb@example.invalid` recebe códigos e respostas. O transporte não
segue redirecionamentos nem repete envios incertos. HTTP202 com recibo comprova
aceite pelo provedor, não entrega à caixa postal. Outbox sending/uncertain não
retorna automaticamente à fila.

Usuários de serviço separados: ops-ingress não tem chaves Owner/API; ops-control
não escreve no spool de recepção. Grupo privado ops-mail permite somente a
leitura necessária do spool. Segredos0600 por usuário; dirs0750/arquivos0640 no
spool compartilhado; nenhum acesso para outros usuários.

Serviço persistente supervisionado e fila durável não garantem disponibilidade
contínua do modelo. Gateway e deploy reais continuam desabilitados até sua
qualificação. Instalação exige commit/testes/manifesto e ACK no protocolo único.

Referências oficiais consultadas:

- https://developers.mailersend.com/api/v1/email/inbound
- https://developers.mailersend.com/api/v1/account/webhooks
