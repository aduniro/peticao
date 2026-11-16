# Coordenação dupla — contrato operacional único

Base compartilhada local: `/mnt/apps/peticao-final/_ops/coordenacao-dupla/`. Não é um checkout compartilhado para edição de código. Dados e histórico operacional ficam privados em `/mnt/apps/peticao-final/_ops/coordenacao-dupla/state/coord.sqlite`; banco e snapshots não devem ser commitados.

## Participantes e fontes

- apoio: sessão01a1c0b3-f069-75a0-a2e9-e691094c9bab, responsável pelo frontend público em `/mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109`, infraestrutura, acompanhamento e único fluxo de e-mail.
- admin: sessão01a1a4bd-cdf4-7253-88e7-0c9fb9265aa7, iniciada em `/mnt/dev/peticao`; desenvolvimento atual em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109`. Mantém contratos administrativos, banco/journal/mail/assinaturas e seus drafts independentes.
- Subagente historico_comum herdou o contexto desta conversa para construir o ledger e recebeu os dados autorizados da outra sessão. Não é um terceiro coordenador de publicação nem um processo LLM permanente. Os dois coordenadores dão os ACKs; subagentes usam os mesmos recursos pela autoridade de seu coordenador.

## Antes de editar

Ler status e eventos novos pelo CLI `/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py`. Reservar os paths antes de alterar fontes compartilhadas; arquivos de branches distintos que representam o mesmo código têm o mesmo recurso canônico. Cada coordenador renova o próprio lease, preservando token/fence, e nunca usa o token do outro. Tokens ficam em arquivos privados, não em mensagens ou e-mails. Trabalho em drafts independentes pode continuar enquanto outro recurso estiver reservado.

Manual completo e comandos: `/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/README.md`.

## Integração, migração e publicação

1. Avisar a outra sessão e registrar um manifesto de `announce`: commit completo40hex, lista completa de arquivos, contratos de API (ou sem alteração), mudança de banco (ou sem alteração), testes/comandos/resultados e destino inequívoco. Referenciar pedido do responsável que autorizou a publicação concreta.
2. O outro coordenador confere o diff/contratos/evidências e registra ACK do evento. ACK não é autorização de deploy do admin-v2, nem aprovação automática de uma versão de produção não inspecionada.
3. Adquirir lease crítico com `--operation deploy|merge|migration --manifest-event SEQ`. Essas operações também reservam toda fonte e impedem edição concorrente por participantes que respeitam o protocolo. Checar validade e fence imediatamente antes da ação; renovar durante a operação. Sem manifesto/ACK ou com operação incerta, não prosseguir.
4. Conferir a release efetiva na VPS antes de compor a próxima. Atualizar frontend não autoriza substituir implicitamente o backend atual por um checkout público antigo. Manter package.json/lockfile, schema, emissor de e-mail, journal, tokens, WhatsApp e cron compatíveis. O patch público b9e8ae2 já existe no admin como0e362245; não reaplicar por data/merge cego.
5. Executar os testes adequados em ambiente fictício, registrar a composição final validada e publicar somente o escopo autorizado. Página principal: quando o responsável pedir a alteração acompanhada de deploy. Admin-v2: autorização específica obrigatória. Nenhuma publicação foi solicitada ou feita para implantar este protocolo.
6. Registrar resultado observado: commit realmente publicado, versão/build/hash, ambiente, testes de fumaça e eventual rollback. Avisar ambos, obter reconhecimento e encerrar o lease. Falha incerta não é tratada como operação abortada sem conferir estado remoto.

Expiração não transfere autoridade automaticamente. Leases expirados viram uncertain e continuam bloqueando o recurso até reconciliação pelos dois coordenadores. Falta de ACK bloqueia apenas a operação dependente; continuar tarefas independentes autorizadas. O ledger é um controle cooperativo: não intercepta sozinho edições ou comandos manuais fora do protocolo. Ambos os coordenadores concordaram em utilizá-lo antes das operações; nenhum script antigo ganha autorização por existir.

## Histórico e relatórios

Observador `/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/watch_sessions.py`, timer `/home/barre/.config/systemd/user/coord-sessions-watch.timer`, a cada30s. Lê somente metadados incrementais das duas conversas autorizadas e alterações versionadas do código. Não copia mensagens brutas, argumentos/outputs de ferramentas, dados pessoais, CSVs privados ou segredos. Registro de coleta não prova agente ativo; a última atividade é o timestamp da conversa, com estado desconhecido/stale quando aplicável. Git/telemetria não dão ACK de compatibilidade.

Relatório único: `/home/barre/.config/systemd/user/peticao-relatorio-andamento.timer`, a cada1h, America/Porto_Velho. Programa `/mnt/apps/peticao-final/peticao/.cache/relatorios-periodicos-20261109/report.mjs`; destinatário único operator-1608598f41@example.invalid. Inclui ambas sessões, subagentes registrados no Vigia, árvore do admin, checkpoints, testes, eventos e ACKs pendentes. Guarda por período e ausência de retry foram preservadas; não repetir slots antigos ou resultado incerto. Nenhum envio manual é necessário para habilitar a cadência.

O observador e o timer de relatório são serviços locais de usuário que persistem após logout (linger já habilitado); não executam decisões LLM, não assumem o controle de outra sessão e não trabalham quando este computador estiver desligado. Fila de Santiago e acompanhamento privado continuam independentes; o resumo local ficará antigo se a máquina local cair. Página privada: http://100.80.18.81:8766/.

Autorizações e limites: `/mnt/apps/peticao-final/_ops/coordenacao-dupla/docs/AUTORIZACAO-RESPONSAVEL-20261110.md`. Checklist de compatibilidade: `/mnt/apps/peticao-final/_ops/coordenacao-dupla/reviews/admin-compat-20261110.md`.
