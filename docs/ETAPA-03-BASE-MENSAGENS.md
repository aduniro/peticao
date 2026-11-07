# Etapa 3 — base observada para mensagens

Leitura do candidato; implementação desta etapa ainda não iniciada. Não alterar filas públicas ou política de reenvio junto com a integração visual sem regressão própria.

- `mail/index.ts`: `sendMail` é o ponto de saída, com guardas de destinatário, supressão, prévia e canais separados. `sent` significa aceite do transporte, não entrega. `drainMailOutbox` chama o transporte diretamente; a integração de arquivo/identidade deve cobrir ambos os caminhos, preservando rotação e canal de marketing.
- `mail/log.ts`: o logger grava tentativas sem ID estável de mensagem e em modo de melhor esforço, sem esperar o INSERT. `logQueued` também não correlaciona uma mensagem. Não há corpo/assunto/anexos nesse histórico; sua ausência não pode ser preenchida com conteúdo inventado.
- `mail/outbox.ts`: só conserva conteúdo de mensagens enfileiradas. Anexos viram base64. O processamento reserva por prazo e depois grava o resultado. Uma nova identidade não pode ser criada em cada reenvio da mesma fila; os IDs e metadados legados devem ser preservados. Reavaliar retenção/acesso de cópias de conteúdo e links secretos antes do arquivo futuro.
- `contact-delivery`/`contact-replies`: a reserva durável de respostas tem identidade/rodada/prévia e estados próprios. A base de mensagens não pode contornar essa proteção nem repetir automaticamente um resultado inconclusivo.
- Eventos/engajamento atuais são por endereço/provedor. Não atribuir abertura, clique ou entrega a uma mensagem individual sem correlação realmente recebida do provedor.

Próximo contrato: mensagem estável + tentativas/eventos correlacionados; conteúdo futuro versionado, protegido e com guarda de acesso; importação antiga como metadados/conteúdo indisponível; prévia isolada sem scripts ou carregamento de rastreadores. Edição cria rascunho/versão nova, nunca altera o histórico do que foi enviado. A Ponte do dono continua separada da correspondência de participantes. Webhook/domínio e autorização de textos continuam dependências explícitas da etapa completa.
