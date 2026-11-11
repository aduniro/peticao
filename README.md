# Perfil fechado de histórico — R0002 / f555

Draft privado: /mnt/apps/peticao-final/_ops/r0000-cluster-history-native-pg17-r4-20261110/r0002, branchinfra/history-native-pg17-r0002-v1. NÃO instalado ou integrado. Fonte infra instalada de comparação4ddb04347bbcb63b6be61185f1ff488f10a59b9d; perfil runtime-http-r0000-v1 preservado, inclusive helperSHAafcb73273b0f35835012ec9a5a523114afc2da2566d20a30f8c05c47647aa3b8.

A fotografia anterior R4/0a5 está preservada no commit do diretório pai (ver evidence/r0002-input-provenance.json). O originalca53ba684fc4021760069e6f79a1ca75475d3e6b não foi modificado. Os testes daqui são novos e sintéticos; nenhuma qualificação funcional anterior é atribuída ao R0002.

## Entradas vinculadas

- Aplicação/source:f55595cd348c23ffe559dba2de9150259db9f1e7.
- Runtime fornecido pelo coordenador:/mnt/apps/peticao-final/_ops/releases-admin-publico/r0002/runtime/runtime.tar,475576320bytes, SHA2952a2b0d7ffb06b553caa03fdb3d8546981a96118a1cc9aa0ca47da4adc8ee0.
- Manifesto:/mnt/apps/peticao-final/_ops/releases-admin-publico/r0002/runtime/release-manifest.json, SHA7b853db39899691fef6426d0e2dc1b893a48f14c201fc38eedb6f3df9ade2dc3, releaseIdr0002-portable-f55595c-20261111 e12043arquivos.
- Os7schemas foram extraídos por gitshow do MESMOcommitf555; manifesto dentro de r0002_harness/schema-source-manifest.json. petition-base-schema temSHA25ea67..., não o schema0a5d21a....
- Node remoto fixo/usr/bin/node20.19.2/ABI115/NAPI9/SHAca0728526aa1cc4e3056decec848ecc6d2c5391cecdd4e21a0ebd221d665c84e.
- PG17.11 nativo:/usr/lib/postgresql/17/bin. Os5SHA256root0:0/mode0755 foram capturadosRO pelo coordenador e congelados em r0002_harness/pg-binary-pins.json. A versão e os hashes são exigidos ANTES de initdb/start; nada instala ou atualiza binários.

O arquivo grande não foi re-hasheado localmente nesta tarefa para evitar trabalho pesado; a declaração do coordenador está registrada, e o worker exigirá seu hash completo antes de extrair. Manifesto e7schemas foram verificados localmente. Runtime+harness são artefatos separados de Git/import-source64MiB; não se fabrica um checkout de fonte no worker.

## Contrato da MESMAfila

Único novo kind:history-native-pg17-r0002-v1. Submit somenteaction/id32hex/kind/source_commitf555. Não aceita comando,shell,path,environment,duração ou arquivo livre. Admissão apenas normaliza constantes esperadas: não lê staging0700 de outroUID nem atesta bytes. Config/payloaddigest,idempotência,execuçãoúnica,geração/boot,execution.started,cancel e exportação continuam na fila instalada. O kindR4antigo nunca é registrado nesta revisão.

STAGE futuro fixo:/srv/admin-v2-worker/admin-r0002-history-native-qa-20261111,ownerworker997/mode0700, com somente arquivos do novo profile-manifest.json e esse manifesto. O runtime é entrada compartilhada PROPOSTA, não atestada: /srv/admin-v2-worker/admin-r0002-runtime-qa-20261111/inputs/runtime.tar e release-manifest.json, ambos hashpinados; raiz/inputs devem ser privados0700/worker997. É o mesmo caminho provisório proposto pelo agenteR3 para evitar cópias duplicadas; staging e reciboRO ainda pertencem ao coordenador. Receitas de transporte/lease do operador ficam FORA desse pacote imutável; arquivos/diretórios extras ou symlinks são rejeitados. Como o pai/srv/admin-v2-worker é2770, qualquer diretório NOVO desse staging deve ser normalizado para0700 pelo operador com proveniência, semchmod nos pais/preexistentes. Nenhum staging foi criado por este agente.

O worker confere todos os pins, Node/PGbinários e runtimeantesdeprocessos, valida autoridade/boot/geração/configdigest e marcador da fila real. Copia código para /srv/admin-v2-worker/jobs/ID/work/history-native-r0002 (novo e0700, limpando SGID só nesse diretório recém-criado). Extrai o runtime com helperpinnado, conferindo manifestoexterno/interno,nomes/tipos/tamanhos/hashes de12043arquivos antes de criar árvore; o runner repete inventário e schemahashes antesPG.

O entrypoint adaptado exige contexto tipado do job/cgroup/configdigest. NÃO leva tokens,active-lease,SQLitelocal,COORD_PREFIX ou falseforwarder de autorização ao worker. Leases/ACKs permanecem no coordenador responsável pelo protocolo existente.

## Execução e limites

2CPU,3GiB,swap0,256PIDs. Execução600s+grace120s=teto720s, KillModecontrol-group. O perfil480continua120s/15s,3CPU/5G; os genéricos ficam7200s/15s,3CPU/5G. Nenhuma nova unidade,executor,sudo ou autorização é criada.

O NativePG só usa PGDATA novo no própriojob,nonce e socketprivado/tmp/history-pg-NONCE. ConferePGPID/startticks/uid/cgroup/argv/cluster_name/data_directory/port55485 antesSQL e antesdeparar; nunca adota ou apaga clusterexistente. Next usa somente127.0.0.1:31385; a base é fixture_only. Somente login fictício e19checksHTTPdo histórico/API/2PDFspreparados são planejados. Stepup é semeado explicitamente emSQLdepoislogin; emailchallenge/assinaturas reais e browser não são cobertos.

SIGTERM durantecleanup é registrado sem interromper a drenagem/recibos normais. Wrapper confereidentidade antesde sinalizarfilho; exceção/ausência de resultado é falha, nunca sucesso. Para completed exige19checks exatos,guardInstalledtrue,guardDenials0,hashesruntimeestáveis,PGstopped/socketremoved,nenhumfilho restante no cgroup alémworkerprincipal+wrapper,schemas/PGpins/contextoexatos ePDFs sintéticos com SHAcorreto.

Exportador usa somente allowlist derecibos/resultados/guard/lifecycle/manifestos/PDFs sintéticos para work/artifacts,máximo32MiB/16MiBporarquivo,arquivos660. Não copiaPGDATA,pgpass,initdb-password,runtime,SQLiteoulease. Exporta prova específica da extração. O supervisor/operador ainda deve conferirporta/cgroupfechados apósresultado. Nunca há retryautomático ou deploy/publicaçãoTailnet.

## Evidências locais e pendências

71fixtures passaram:38fila/perfis,33harness(21lifecyclePGmock,8extraçãosintética,4preflight). Após acrescentar recibo obrigatório de extração,13testsdirigidos do perfil passaram novamente. ZERO19HTTPreais; ZEROprocessoPGreal; semSSH,instalação ou execução da aplicação. Falhas locais intermediárias de fixture preservadas foraGit; uma coorte de fila levou213s sob pressãoIOlocal, sem extrapolar estimativa para Santiago.

O bloco dos19checks é preservado do harnessca53; o gate/entrypoint/schema/runtime/contexto foram adaptados e precisam revisão específica. Este pacote não é operacionalmentehomologado e não comprovaA1/gov.br real, frontendbrowser ou prontidão de deploy. Próximo passo é revisão/ACK/lease e staging/install separados pelo coordenador; não foram feitos aqui.

Não houve ensaio de rollback do banco da aplicação; rollbackpending do catálogo continua pendente. Criar uma base fictícia nova não homologa upgrade/rollback de dados existentes.
