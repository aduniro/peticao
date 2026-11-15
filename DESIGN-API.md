# Proposta do produtor offline público UID1000

Estado: código/proposta somente; execução real exclusivamente pelo parent após revisão local e manifesto. Não é provider runtime, instalador Root, qualificação de cache ou autorização de host/app/banco.

## Entradas e saída fechadas

- Ingress DADO, nunca código: `/mnt/apps/peticao-final/_ops/infra-coordenacao-20261112/distributed/civo-qualification-20261114/dependencies-node20-pdfjs.public.tar.gz`. SHA256 `3009712141b019777b6395e36a628f4e1c0b8720fb617e4ffe5c814d91670698`, exatamente207013889bytes.
- Papel operacional explícito: UIDreal=UIDefetivo1000; nenhum parâmetro de owner/fixture, sudo, chown ou relaxamento do providerRoot.
- TCB novo: `/mnt/apps/peticao-final/infra-public-inputs-20261115/producer-source`, protegido0700/arquivos sem escrita grupo/outros; basesV2 copiadas pelo parent do commit`32cce868127cb586cf5d314e429f0c3abbf0b6a5`, verificadas por SHA antes de importar. Nenhum código é importado de `_ops`.
- Novo staging fixo e exclusivo0700: `/mnt/apps/peticao-final/infra-public-inputs-20261115/staging-1`. Recusar se qualquer estado já existir, inclusive tentativa parcial.
- Arquivos novos exclusivos0600: `/mnt/apps/peticao-final/infra-public-inputs-20261115/staging-1/parent.input.tar.gz`, `/mnt/apps/peticao-final/infra-public-inputs-20261115/staging-1/dependencies.normalized.tar.gz`, `/mnt/apps/peticao-final/infra-public-inputs-20261115/staging-1/NORMALIZATION-RECEIPT.json`; nenhum overwrite/delete/retry automático.

## API proposta

`produce()` sem argumentos operacionais arbitrários e CLI sem argumentos. O entrypoint valida o papel1000 e TCB fechado antes de carregar as bases. Template Git `/mnt/apps/peticao-final/infra-public-inputs-20261115/producer-source/PRODUCER-POLICY.json` permanece obrigatoriamente `execute=false`; editá-lo para true é recusado como bypass. A execução somente pode ser habilitada pela live policy fixa fora do Git `/mnt/apps/peticao-final/infra-public-inputs-20261115/PRODUCER-EXECUTION-POLICY.json`, publicada pelo parent após revisão e manifesto. Se esse caminho existir (incluindo link quebrado), ele é selecionado e validado integralmente; entrada inválida nunca permite fallback. Se ausente, usa-se somente o template falso. Ambos exigem UID1000/no022, shape fechado e hashes de self/bases. O produtor/testes não criam a live policy real. Testes locais usam arquivos fictícios sob caminho absoluto separado e somente helpers genéricos de parsing/FD; não usam `_expected_uid`, monkeypatch de guards ou o tar real.

## Protocolo de FDs e durabilidade

1. Validar closure própria e basesV2 com FD NOFOLLOW, regular/nlink1, owner/perms, tamanho/hash e stat estáveis antes de importar. ProviderRoot original fica byteidêntico.
2. Abrir ingress por caminhada dirfd sem symlinks. Ancestrais de DADO `_ops`775 não são TCB; essa exceção não se aplica ao código/staging. O FD regular UID1000/nlink1 sem writegrupo/outros deve bater tamanho/hashliteral, antes/depois, e a entrada nomeada/ancestrais devem continuar vinculados.
3. Criar staging exclusivo0700 fora `_ops`; registrar intent durável. Copiar os bytes do MESMOFD ingress para novo FD0600, computando SHA nessa passagem; fsync cópia+diretório. Nunca extrair ou executar bytes do tar.
4. Rehash independente da cópia no mesmoFD; inventariar/normalizar/validar/hash do output mantendo esseFD da cópia aberto. Chamar algoritmo V2 `_inventory`, `_produce` (equivalente ao write-output citado) e `_validate_output`; não chamar API operacional `normalize_dependencies(..._expected_uid=...)`.
5. Preservar exceção única esbuild, 22symlinks, limites/grafo/preimages/ordem e regularização metadados UID0/GID0/mtime0/gzipmtime0 conforme V2. Nenhum hardlink é criado no filesystem.
6. Validar fstat+entrada nomeada da origem, cópia e output depois de todo consumo, além da closure. Só então escrever recibo exclusivo0600 e fsync arquivo/diretório. Se houver falha ou reply perdido, manter intent/parciais e recusar repetição no mesmo staging.

## Recibo e limites

O recibo liga papel1000, sourceclosure/basecommit/basehashes, ingressSHA/size, copySHA/size, outputSHA/size e entrymap completo/preimages/manifest estrito. Mantém `qualified=false`, `cache_integrity_verified=false`, `root_install_performed=false`. Não atesta cgroup/stop/custody/providerRoot e não usa UID1000 de fixture como autorização runtime.

Não executa Node/Python do tar, package scripts, ferramentas de app, PostgreSQL, Chromium, downloads ou serviços. Rootinstaller futuro deverá verificar o pacote completo e promover uma NOVA cópia Root sob autorização separada; o produtor não faz essa etapa.

## Closure sem circularidade

O template e a live policy possuem `source_files` com SHA/tamanho do wrapper e das duas bases congeladas. O wrapper não embute o hash da policy; o manifesto externo do parent sela o hash da policy live, e o recibo registra esse mesmo hash. `produce()` revalida policy selecionada e closure após normalização e antes do recibo; alteração/desaparecimento da live policy recusa conclusão, preservando parciais. A policy executável real fica fora de `/mnt/apps/peticao-final/infra-public-inputs-20261115/producer-source` e nunca é arquivo versionado do produtor.
