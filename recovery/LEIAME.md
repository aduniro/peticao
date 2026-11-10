# Checkpoints e recuperação manual

Implementação local: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/recovery/recovery.py`.

Somente a fila SQLite recebe uma captura transacional consistente. Arquivos de resultados e logs são uma cópia de melhor esforço, identificada assim no manifesto. A captura não inclui ambiente, chaves, credenciais SSH, sudoers, dependências nem a pasta de trabalho de cada job. Diretórios de fontes e bundles devem conter somente material previamente autorizado e sem segredos; nomes de arquivo não conseguem identificar um segredo arbitrário dentro de um JSON ou código-fonte.

## Comandos previstos após instalação pelo administrador

Captura em Santiago:

```sh
/usr/bin/python3 /opt/admin-v2-cluster/recovery.py snapshot --source /srv/admin-v2-coordinator --worker-root /srv/admin-v2-worker --output /srv/admin-v2-checkpoints
```

A saída JSON informa o caminho absoluto do `.tar.gz`, SHA256 e geração. `/srv/admin-v2-checkpoints/latest.json` é atualizado atomicamente. O arquivo tar e os arquivos extraídos têm modo 0600; diretórios criados têm modo 0700. A transferência e a retenção dos checkpoints são responsabilidade da infraestrutura.

Verificar, substituindo `CHECKPOINT.tar.gz` pelo nome informado na captura:

```sh
/usr/bin/python3 /opt/admin-v2-cluster/recovery.py verify --snapshot /srv/admin-v2-checkpoints/CHECKPOINT.tar.gz
```

Restaurar em São Paulo para um diretório novo ou vazio:

```sh
/usr/bin/python3 /opt/admin-v2-cluster/recovery.py restore --snapshot /srv/admin-v2-checkpoints/CHECKPOINT.tar.gz --target /srv/admin-v2-coordinator-standby
```

O destino será a própria raiz do coordenador. A restauração sempre produz `role=standby`, `armed_boot_id=null` e mantém a geração capturada. Jobs em `starting` ou `running` tornam-se `interrupted`, com evento de reconciliação; resultados preservados aparecem em `/srv/admin-v2-coordinator-standby/recovered-worker/`. Jobs `queued` permanecem na captura para auditoria, mas o core recusa executá-los depois da mudança de geração: exige revisão e nova submissão com novo ID. Nenhum trabalho incerto é reenviado automaticamente.

## Promoção exige fencing real

Primeiro o operador deve suspender a autoridade anterior e parar o serviço, ou desligar a instância no provedor. Falha de rede, sozinha, não comprova fencing. O verificador externo deve consultar o estado real e recusar se não conseguir comprová-lo. Um arquivo JSON declaratório sozinho nunca autoriza a promoção.

Exemplo de `/root/admin-v2-fence-proof.json`:

```json
{
  "previous_host": "sonda-verifica3",
  "previous_generation": 7,
  "new_generation": 8,
  "method": "coordinator-stopped",
  "verified": true
}
```

`previous_host` deve corresponder exatamente ao hostname gravado em `recovery-origin.json`. Métodos permitidos: `coordinator-stopped` e `provider-powered-off`.

```sh
/usr/bin/sudo /usr/bin/python3 /opt/admin-v2-cluster/recovery.py promote --target /srv/admin-v2-coordinator-standby --fence-proof /root/admin-v2-fence-proof.json --verify-fence-command /usr/local/libexec/admin-v2-verify-fence
```

O verificador recebe a prova pelo stdin e um desafio em `ADMIN_CLUSTER_FENCE_NONCE`; deve devolver JSON com `confirmed=true`, `nonce` igual ao desafio, `previous_host`, `previous_generation`, `method` e `verified_at` ISO8601 UTC recente (até 60 segundos). O executável e todos os diretórios pais devem pertencer ao root e não permitir escrita por grupo/outros. Não há shell intermediário. A promoção é serializada por lock local e incrementa a geração exatamente uma vez; falhas parciais fecham o acesso em vez de restaurar autoridade antiga.

A promoção não inicia o serviço. O administrador ainda deve conferir o estado e iniciar o coordenador explicitamente. Reboot invalida `armed_boot_id`; não rearmar automaticamente. Não religar Santiago como primário antigo após a promoção: primeiro sincronizar e converter sua autoridade para standby/suspended. O teste de split-brain usa autoridades fictícias e um verificador simulado; a prova operacional do verificador real fica com a infraestrutura.

## Verificação local

```sh
/usr/bin/python3 -m unittest discover -s /mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/tests -p recovery_test.py -v
```

Sete testes cobrem SQLite online e exclusões, restauração passiva e interrupção de jobs, corrupção, traversal/links, recusa sem fencing confirmado, promoção e geração antiga, e transferência simulada sem dois coordenadores autorizados.
