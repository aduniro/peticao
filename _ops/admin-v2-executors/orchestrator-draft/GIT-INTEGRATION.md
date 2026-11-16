# Transporte Git e integração isolada — implementação local, desativada

Código: `/mnt/apps/peticao-final/_ops/admin-v2-executors/orchestrator-draft/git_transport.py` e `/mnt/apps/peticao-final/_ops/admin-v2-executors/orchestrator-draft/integration.py`.

**Não há cluster ativo.** A configuração entregue em `/mnt/apps/peticao-final/_ops/admin-v2-executors/orchestrator-draft/config.json` continua com execução desativada, Santiago desabilitado e identidades físicas não configuradas. Nenhum clone real, VPS, SSH, serviço, chave ou aplicação foi alterado pelos testes deste módulo.

## Contratos de API

`RepositoryPolicy.from_config(config,host_id)` usa o contrato central e só permite clones independentes sob a raiz do host. `ready_proof(record,config)` valida o READY central; quando execute=True, o guard também exige execução/host habilitados, configuração correspondente, prazo válido e SHA da máquina física igual à configuração e ao READY. São Paulo/produção não pode ser destino operacional. O registro READY é declaração coordenada com identidade física, não atestação remota criptográfica criada por este módulo.

`export_bundle(policy,repository,base,candidate,source_ref=None,execute=False,ready=None)` valida limpeza e todo o histórico novo, exige branch congelada permitida apontando ao commit e cria bundle somente se execute=True. Não escreve refs na origem nem copia seu working tree. Se base=candidate, retorna noop. O bundle contém commits/objetos, nunca arquivos não commitados, bancos, dependências ou builds do disco.

`import_bundle(policy,repository,bundle,bundle_sha256,base,candidate,destination_ref,expected_old=None,execute=False,ready=None)` verifica SHA/header/pré-requisitos. Em execução, usa clone de quarentena independente, valida todos os commits novos, recusa objetos extras inalcançáveis e só então importa um bundle sanitizado ao destino. Avança exclusivamente staging `worker/admin-v2-*` com CAS; recusa ref checked-out. Bundles devem estar na área `.bundles` da raiz configurada. A cópia física dos bytes entre hosts pertence à infraestrutura autorizada; esta biblioteca não abre SSH ou rede externa.

`prepare(policy,config,repository,integration_ref,expected_base,candidate,execute=False,ready=None)` inspeciona o merge em dry-run; execute=True cria branch temporária `worker/admin-v2-merge-UUID`, faz merge normal numa worktree isolada, cria o commit combinado e remove a worktree. A ref de integração não avança. Uma integração já incorporada resulta em noop. Conflitos deixam relatório com caminhos, versões de blobs dos três estágios, base e candidato; não são resolvidos automaticamente. Hooks, rerere e drivers externos não são executados. A branch temporária preparada é mantida como fonte congelada do job de QA.

`promote(policy,config,prepared,queue,job_id,execute=False,ready=None)` chama `Queue.completed_receipt(job_id)`, relê os artefatos e seus hashes pelo contrato central e exige commit/build exatos do **merge combinado**, cobertura completa do tipo de job, todos os checks aprovados, árvore de origem completa, wrapper versionado e package-lock do commit. Apenas então execute=True pode avançar `integration/admin-v2-*` com `git update-ref` CAS. Resultado de QA incerto ou evidência ausente/reprovada não avança referência. Uma ref concorrente mais recente não é sobrescrita. Não existe caminho para promover main/master/live/prod ou fazer deploy.

## Manifesto de origem

`tree_manifest(repo,commit,policy)` produz um mapa de TODOS os arquivos rastreados `{caminho:{mode,sha256}}`; `digest(map)` usa JSON canônico. Esse digest deve ser usado em `source_manifest_sha256` do job que testa o merge. Modo executável e symlink também fazem parte da prova. Wrapper e package-lock são adicionalmente conferidos como blobs versionados.

As proteções de caminhos/histórico impedem transportar áreas conhecidas de segredos/runtime/bancos/builds/dependências, inclusive um arquivo proibido commitado e depois removido antes do tip. Não são um detector universal de credenciais embutidas num arquivo fonte permitido. A política do projeto de jamais commitar segredos permanece necessária. Clones com alternates/hardlinks, filtros/drivers de merge/diff externos ou atributos locais são recusados; symlinks absolutos/escapando da árvore e submódulos também.

## Evidência e limites reais

Os testes em `/mnt/apps/peticao-final/_ops/admin-v2-executors/orchestrator-draft/tests/test_git_integration.py` usam Git real e SQLite/artefatos de fila **fictícios sob /tmp**. Os wrappers de fixture nunca são executados. Eles comprovam gates/CAS e manejo de Git, não a correção semântica da aplicação. Os jobs reais ainda precisam executar os wrappers aprovados no executor isolado e produzir provas genuínas antes de qualquer promoção.

Nenhum job fornece shell/argv livre a estas funções. Não existe runner neste módulo. A CLI da fila apenas grava/consulta metadados locais; a ativação do executor/SSH e o handshake pertencem à outra sessão de infraestrutura. Operadores não devem editar/checkout manualmente os clones durante integração; a coordenação do executor deve mantê-los exclusivos. CAS continua sendo a autoridade contra avanço concorrente da ref.

Teste reproduzível, sem aplicação/PG/provedor/deploy:

```sh
/usr/bin/env --chdir=/mnt/apps/peticao-final/_ops/admin-v2-executors/orchestrator-draft /usr/bin/python3 -m unittest discover -s /mnt/apps/peticao-final/_ops/admin-v2-executors/orchestrator-draft/tests -p test_git_integration.py -v
```

Se houver interrupção após update-ref e antes do relatório final, o resultado da promoção exige consulta à ref e ao receipt antes de repetir qualquer ação. O CAS impede sobrescrever um novo avanço, e a API aceita observação da ref já no mesmo commit testado. Esse comportamento não é recuperação distribuída de execução de QA nem justificativa para reiniciá-la automaticamente.
