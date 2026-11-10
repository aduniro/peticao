# Recuperação operacional: somente por intervenção manual

Helpers locais: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/infra/fence_primary.py` e `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/infra/takeover_sp.py`. Não foram executados nas VPS por esta implementação. Os caminhos `/opt/admin-v2-cluster/` abaixo pressupõem a instalação administrativa dos helpers.

1. Na VPS **sonda-verifica3**, revogar autoridade antes de parar serviços:

```sh
/usr/bin/sudo /usr/bin/python3 /opt/admin-v2-cluster/fence_primary.py --confirm-manual-fence
```

O helper só aceita root em `sonda-verifica3`. Grava `/srv/admin-v2-coordinator/authority.json` como suspended, sem boot armado; para `/etc/systemd/system/admin-v2-coordinator.service` pelo systemctl e as unidades carregadas `admin-v2-job-UUID.service`; confere que estão inativas ou falharam e registra `/srv/admin-v2-coordinator/manual-fence.json`. Erro significa que o fencing NÃO está comprovado, mesmo que a autoridade já esteja suspensa. Não rearmar Santiago durante a transferência.

2. Na VPS **peticao-sp**, escolher um checkpoint já recebido. Substituir o nome ilustrativo pelo caminho absoluto real:

```sh
/usr/bin/sudo /usr/bin/python3 /opt/admin-v2-cluster/takeover_sp.py --snapshot /srv/admin-v2-coordinator-standby/snapshots/CHECKSUM.tar.gz --confirm-manual-takeover
```

O helper só aceita root em `peticao-sp`, snapshot regular absoluto e origem Santiago. Confere que o serviço SP declara `ADMIN_CLUSTER_DISPATCH=0` e `ADMIN_WORKER_ROOT=/srv/admin-v2-coordinator-standby/recovered-worker`. Para o leitor passivo, restaura em `/srv/admin-v2-restore-UUID`, chama a promoção com `/usr/local/libexec/admin-v2-verify-fence` e exige a comprovação viva de Santiago parado. Arquivo declaratório sozinho não autoriza promoção.

Após promoção, preserva a antiga raiz em `/srv/admin-v2-standby-history/DATA-UUID`, instala a restaurada em `/srv/admin-v2-coordinator-standby` e ajusta dono `vigia-coord:admin-v2-exec`. Diretórios recebem 2770, arquivos 0660; em `/srv/admin-v2-coordinator-standby/sources`, diretórios 2550 e arquivos 0440. Se houver exceção depois da tentativa de promoção, a nova autoridade fica suspended, sem reativar Santiago. O helper nunca inicia o serviço, instala executor ou despacha trabalho em SP. Pode restar uma restauração suspensa em `/srv/admin-v2-restore-UUID` para diagnóstico.

3. Revisar o JSON final e as autoridades. Mesmo promovido, SP serve apenas à recuperação da coordenação. Jobs incertos não são repetidos; jobs de geração antiga precisam de revisão e nova submissão. Qualquer início posterior do serviço exige decisão explícita do operador. O retorno a Santiago exige nova transferência verificada; não basta religar seu serviço antigo.

4. Manter `/srv/admin-v2-standby-history` para recuperação. Nenhum histórico é apagado automaticamente pelos helpers.

Validação sintática local:

```sh
/usr/bin/python3 -m py_compile /mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/infra/fence_primary.py /mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/infra/takeover_sp.py
```
