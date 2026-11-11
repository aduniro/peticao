# Operador R0002 native — preparação privada, sem instalação executada

Este diretório deriva do instalador480 commit1bc02abfc7c5fe408acea612a823d94550fe27c4. O perfil candidato permanece congelado no commit0ce878406810a4537268e2c7e3c8810e066bd7ef, com80 fixtures sintéticas. App f55595cd348c23ffe559dba2de9150259db9f1e7; appReleaseReady=false. Este artefato não autoriza implantação, ACK ou execução.

## Comandos locais executáveis

Diretório local: /mnt/apps/peticao-final/_ops/r0002-native-profile-install-20261111

```bash
/usr/bin/python3 /mnt/apps/peticao-final/_ops/r0002-native-profile-install-20261111/install_native.py
/usr/bin/python3 -m unittest discover -s /mnt/apps/peticao-final/_ops/r0002-native-profile-install-20261111/tests -v
```

O primeiro comando é estritamente DRY_RUN: imprime o plano, não consulta o host nem cria diretórios. Os testes usam apenas arquivos/SQLite fictícios e systemctl simulado. Não houve SSH, upload, alteração instalada, PG, HTTP ou provisionamento nesta preparação.

## Staging futuro exato, feito pelo responsável

O responsável valida o manifesto/ACK e sua lease existentes antes de qualquer transferência ou apply. Nenhuma autorização adicional, token local ou ledger é copiado. Transportes, remoção de arquivos e instalação não são iniciados por este operador.

* Fontes root0/private0700: /srv/admin-v2-coordinator/install-inputs-r0002-native/code contém somente history_native_profile.py, launch.py e coordinator.py nos hashes de plan.json. /srv/admin-v2-coordinator/install-inputs-r0002-native/harness contém exatamente os arquivos de stagePins, com schema-sources como único subdiretório.
* Stage worker997:986/private0700: /srv/admin-v2-worker/admin-r0002-history-native-qa-20261111. Nenhum marcador, runs, __pycache__, arquivo extra ou link é aceito. Só diretórios recém-criados pelo operador recebem normalização0700; diretórios preexistentes divergentes são preservados e recusados.
* Runtime compartilhado owner997/private0700: /srv/admin-v2-worker/admin-r0002-runtime-qa-20261111 e seu diretório inputs. Este inputs contém apenas runtime.tar (475576320bytes, SHA2952a2b0d7ffb06b553caa03fdb3d8546981a96118a1cc9aa0ca47da4adc8ee0) e release-manifest.json (SHA7b853db39899691fef6426d0e2dc1b893a48f14c201fc38eedb6f3df9ade2dc3). O operador valida e reutiliza os bytes; nunca copia o arquivo475MB. Caminho remoto ainda proposto, exige conferência futura.
* /srv/admin-v2-worker permanece999:989, modo2770. Não há chmod nesse parent. Coordenador passwd999:988; worker997:986; grupo do serviço989 é uma condição distinta.
* Cinco bináriosPG17.11 e Node20 são apenas verificados por metadata/hash, nunca iniciados.

## Check futuro na VPS, apenas após staging aprovado

Caminho sugerido para esta ferramenta na VPS (ainda não criado): /srv/admin-v2-coordinator/operator-r0002-native.

```bash
/usr/bin/python3 /srv/admin-v2-coordinator/operator-r0002-native/install_native.py --check
```

Revalida boot/geração primary existentes, roles, grupo do serviço ativo, Node/PGpins, fontes, runtime, preimages, fila ociosa e unidades/cgroups dos jobs conhecidos. Não rearma autoridade, modifica fila ou altera serviços. Drift, falta de permissão, unit desconhecida ou drenagem incerta fazem falhar. O recibo RO do root /mnt/apps/peticao-final/_ops/coordenacao-dupla/evidence/santiago-drain-observability-roles-ro-20261111.json comprova visibilidade/formato prévio dos10jobs, não a qualificação funcional nova nem instalação.

## Apply futuro limitado — não executar nesta etapa

Exemplo para revisão do root, em terminal root da VPS. Substituir LEASE_ID_VALIDADO_PELO_ROOT pela lease32hex do protocolo existente. O nome do checkpoint é operacional; não concede autorização. Unidade fixa limita900s de execução+120s de parada, somente root selecionado pelo responsável.

```bash
/usr/bin/systemd-run --unit=admin-v2-native-profile-install --wait --collect --property=User=root --property=Group=root --property=RuntimeMaxSec=900 --property=TimeoutStopSec=120 --property=KillMode=control-group /usr/bin/python3 /srv/admin-v2-coordinator/operator-r0002-native/install_native.py --apply --lease-id LEASE_ID_VALIDADO_PELO_ROOT
```

A ferramenta nunca chama SSH/sudo, não cria serviço persistente ou nova política. Para iniciar apply, é necessário euid0; o root deve usar a unidade limitada acima. A ferramenta não executa systemd-run sozinha.

## Transação e recuperação

1. Revalida preimages corea8e93/launcher8c8c9, helperhistory AUSENTE e runtime_profileafcb intocado. Valida inputs; prepara somente stageharness ainda ausente, sem overlay/repetir parcial.
2. Usa diretório operacional /srv/admin-v2-coordinator/install-backups-r0002-native/<lease>, exclusivo/private0700; preexistente não é reaproveitado.
3. Para somente admin-v2-coordinator.service. Prova inactive/dead/MainPID0, fila semqueued/running/starting e drenagem das units/cgroups conhecidos antes de alterar fontes.
4. SQLite backupAPI online gera snapshot consistente; copia preimages de fontes e metadata. Nunca restaura queue.sqlite, WAL ou eventos sobre a fila viva.
5. Substituição atômica no mesmo filesystem, com fsync, nesta ordem: helperhistory→launcher→coordinator. runtime_profile.py não é escrito.
6. Revalida quiescência/pins antes do start. Inicia somente o coordenador existente e verifica saúde/hashes depois. Não envia job, não repete teste, não inicia PostgreSQL/HTTP e não muda appDB/produção/boot/authority.
7. Em erro/cancelamento, rollbackCODE somente se coordinator parado+jobs drenados forem comprovados e cada destino corresponder ao nosso novo hash. Backup tem hash revalidado. Alteração estrangeira/resultado incerto é preservado e impede rollback/restart automático. Resposta perdida no start não é tratada como prova de serviço parado.
8. Receipts/preimages/result.json permanecem no checkpoint operacional. SIGTERM entra na recuperação; segundo SIGTERM durante recuperação é ignorado para preservar recibos dentro do grace externo.

Não há rollback do banco; testes24 deste operador e80 do perfil não equivalem aos19HTTP reais/nativePG. Próximo passo é revisão peer/root, manifesto/ACK/lease e staging explicitamente autorizado.
