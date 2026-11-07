# Etapa 3 — base observada para mensagens

Base e conexão inicial ao transporte implementadas no candidato; eventos, consultas e interface ainda pendentes. Não alterar filas públicas ou política de reenvio junto com a integração visual sem regressão própria.

- `mail/index.ts`: `sendMail` é o ponto de saída, com guardas de destinatário, supressão, prévia e canais separados. `sent` significa aceite do transporte, não entrega. Na leitura inicial, `drainMailOutbox` chamava o transporte diretamente; a integração de arquivo/identidade deve cobrir ambos os caminhos, preservando rotação e canal de marketing.
- `mail/log.ts`: o logger legado gravava tentativas sem ID estável de mensagem e em modo de melhor esforço, sem esperar o INSERT. `logQueued` também não correlaciona uma mensagem. Não há corpo/assunto/anexos nesse histórico; sua ausência não pode ser preenchida com conteúdo inventado.
- `mail/outbox.ts`: só conserva conteúdo de mensagens enfileiradas. Anexos viram base64. O processamento reserva por prazo e depois grava o resultado. Uma nova identidade não pode ser criada em cada reenvio da mesma fila; os IDs e metadados legados devem ser preservados. Reavaliar retenção/acesso de cópias de conteúdo e links secretos antes do arquivo futuro.
- `contact-delivery`/`contact-replies`: a reserva durável de respostas tem identidade/rodada/prévia e estados próprios. A base de mensagens não pode contornar essa proteção nem repetir automaticamente um resultado inconclusivo.
- Eventos/engajamento atuais são por endereço/provedor. Não atribuir abertura, clique ou entrega a uma mensagem individual sem correlação realmente recebida do provedor.

Próximo contrato: mensagem estável + tentativas/eventos correlacionados; conteúdo futuro versionado, protegido e com guarda de acesso; importação antiga como metadados/conteúdo indisponível; prévia isolada sem scripts ou carregamento de rastreadores. Edição cria rascunho/versão nova, nunca altera o histórico do que foi enviado. A Ponte do dono continua separada da correspondência de participantes. Webhook/domínio e autorização de textos continuam dependências explícitas da etapa completa.


## Base implementada — checkpoint 55b830f

`mail/archive.ts` prepara identidade UUID, pedido idempotente protegido por HMAC, conteúdo opcional e versões por `previous_id`. Repetir o pedido exige o mesmo envelope/conteúdo e não renova retenção. Outro texto/anexo cria outra versão. A vinculação com `mail_outbox` exige identidade de conteúdo, tipo e destinatário; não substitui vínculo existente. As colunas novas são nulas nos registros anteriores.

`mail/archive-codec.ts` usa AES-GCM com chave derivada do segredo existente em domínio próprio, nonce aleatório e ID da mensagem como dado autenticado. Anexos preservam bytes. O fingerprint é HMAC, inclusive dos descritores dos anexos. Troca/adulteração do ciphertext não libera conteúdo. Limite de arquivo de 16 MiB marca `oversize`, sem impedir identidade/metadados do e-mail e sem criar outra cópia base64 do anexo grande. Não muda HASH_PEPPER ou hashes existentes.

A biblioteca só grava conteúdo quando recebe política explícita (`until` ou `null` para permanência). Sem ela, conserva metadados e fingerprint. A escolha de 30 dias, 90 dias ou sem exclusão automática foi perguntada ao dono e continua pendente; nenhuma política automática foi ativada. A leitura respeita o relógio do banco; expurgo limitado e auditado elimina somente ciphertext expirado. Metadados, tentativas e resultados permanecem. Isso não afirma limpeza de backups nem das cópias antigas nas filas; essa guarda precisa ser integrada antes da liberação completa.

Tentativas têm ID próprio e uma admissão ativa por mensagem, antes do futuro efeito. Resultado e auditoria são atômicos; aceite é terminal para novas tentativas. Recusa comprovada pode permitir outro provedor; incerteza bloqueia por padrão. A exceção explícita `retryUncertain` é interna e auditada, para integração consciente com a política pública existente; não é uma opção do navegador. Uma tentativa ainda preparada não expira como falsa prova de ausência de envio. Falha ao registrar resultado não autoriza repetir um possível envio.

O logger legado pode receber `message_id`; resultados da nova biblioteca geram um único log correlacionado, sem duplicação na repetição do resultado. No checkpoint 55b830f, o transporte ainda usava o caminho anterior. A integração deverá substituir o registro anterior nesse caminho, não somar dois loggers; deve arquivar o envelope efetivo após defaults e preservar guards, canais, rotação e reservas de contato. Nenhuma rotina de envio havia sido modificada no checkpoint 55b830f; a conexão posterior está registrada em `ETAPA-03-TRANSPORTE.md`.

Após a conexão inicial de `sendMail`/drain descrita em `ETAPA-03-TRANSPORTE.md`, ainda faltam recuperação controlada de tentativas interrompidas, IDs reais dos provedores/eventos, política/retenção integrada, consultas autorizadas, prévia segura, conversas e editor. Não há endpoint de conteúdo descriptografado. A biblioteca é interna e sua autorização será exigida no chamador administrativo. Não declarar a Etapa 3 completa nem arquivo automático de conteúdo ativado sem política explícita.

## Validação da base

**318/318** cumulativos, tipos após build, build e ensaio de migração aprovados. Onze testes novos cobrem ciphertext/anexos, adulteração e troca de ID/chave, reserva concorrente/idempotência sem renovar prazo, versões, admissão/resultados concorrentes, incerteza, rollback de auditoria, vínculo exato com a fila, expiração, limite de tamanho e expurgo transacional. Nenhum provedor real é chamado nesses testes.

A migração agora confere nove tabelas aditivas e exatamente duas colunas UUID nulas (`mail_log.message_id`, `mail_outbox.message_id`). Metadados, payload, IDs e horários de e-mails legados são comparados antes/depois. Nenhuma identidade/conteúdo antigo é fabricado. O bootstrap anterior continua compatível. Isso não mede duração de migração sobre todo o volume da VPS; essa conferência operacional continua no gate final.

Logs em `/mnt/dev/peticao/.cache/admin-audit-20261106/`: `stage03-cumulative-foundation.log`, `stage03-build-foundation.log`, `stage03-typecheck-serial.log`, `stage03-migration.log` e `stage03-archive-expanded.log`. O cumulativo inclui a última prova de rollback do expurgo, além da rodada específica anterior. A prévia 3031 foi retomada e `/admin` respondeu 200. Não houve nova interface/QA visual porque os componentes visíveis não foram modificados; não confundir esse smoke com conclusão do painel transacional.
