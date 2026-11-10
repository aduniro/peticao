# R4 — Histórico populado com PostgreSQL17 nativo privado

Código privado local: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/r0000-document-history-populated-smoke-20261110/r4-native-pg`.

Preparação para revisão do perfil tipado na **fila coordenada existente**. Não cria executor, serviço, container, rede, grupos ou regras sudo. O perfil ainda não foi registrado nem executado no destino. Os19checks HTTP populados continuam pendentes.

## Escopo preservado

Mesmo runtime congelado0a5f734, sem rebuild. Dois usuários fictícios (total e leitura), dois lotes e duas versões PDF sintéticas originais, sem assinatura criptográfica. Mantidos os19checks daR3: autenticação, step-up exigido, ordem2→1/filtro, metadados, download de ambos os PDFs/bytes/SHA/cabeçalhos, crossbatch404, ausente404, inválido400, semcookie401, leitor403, consultas gerais base/recibos/artefatos/lotes. A mudança deste perfil é o lifecycle PostgreSQL.

O estado step-up continua uma fixture declarada após login verdadeiro. Nenhum POST documental, upload, validação, assinatura, aprovação/envio, fluxo unsigned bloqueado ou IA/contatos será executado. O pacote não contém dados reais, credenciais, leases, saídas de banco ou runtime compilado.

## Identidade e limites obrigatórios

Somente `vigia-worker` semroot, dentro do cgroup exato do job criado pelo executor existente. Antes de executar: verificar perfil, lease central eACK, Node20.19.2/ABI115/NAPI9 e manifesto do runtime fixado. O preflight recusa runtime com arquivos extras/.env, links ou hashes divergentes antes da cópia privada.

O cgroup deve realmente limitar CPU≤2cores, memória≤3GiB e PIDs≤256; o runner lê as propriedades efetivas. Perfil proposto em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/r0000-document-history-populated-smoke-20261110/r4-native-pg/profile.proposed.json`. A aplicação usa heap1536MiB; PG shared_buffers64MB/max_connections20/max_parallel_workers0. Exigir2GiB livres na preparação do executor. Orçamento:600s para o ensaio e120s adicionais para coleta/encerramento, hardtimeout720s/KillMode=control-group do executor. Um único job pesado por vez. Em armazenamento saudável, prever3–8min; o primeiro ensaio remoto deve medir o tempo real. A fila deve interromper e drenar o próprio cgroup no limite: o runner não cria nem modifica cgroups.

## PostgreSQL nativo

Binários fixos: `/usr/lib/postgresql/17/bin/{postgres,initdb,pg_ctl,psql,pg_isready}`, versão exata17.11. Registrar SHA256/versão na execução e recusar drift antes do stop. Não usa PostgreSQL de sistema, defaults de conexão, sudo ou Docker.

Cada job cria `runs/<nonce>/postgres`, PGDATA0700, sob seu staging privado. O diretório de socket é `/tmp/history-pg-<nonce>`,0700, para respeitar o limite de108bytes de endereço UNIX mesmo com staging profundo; seus device/inode ficam no marcador privado. Porta55485 e bind127.0.0.1; socket permissions0700. O initdb usa usuário/senha exclusivamente fictícios, auth scram e arquivos gerados0600. O ambiente libpq é limpo, com PGPASSFILE próprio e host/port/db explícitos; `.psqlrc` é desabilitado.

Antes do initdb: recusar qualquer PGDATA/socket/marcador preexistente e qualquer diretório não canônico ou sem dono/modo corretos. Nunca adotar/limpar um cluster existente. Antes do seed: verificar PID/startticks, argumentos-D/cluster_name, UID, cgroup, pidfile/data/socket/port, depois SELECT version/current_database/cluster_name/data_directory/port. Criar somente o banco fixture_only após a identidade do cluster novo ser comprovada; o helper Node repete a identidade antes de suas consultas.

## Cancelamento e encerramento

pg_ctl stop somente com PGDATA, marker nonce/device/inode, PID/startticks/argv/UID/cgroup próprios confirmados. Nenhum pkill, killall, porta global, serviço de sistema ou sinal para PID reaproveitado. O processo Next também tem verificação de UID/cgroup/startticks antes de sinalizar seu grupo.

Interrupção de start sem PID durável é **incerta**, não “parado”: não reinicia, não remove diretórios e exige reconciliação/drenagem pelo executor do próprio job. Se existir PID próprio válido após timeout, pode encerrá-lo por identidade. Falha de cleanup é registrada como incerta e impede sucesso. SIGTERM/KeyboardInterrupt desencadeiam o cleanup identificado; o hardtimeout e a drenagem de todos os filhos do cgroup pertencem ao executor existente. Registros de initdb/bootstrap interrompidos podem permanecer no cgroup até essa drenagem; não alegar conclusão a partir de ausência de pidfile.

Após stop validado, remover somente o socket vazio cuja identidade foi conferida. PGDATA fictício permanece privado para evidência/retensão do job, fora do Git e do bundle. A política de retenção do executor recolherá/removerá apenas seu staging após coleta.

## Comandos propostos, depois do peer review

Exemplo no destino, com JOB-ID efetivo, staging pertencente ao worker, encaminhador do ledger previamente validado e configuração privada preenchida. O arquivo de lease é provisionado fora do bundle. Estes caminhos não foram instalados por esta tarefa:

```
/usr/bin/env HISTORY_SMOKE_CONFIG=/srv/admin-v2-worker/jobs/JOB-ID/history-native-r4/remote-config.json /usr/bin/python3 /srv/admin-v2-worker/jobs/JOB-ID/history-native-r4/functional_smoke.py
```

Essa é a única entrada do perfil tipado a cadastrar na fila existente; não autoriza uma entrada genérica de comandos nem publicação. A configuração de exemplo em `/mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/r0000-document-history-populated-smoke-20261110/r4-native-pg/remote-config.example.json` exige valores reais conferidos pelo coordenador. O cgroup é fornecido pelo executor e deve corresponder ao processo atual.

## Testes locais leves

Somente mocks/fixtures, sem iniciar PostgreSQL, Next ou Docker:

```
/usr/bin/python3 -m unittest discover -s /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/r0000-document-history-populated-smoke-20261110/r4-native-pg -p 'test_native_pg.py' -v
/usr/bin/python3 /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/r0000-document-history-populated-smoke-20261110/r4-native-pg/test_runtime_preflight.py
/usr/bin/python3 /mnt/apps/peticao-final/peticao/.cache/admin-v2-retomada-20261109/r0000-document-history-populated-smoke-20261110/r4-native-pg/test_guard.py
```

Cobrem argumentos/private dirs, ciclo mockPG17, versão errada, raiz/cgroup/limites inválidos, initdb recusado sobre dados existentes, symlink, nonce/datadir/PID/cgroup incorretos, PID reaproveitado, cancelamento/start incerto, stop somente próprio e socket somente após stop, runtime adulterado e sinalização Next fora do job. Não substituem bootstrap nativo ou os19checks HTTP reais em Santiago.
