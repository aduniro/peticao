# Roteiro operacional480 — DRY-RUN por padrão

Repositório privado separado em /mnt/apps/peticao-final/_ops/r0000-cluster-runtime-profile-20261110/installation-dry-run-480. O perfil infra aprovado para revisão continua4ddb04347bbcb63b6be61185f1ff488f10a59b9d, intocado. Este roteiro não é deploy de aplicação e não altera seu pacote/pins.

Executado somente localmente: saída de simulação, compilação Python e19 testes fictícios de filesystem/SQLite/rollback. Sem SSH, sudo, systemctl real, instalação, container, banco real ou runtime real.

## Governança existente

O coordenador verifica ACK e lease no ledger já existente ANTES de invocar apply. Não há sistema de aprovação adicional, arquivos autorizadores em/etc, prazo inventado, nova política ou fila. A opção lease-id apenas usa o identificador existente no nome do checkpoint; não cria, concede ou renova autorização. O script exige root somente porque a aplicação futura altera arquivos de infraestrutura; não executa sudo nem pede privilégios sozinho.

Leitura RO confirmou pedido480 e ACK do apoio registrado na tabelaacks(seq480), com evento507(data.event_seq480). Snapshot em evidence/ledger-ack-480.json, apenas evidência de proveniência, não autorizador. O pai valida a situação atual do ledger antes de qualquer operação futura.

## Comandos

Local, seguro e já executado:
`/usr/bin/python3 /mnt/apps/peticao-final/_ops/r0000-cluster-runtime-profile-20261110/installation-dry-run-480/install_480.py`

Futuro caminho proposto na VPS, somente depois do pai verificar ledger/lease e transportar os dois arquivos pinados:
`/usr/bin/python3 /srv/admin-v2-coordinator/operator-480/install_480.py --check`
`/usr/bin/python3 /srv/admin-v2-coordinator/operator-480/install_480.py --apply --lease-id ID_HEXADECIMAL32_DA_LEASE_EXISTENTE`

Não executar o segundo exemplo com o marcador literal. Não houve transporte desses arquivos. --check só lê; a execução sem flags é sempre DRY_RUN. O plano é pinado por SHA dentro do script; caminhos/serviço/pins não são parâmetros livres.

## Ordem futura e verificações

1. Conferir authorityprimary/bootatual, serviço existente admin-v2-coordinator.service ativo com User=vigia-coord999/GIDprimário988 e Group do serviço=admin-v2-exec989, worker vigia-worker997/GID986 e grupo suplementar989. Preservar/srv/admin-v2-worker999:989 modo2770 completo (SGID preservado); nunca alterar grupos/permissões globais. Exigir0jobs não-terminais e integridadeSQLite. RevalidarNodeSHA remoto e preimagescore3675926..., launcherbf1f35..., helperausente.
2. Entrada de código privada root-owned em/srv/admin-v2-coordinator/install-inputs-480/code: coordinator.py, runtime_profile.py e launch.py com os hashes4ddb do plan.json. Verificar SHA completo antes de copiar. Runtime grande chega por transporte aprovado separado, nuncaRPC/import-source64MiB.
3. Se o QAroot/srv/admin-v2-worker/admin-r0000-runtime-qa-20261110 já foi staged, apenas verificar owner997/mode0700, inputs/runs privados, runs vazio e TODOS os hashes de scripts/manifestos/runtime.tar. Não sobrescrever/completar transferência parcial. O único extra opcional é.staging-owner.json: descritorNOFOLLOW, regular/nlink1, rootUID0/mode0600, jobcad43 e pins/phase/flags/475678720bytes exatos; ele é preservado, não apagado para passar no guard. Nenhum outro extra é aceito. Se inexistente, pode criar stage de nonce próprio, conferir tudo e renomear atomicamente; origem de harness/inputs privada root-owned no sourceRoot. Stage incompleto ou com execução anterior exige reconciliação do coordenador.
4. Parar somente o serviço coordenador existente; conferir novamente0jobs e preimages. BackupSQLite pela APIonlinebackup e preimages em/srv/admin-v2-coordinator/install-backups-480/LEASEID, modo0700. preimages.json registra os3destinos, inclusive ausência do helper. Guardar bytes/mode/owner dos2arquivos existentes; não copiar diretamente banco aberto.
5. Instalar atomicamente helper→launcher→coordinator, helperprimeiro/coordinatorporúltimo, hashesverificados. Reiniciar somente o serviço existente, conferir novamente saúde/roles/boot/queue e hashes. Não há novo executor, unidade, regraSSH, sudoers, grupo ou autorização global.
6. Em falha, restaurar somente código conhecido a partir das preimages; NUNCA substituir fila atual pelo backupSQLite. Uma mudança de terceiros durante rollback é preservada e o serviço permanece parado para reconciliação. O staging permanece como evidência. Falha pós-restart não provoca rollback cego porque a fila já pode ter recebido trabalho.

O script NÃO submete trabalho. O pai, após revisar a instalação/staging, poderá usar a fila existente com idcad43f085e374bc5876e4cf246ca8572, kindruntime-http-r0000-v1, source_commit0a5f734da4f9b8a35a10a20eaa9fb4fd5adb0e4f. Resultado incerto deve ser consultado pelo mesmoID; não há retry automático.

## Provas e limites

19fixtures aprovadas: dry-run sem mutação, pin do plano, preimage alterada/helper inesperado, backupSQLite comWALativo consistente, ordemhelper/core, rollback preserva evento de fila posterior ao backup, job que aparece depois do stop não é perdido, alteração estrangeira durante rollback ou imediatamente apósstop mantém serviço parado, usuário semroot não aplica, symlink recusado, staging idêntico reutilizadoRO, transferência parcial preservada semoverlay. py_compile passou.

Recibos em evidence/ ficam fora do Git. Os testes injetam caminhos temporários e controladores de serviço fictícios; não comprovam instalação remota. A chamada futura real ainda depende de decisão do pai e da lease existente. Nenhum passo configura assinatura, dispara email, publicaTailnet ou faz deploy na produçãoSP.


Revisão posterior à inspeção do staging real: aceitar opcionalmente o recibo .staging-owner.json que o coordenador criou, preservando timestamps como proveniência e sem impor nova expiração/autorização. Campo jobIntent, pins e flags são validados com tipos exatos. Testes adicionais cobrem marcador válido, foreign/tamper/UIDmodo e symlink; só fixtures simulam metadadosroot, não alteram UID/arquivo da VPS. A separação do primaryGID988 e serviceGroup989 é assertada explicitamente no plano e no preflight, sem modificar grupos do host.


Revisão SGID: a cópia anterior transferida para operator-480 falhou no --check antes de preimages/inputs por exigir0770. A observação correta é UID999/GID989, stat.S_IMODE2770 (decimal1528), SGIDtrue, semlink. Esta revisão exige exatamente2770 e rejeita0770, semchmod. Não sobrescrever operator-480: o coordenador usará um diretório novo operator-480-v3 para os arquivos revisados. Nenhum apply foi executado por este agente.
