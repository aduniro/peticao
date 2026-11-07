# Continuidade da integração do admin-v2

A integração permanece em andamento, sem deploy autorizado. O plano completo continua em `AUDITORIA-CONTINUIDADE-ADMIN-V2-20261106.md`; este registro não reduz o escopo às correções já concluídas.

Candidato: `/mnt/dev/peticao/.cache/admin-integration/candidate-stage01`, ramo `admin-v2-stage01`. Não publicar o checkout principal inteiro, que contém mudanças públicas de outras tarefas ainda não publicadas.

Checkpoints:

- `77f33f7`: candidato atualizado com os três arquivos efetivamente publicados após a restauração dos formulários, hashes conferidos.
- `0020ce1`: transações de contas, proteção concorrente do último Total, uso único de redefinição e revogação; ranking regional agregado antes do limite por estado.
- `43b56e8`: publicação vinculada ao manifesto simulado, verificação de origem/cópia antes da troca e trava comum entre os caminhos de publicação. Inclui instalador separado, ainda não executado na VPS, e ensaio de atualização do banco.
- `7750df0`: fixtures cumulativas atualizadas para as regras de CPF/identidade já publicadas, sem importar mudanças de aliases de e-mail ainda não publicadas.

Evidências mais recentes em `/mnt/dev/peticao/.cache/admin-audit-20261106/`: suíte cumulativa **235/235**, oito testes Python do publicador/pipeline, ensaio da inicialização real no esquema anterior (seis tabelas aditivas, registros fictícios e definições existentes preservados), tipos e build aprovados. A rodada inicial 225/234 foi diagnosticada e corrigida nos testes que presumiam contratos antigos; as regras públicas atuais foram mantidas.

Detalhes e comandos: `docs/ETAPAS-ADMIN-01.md` e `deploy/LEIAME.md` dentro do candidato. O ensaio usa apenas banco de desenvolvimento em loopback/porta explícita e dados fictícios. O SQLite de revisão não participa desses testes.

Próxima etapa: A6 (autoria das correções, estados finais do Terminal e idempotência de respostas), demais controles sensíveis, QA visual/permissões em seis tamanhos e conferência final com a VPS atual. O aviso de Minha conta ainda aguarda a aprovação de texto já solicitada ao dono. Triagem interna, mensagens/editor, edição recuperável, IAs e documentos das Etapas 2–7 continuam pendentes no escopo completo. O término desta rodada de testes não conclui o objetivo nem autoriza publicação.

## Checkpoint seguinte — autoria e Terminal

`4ca0273` implementa autoria real nas rotas de correção/reenvio e resultado autenticado do Terminal, separado da saída do comando. O registro começa sem sucesso, e o resultado só é finalizado após validação do protocolo/assinatura; a ação e a auditoria são atualizadas atomicamente. Serviço antigo é recusado antes de receber o comando. O visual do console foi preservado.

A suíte cumulativa atual passou **244/244**, com tipos e build aprovados (`stage01-cumulative-terminal.log`, `stage01-typecheck-actions.log`, `stage01-build-actions.log` no diretório de evidências). A6 continua parcial: as respostas de contato ainda exigem fila durável e reconciliação de envios incertos. O diagnóstico está em `docs/A6-RESPOSTAS-PENDENTES.md` do candidato. Não houve deploy ou instalação de serviço na VPS.


## Checkpoint seguinte — respostas de contato

`5a3cbd6` implementa reserva durável e atômica do texto/card antes do envio, uma tentativa por item, retomada pelo cron existente e resultado inconclusivo sem repetição automática. O selo vincula a prévia exata, o destinatário, a origem e as cópias. O histórico anterior é preservado e não entra em disparo automático. A fila pública conserva sua política.

Validação atual: **251/251**, tipos, build e ensaio de migração aprovados. Evidências: `stage01-cumulative-contact.log`, `stage01-typecheck-contact.log`, `stage01-build-contact.log`, `stage01-schema-contact.log`. Workers concorrentes, aceite tardio e falhas entre envio/gravação foram ensaiados com dados e transportes fictícios. O ensaio de histórico anterior preservou IDs, autores, resultados e horários.

A6 permanece parcial até os rótulos/aviso de envio inconclusivo aprovados serem integrados à interface. Também faltam controles sensíveis, QA visual/permissões, conferência com produção e Etapas 2–7. A autorização de deploy continua sendo posterior à validação completa. Nenhuma alteração da VPS ou da revisão de CPFs nesta rodada.


## Checkpoint seguinte — confirmação extra e QA de contato

No candidato, `aada17c` torna atômicos a reserva e o consumo do código de confirmação extra, serializa a quota entre sessões e relê a conta/sessão no banco. A gestão de usuários exige a confirmação existente na página e no POST; nenhuma redação de aviso foi alterada. O handler foi testado nos quatro níveis, com ausência/expiração de confirmação, origem externa e autoria real.

Validação atual: **256/256** testes cumulativos, tipos e build aprovados (`stage01-cumulative-stepup.log`, `stage01-typecheck-stepup.log`, `stage01-build-stepup.log`). `0ba3094` promove o QA local de contato ao repositório: seis larguras aprovadas para falha de rede injetada, preservação do rascunho, botão liberado e recuperação da prévia. Não houve envio real; não é prova de QA integral ou de entrega. Evidências em `visual/contact-editor.json` e `stage01-contact-browser.log`.

A prévia isolada foi reiniciada em `http://127.0.0.1:3031/admin`, com banco fictício 54345. O banco de testes cumulativos é outro (54341). Pendências preservadas: avisos aguardando aprovação, resultado de convites/redefinições, demais controles e telas, QA por nível e Etapas 2–7. Nenhuma alteração da produção, instalação remota ou deploy.
