# Revisão independente do driver e produtor offline

Revisão estática em 15/11/2026, durante o preparo da fonte714. Escopo: bootstrap, contrato, fases/recibos, no-replay/cancel/drain e produtor de candidatos. Fontes principais:

- `/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-20261115/source/driver.py`
- `/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-20261115/source/freeze_driver.py`
- `/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-20261115/source/driver_contract.py`

Foram lidos os testes correspondentes e as interfaces dos helpers para conferir composição. Nenhuma suíte foi repetida, nenhum teste novo foi executado e nenhum módulo operacional foi invocado nesta revisão. A única escrita do revisor é este relatório. Sem app, PG, browser, systemd, host remoto, instalação, commit ou ledger.

## Achados encontrados e corrigidos durante a revisão

1. **Resolvido: relatório raiz exigido pelo worker.** A primeira versão publicava apenas recibos sob artifacts e retornava exit code; não satisfazia o `result.json` raiz esperado pelo worker: `{protocol:1,profile,exit_code}`. A fonte atual em `/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-20261115/source/driver.py:257` inspeciona os artefatos antes de criar esse relatório separado, com três campos exatos, O_EXCL/O_NOFOLLOW, modo0600 e fsync do arquivo/diretório. Conferida a correção estaticamente, incluindo o teste de relatório de sucesso/falha e separação da allowlist. O coordenador informou 13 testes de driver PASS; não foram executados novamente pelo revisor.

2. **Resolvido: TOCTOU do diretório de saída no produtor offline.** A primeira versão abria cada saída pelo pathname completo após checar ancestrais; O_NOFOLLOW protegia somente o componente final. Um escritor não-root do diretório pai poderia trocar output por symlink e redirecionar um produtor privilegiado. A fonte atual em `/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-20261115/source/freeze_driver.py:62` percorre/segura parent por dirfd com NOFOLLOW, cria e abre output por esse fd, confere owner/modo/identidade, faz as três escritas por outfd e fsync dos mesmos diretórios. As duas verificações finais de identidade recusam substituição e preservam a saída parcial. O teste novo injeta a troca durante a primeira escrita e exige destino estrangeiro intocado; foi lido, sem execução pelo revisor. O coordenador informou oito testes de freeze PASS. Root administrativo e escritores do mesmo UID continuam TCB; não se alega CAS contra eles.

## Contratos conferidos sem novo bloqueio

- `/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-20261115/source/driver.py:79`: o bootstrap exige caminho/interpreter fixos e flags isolado/no-site/no-bytecode. Carrega o verificador inicial por bytes hashados, valida JSON sem chaves duplicadas/não-finitos e exige liberação explícita antes do fechamento. Compara os bytes do próprio verificador aos bytes retornados pelo fechamento. Helpers são compilados dos bytes retornados, sem reabrir seus caminhos para importação.
- `/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-20261115/source/driver.py:25`: a ordem atual de carga satisfaz os imports entre helpers. Todos os bytes do fechamento são verificados antes de executar qualquer helper subsequente; módulos preloaded são recusados. A inserção em sys.modules antes de exec permite a declaração dataclass do supervisor.
- `/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-20261115/source/driver_contract.py:108`: planos atuais e validador selado concordam em QA100 como fase única e nove qa_steps internos. O bootstrap rederiva os planos, em vez de aceitar argv/env/cwd livres. O digest do descritor inteiro permanece diferente do digest do plano; readiness continua false.
- `/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-20261115/source/driver.py:114`: o StateDirectory deve estar novo, com owner/modo privados e identidade de nome fixa. A inicialização é exclusiva; falha de fase interrompe as seguintes. Cancelamento produz falha e passa pelo drain; interrupção durante o próprio cleanup pode deixar estado preservado para o runtime. Não há replay automático.
- `/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-20261115/source/driver.py:196`: recibos de fase são validados antes de entrar no resultado; recibos finais passam pelo schema e pela inspeção de artefatos. Exceções não exportam seus valores crus. O drain é explicitamente de filhos diretos, sem alegar cgroup vazio, netos terminados, stop Root, custódia ou retirement.
- `/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-20261115/source/freeze_driver.py:17`: render vincula bytes da política e programa sem ciclo de self hash; candidatos continuam não qualificados. O produtor exige fechamento antes de começar a saída; publicação parcial não recebe recuperação automática ou sobrescrita.

## Limites da conclusão

Parecer SOURCE ONLY. Não confirma capacidade futura, instalação do toolchain, bibliotecas externas do SO, adequação real de Chromium/IPC/network guard, execução QA100, retenção do systemd ou compatibilidade operacional de um sucessor ainda não qualificado. Links públicos de Python/Chrome/PG continuam recusados pelo fechamento e precisam ser materializados pelo produtor. Somente orquestração/fechamento estáticos foram avaliados; contagens de testes do coordenador não são execução independente desta revisão.

## Disposição final

Sem bloqueio técnico concreto pendente no escopo estático examinado após as duas correções acima. Não é autorização de instalação/execução nem voto/ACK. O coordenador informou suíte composta de 198 testes PASS/4,121s e 26 AST; esta revisão não repetiu essas verificações.

Bytes principais ao fechar a revisão:

- `/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-20261115/source/driver.py`: SHA256 `b9d56f5f0ceb8ddf9b1b49c046e82194a65f7ead26029bc54a5d149550d2061c`.
- `/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-20261115/source/freeze_driver.py`: SHA256 `ded68969c2ddee3d8f39197602b646ed4ecdaf4abc6f305afebf45b430463cc2`.
- `/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-20261115/source/driver_contract.py`: SHA256 `789e2d6c54593eac06a22843c3adc8c84b84372a1debaadb0d0c68c438245265`.
