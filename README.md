# Operador native R0002 — revisão2 privada

Raiz local: `/mnt/apps/peticao-final/_ops/r0002-native-profile-install-rev2-20261111`.

Deriva do operador originald52d817d041d3848c490b1d4640bf8de7d616c38, preservado sem mudanças em `/mnt/apps/peticao-final/_ops/r0002-native-profile-install-20261111`. Esta revisão prepara código e fixtures; não instala, não faz SSH, não inicia app/PG/HTTP, não submete job e não muda o coordenador compartilhado. appReleaseReady=false.

## Incidentes corrigidos

1. **Stop com efeito e resposta perdida:** a intenção é registrada ANTES da chamada. O erro não é confundido com serviço ativo; quiescência observa inactive/dead/MainPID0 e drenagem real. Se código/fence também estiverem comprovados, a recuperação pode reiniciar o baseline depois de liberar a barreira SQLite. Se o stop não teve efeito, a observação falha e não se afirma recuperação segura.
2. **Escritor RPC durante cópia/rollback:** usa BEGIN IMMEDIATE na própria fila já existente, sem DML. Outra conexão pode ler, mas não gravar. O lock é verificado antes das escritas de código; nenhum snapshot é restaurado sobre a fila viva.
3. **Fencing de geração:** apply exige boot e geração esperados fornecidos pelo responsável a partir do ACK/lease existentes. Roleprimary/armedboot/gen são comparados antes de parar, antes e depois das substituições, antes de rollback/restart e nas verificações finais. Drift preserva código/checkpoint e impede ação automática sob aprovação antiga. Isso não concede autorização, promove coordenador ou cria outro ledger.

## Fases e ponto de transição

- Preflight RO: roles, grupos, parent2770, Node/PG hashes, authority, preimages, inputs e quiescência.
- Acquire da barreira SQLite; revalidação da fila. Registrar stop_requested e parar somente o serviço coordenador existente.
- Com serviço comprovadamente parado e fila ociosa sob barreira: backup SQLite consistente, backup de código e substituição helper→launcher→coordinator. Validar pins, inputs/runtime compartilhado e fence.
- Gravar checkpoint `cutoverQualified=true`, fase `QUALIFIED_CODE_AND_INPUTS_SERVICE_STOPPED`. Só agora o conjunto de código/inputs está qualificado para iniciar.
- **Liberar a barreira ANTES de start/health.** O daemon pode precisar gravar SQLite ao inicializar; esperar saúde segurando lock criaria deadlock. Após esse ponto, admissões normais são permitidas intencionalmente. O pós-start valida serviço/roles/pins/fence e não exige que a fila continue vazia.
- Erro depois da liberação: readquirir a barreira e exigir novamente serviço parado+drenagem+fila ociosa+mesmo fence para rollback. Se trabalho novo já tiver sido admitido, o operador preserva esse trabalho e o código, retorna falha/estado incerto e não reinicia nem restaura a fila cegamente.

A barreira exclui **escritores SQLite** que usam o locking normal, não toda execução RPC, import-source em disco, root externo, mudanças de authority, substituição da própria fila por outro administrador ou uma partição de rede. Requests que aguardavam o writer podem prosseguir depois do ponto de transição; isso é esperado. Os checks boot/gen são fencing cooperativo, não uma trava distribuída de HA. O responsável continua garantindo exclusão operacional, ACK e lease da instalação limitada. Nenhum mecanismo geral de HA foi criado.

## Provas locais

As fixtures usam arquivos e SQLite fictícios. Duas conexões comprovam exclusão de INSERT durante a manutenção e admissão depois da liberação. Um serviço fake grava SQLite durante start, comprovando liberação anterior e ausência daquele deadlock. Outros cenários cobrem stopcomefeito+timeout, stopsemefeito, perda de resposta start, queuedjob após transição, deriva de geração depois do stop e após troca atômica, preimages estrangeiros e recusa de contexto esperado antes de staging.

Comando local que executa apenas mocks:

`/usr/bin/python3 /mnt/apps/peticao-final/_ops/r0002-native-profile-install-rev2-20261111/validate_revision.py`

Dry-run local (não inspeciona o host nem cria diretórios):

`/usr/bin/python3 /mnt/apps/peticao-final/_ops/r0002-native-profile-install-rev2-20261111/install_native.py`

As24 provas herdadas e10 casos novos são34 testes distintos; não contar a repetição por herança da primeira tentativa como58 cenários independentes.

## Apply futuro — exemplo para revisão, NÃO executado

Caminho remoto ainda proposto: `/srv/admin-v2-coordinator/operator-r0002-native-rev2`.

O responsável deve primeiro criar/verificar o staging autorizado, obter --check e usar os valores boot/gen vinculados ao ACK existente. Os placeholders abaixo precisam ser substituídos; não são valores atuais verificados:

`/usr/bin/systemd-run --unit=admin-v2-native-profile-install --wait --collect --property=User=root --property=Group=root --property=RuntimeMaxSec=900 --property=TimeoutStopSec=120 --property=KillMode=control-group /usr/bin/python3 /srv/admin-v2-coordinator/operator-r0002-native-rev2/install_native.py --apply --lease-id LEASE32HEX_DO_ACK --expected-generation GERACAO_DO_ACK --expected-boot-id BOOT_UUID_DO_ACK`

A unidade limitada/fixa e o protocolo externo continuam obrigatórios; o script não chama systemd-run, sudo ou SSH, não valida tokens secretos e não cria autorização. O checkpoint desta revisão usa `/srv/admin-v2-coordinator/install-backups-r0002-native-rev2/<lease>`, sem reutilizar diretório de uma tentativa anterior.

## Staging e futura combinação R4+R3

O plan.json permanece específico do candidato **R4 de histórico**0ce878406810a4537268e2c7e3c8810e066bd7ef e conserva os pins/installpaths examinados do planod52. A revisão de manutenção não troca silenciosamente o conteúdo do perfil a instalar.

- R4: este plano ainda é apenas preparação;80 fixtures anteriores não equivalem ao histórico populado19HTTP real.
- R3: não está incluído neste installOrder. O adaptador/harness de gates, suas correçõesTERM/limitesSWC e a integração na mesma fila continuam com os respectivos autores. Provas R3 locais não fazem este operador instalar R3 nem homologar o R4.
- Combinação futura: congelar um commit comum da fila com R4+R3, revisar os dois imports/ramos e coleta, produzir novos hashes old/new/stage e atualizar o plano/ACK antes de aplicar. Este operador recusa preimage diferente; não sobrepõe uma versão mais recente por conveniência.

Runtime comum proposto permanece `/srv/admin-v2-worker/admin-r0002-runtime-qa-20261111/inputs`, SHA2952a2b0d7ffb06b553caa03fdb3d8546981a96118a1cc9aa0ca47da4adc8ee0, manifesto7b853db39899691fef6426d0e2dc1b893a48f14c201fc38eedb6f3df9ade2dc3. Nenhuma cópia475MB é feita pelo operador. Existência, owner0700 e hashes remotos dependem de staging/reciboRO/ACK futuros; não foram comprovados aqui.

Nenhuma conclusão de prontidão de deploy, instalação remota ou homologação A1/gov.br decorre desta revisão.
