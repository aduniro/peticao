# Ambiente distribuído do admin-v2 — infraestrutura pronta

Esta pasta contém componentes operacionais e não deve ser removida numa limpeza genérica de caches.

Pasta local completa: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110`.
Data: 10/11/2026. Esta frente de infraestrutura não sincronizou código em andamento, não fez merge/deploy da aplicação e não consultou nem alterou o banco de assinaturas. Posteriormente, o outro agente entregou um checkpoint explícito, registrado na atualização ao final deste documento.

## Papéis e funcionamento

- Santiago (`100.80.18.81`): coordenador persistente, fila SQLite, um worker por vez, Node 20.19.2/npm9.2.0, Docker, Compose, PostgreSQL17, ferramentas de compilação. Raízes `/srv/admin-v2-coordinator`, `/srv/admin-v2-worker` e `/srv/admin-v2-checkpoints`. Código instalado em `/opt/admin-v2-cluster`.
- Local (`100.105.193.63`): desenvolvimento e observação. A ponte envia estados reais ao Vigia a cada 30 segundos. Se o computador local desligar, os jobs já aceitos continuam em Santiago; isso não mantém uma sessão interativa do Codex nem cria tarefas novas automaticamente.
- São Paulo (`100.109.6.122`): produção preservada e checkpoints passivos em `/srv/admin-v2-coordinator-standby/snapshots`. O coordenador está instalado, desabilitado, sem worker e com `ADMIN_CLUSTER_DISPATCH=0`. Uma contingência recupera a coordenação e a fila; não habilita builds na produção.

O SSH desta infraestrutura escuta somente no IP da Tailnet, porta2222, com chaves e hostkeys verificadas. Os acessos SSH anteriores e a política Tailscale SSH da porta22 foram preservados. A porta2222 não respondeu nos IPs públicos testados.

## Permissões solicitadas

`vigia-worker` em Santiago, `sonda` em Santiago e `peticao` em São Paulo têm `NOPASSWD: ALL`, validado com `visudo` e `sudo -n id -u` retornando0. `peticao` é a conta de serviço da aplicação em São Paulo, com shell `/usr/sbin/nologin`; sudo não transforma essa conta em login SSH.

O coordenador `vigia-coord` tem somente o launcher fixo liberado em Santiago. Os limites de CPU/memória são operacionais; o worker tem sudo amplo por decisão expressa do responsável, portanto não é um sandbox contra código malicioso.

Para concluir a mesma permissão para `barre` local, o proprietário deve executar uma vez:

```bash
/usr/bin/sudo /usr/bin/python3 /mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/infra/grant-sudo.py barre
/usr/bin/sudo -n /usr/bin/id -u
```

Chaves privadas permanecem nas máquinas de origem; nenhuma chave privada foi lida ou impressa. Local: `/home/barre/.ssh/id_admin_v2_cluster`; Santiago: `/home/vigia-coord/.ssh/id_standby`; São Paulo: `/root/.ssh/id_admin_v2_fence`. Não copiar esses arquivos para commits ou relatórios.

## Acompanhamento e comandos

Executar na máquina local, de qualquer diretório:

```bash
/usr/bin/python3 /mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/infra/cluster.py health
/usr/bin/python3 /mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/infra/cluster.py jobs
/usr/bin/python3 /mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/infra/cluster.py --node sp replica-info
/usr/bin/systemctl --user status admin-v2-vigia-bridge.timer
```

Em Santiago: unidades `admin-v2-coordinator.service`, `admin-v2-replicate.timer`, `admin-v2-ssh.service`. Em São Paulo: `admin-v2-ssh.service` e `admin-mesh-sshd.service` ativos; o coordenador permanece desabilitado. Configuração declarativa `/etc/admin-v2-cluster.env` e unidades em `/etc/systemd/system`. Observador local: `/home/barre/.config/systemd/user/admin-v2-vigia-bridge.timer`.

Logs de jobs em Santiago: `/srv/admin-v2-worker/jobs/UUID/output.log`, resultado `/srv/admin-v2-worker/jobs/UUID/result.json`, artefatos `/srv/admin-v2-worker/jobs/UUID/artifacts`. UUID é o identificador completo retornado pela submissão. Consulta logs: cliente `cluster.py logs --json '{"id":"UUID"}'`, usando o caminho absoluto acima.

A ponte registra somente tarefas `cluster-job-UUID` e observadores, sem modificar a tarefa principal do admin-v2. A infraestrutura tem sua tarefa `cluster-admin-v2-20261110`. Percentuais não são estimados a partir de silêncio; trabalhos sem marcos suficientes não recebem progresso fictício.

## Próxima sincronização com o agente principal

1. O responsável pede ao agente principal para concluir a operação em andamento, salvar alterações e informar repositório, branch, commit completo e pendências. Não sincronizar arquivos abertos nem fazer merge automático.
2. Revisar o commit quanto a segredos, dados pessoais, bancos, dependências e builds. O exportador usa somente arquivos versionados daquele commit; checagem de nomes não prova ausência de segredos no conteúdo.
3. Conferir uma exportação sem enviar, substituindo os dois valores por caminho absoluto real e SHA completo40hex:

```bash
/usr/bin/python3 /mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/infra/send_source.py --repo /CAMINHO/ABSOLUTO/DO/REPOSITORIO --commit COMMIT_COMPLETO_40_HEX
```

4. Repetir com `--send` somente após esse checkpoint explícito. Fontes importadas ficam imutáveis em `/srv/admin-v2-coordinator/sources/COMMIT/tree`.
5. Preparar ambiente de banco fictício separado, variáveis de teste e mecanismos de e-mail desabilitados para os testes específicos do app. Isso ainda não foi feito para o código real. PostgreSQL instalado não significa banco de testes da aplicação pronto.
6. Submeter jobs com UUID novo e um dos tipos `build`, `typecheck`, `test`; cada um executa `npm ci` antes do comando. O ID é idempotente e não pode ser reutilizado com outro conteúdo. Um job por vez evita sobrecarga. Integração de branches continua sendo trabalho explícito do coordenador humano/agente, sem merge automático nesta fila.

## Checkpoints e contingência

Replicação tenta a cada60 segundos depois de cada ciclo; duração do snapshot/transferência acrescenta atraso. Não é uma garantia rígida de RPO. Fila SQLite usa backup online consistente. Logs, resultados e artefatos têm cópia de melhor esforço, descrita no manifesto. Até10 checkpoints locais verificados, preservando o último entregue; reserva tem orçamento de2GiB e bloqueia nova recepção ao atingir o limite. Conferir `replica-info` e `/srv/admin-v2-coordinator/replication-out.json` antes de considerar uma captura atualizada.

O reboot invalida o armamento pelo bootID; não há rearmamento ou promoção automática. Perda de conexão não é prova de queda. Antes de promover São Paulo, deve-se suspender autoridade e parar coordenador/workers em Santiago, ou obter prova equivalente de desligamento do provedor. O verificador instalado `/usr/local/libexec/admin-v2-verify-fence` consulta efetivamente Santiago pela Tailnet e recusa promoção se a rede impedir essa verificação; desligamento do provedor não foi implementado nesse verificador.

Procedimentos completos de recuperação: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/recovery/LEIAME.md` e `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/infra/RECUPERACAO-MANUAL.md`. Jobs com resultado incerto ou geração antiga não são reenviados automaticamente. Uma restauração exige conferir proprietários/permissões antes de iniciar o coordenador. Não reiniciar o primário antigo após uma transferência real sem convertê-lo para reserva e sincronizar a geração.

## Evidências e validação

Evidências locais completas em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/evidencias`. A suíte foi ampliada após o acesso bidirecional e o dashboard; veja o resultado final em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/evidencias/testes-finais.log`. Foram verificados: sucesso/falha/cancelamento, idempotência, jobs continuando após término do cliente, npm build/typecheck/test em projeto fictício com Node20, replicação SHA256, restauração passiva e promoção isolada após fencing real. A autoridade isolada foi suspensa antes de reativar Santiago. A aplicação de produção continuou HTTP200, com serviços da aplicação, Caddy e PostgreSQL ativos.

Resultados numéricos e caminhos dos ensaios estão em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/evidencias/testes-finais.log`, `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/evidencias/live-recovery.json`, `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/evidencias/npm-fixtures.json` e `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/evidencias/artifact-job.json`.

Os testes fictícios comprovam o executor e não representam aprovação funcional do admin-v2. Não houve medição de ganho percentual de desempenho nem estimativa validada de redução do prazo do painel.

## Desligamento reversível da infraestrutura

Não afeta unidades da aplicação. Na máquina local: `/usr/bin/systemctl --user disable --now admin-v2-vigia-bridge.timer`. Em Santiago, como root: `/usr/bin/systemctl disable --now admin-v2-replicate.timer admin-v2-coordinator.service admin-v2-ssh.service`. Em São Paulo, como root: `/usr/bin/systemctl disable --now admin-v2-ssh.service`. Preservar checkpoints e fontes. Revogação das regras sudo deve ser feita separadamente, de forma explícita, após confirmar acesso administrativo alternativo.

## Acesso bidirecional e dispositivos de acompanhamento

O complemento solicitado está em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/ACESSOS-ATUAIS.md`. SSH administrativo privado na porta2223 passou nas seis direções e duas famílias (12 testes). Nas três máquinas, usar `/usr/bin/ssh cluster-local`, `/usr/bin/ssh cluster-santiago` ou `/usr/bin/ssh cluster-sp`; para IPv6 acrescentar `-ipv6` ao alias. Conta administrativa de São Paulo: adunir; a conta de serviço peticao permanece sem login interativo.

Dashboard somente leitura em http://100.80.18.81:8766/ e http://[fd7a:115c:a1e0::3e2f:1252]:8766/. Celular, TL10 e dois registros Haven foram autorizados por seus endereços IPv4/IPv6, sem chaves administrativas. O resumo do Vigia local é exportado a cada30 segundos pelo timer `/home/barre/.config/systemd/user/admin-v2-vigia-export.timer`; local desligado causa resumo antigo devidamente sinalizado, enquanto fila e dashboard continuam em Santiago. Não foi observada abertura visual pelos dispositivos móveis.

## Atualização do checkpoint entregue pelo outro agente

Ao encerrar os acessos, foi encontrado o handoff `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/APP-QA-HANDOFF-20261110.md`, criado por outra frente. O checkpoint real 4eb9349079fb7e89dd3faee58e78300d7308ada4 foi importado por ela em Santiago. O job bd85b84b7c24415d8d22907721b87a20, tipo typecheck, foi consultado por esta frente e está completed/exit0. Evidência local: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/evidencias/primeiro-typecheck-app.json`.

Isso supera a pendência inicial de receber um commit, mas não qualifica builds ou testes completos do app. O handoff pede perfil específico de QA com banco fictício, comandos selecionados, guards de rede/e-mail e manifestos de runtime; não submeter build/test genérico do app antes dessa preparação. A presente frente não executou novos testes reais do app nem modificou o handoff da outra frente. As instruções de próxima sincronização acima descrevem o protocolo e o estado inicial; a fonte atual deve seguir esse handoff específico.
