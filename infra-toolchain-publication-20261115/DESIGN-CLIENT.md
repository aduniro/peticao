# Client Root installer — fonte e fixtures sem rede

Escopo exclusivo: client.py, test_client.py e este documento em `/mnt/apps/peticao-final/infra-rootinstaller-client-20261115/source`. Nenhum Gate, packet Owner, manifesto externo, lease, host, implantação ou capacidade foi criado/modificado/invocado.

Referências lidas como DADO:

- `/mnt/apps/peticao-final/infra-rootinstaller-client-20261115/OPERATOR-INTERFACE.reference.json`, SHA9345cef30e93c5e097a549d3d8bca59d44685737ee444a98e0304b221c907063.
- `/mnt/apps/peticao-final/infra-rootinstaller-client-20261115/WIRE-SCHEMA.reference.json`, SHAda85ba434599d7fff14c513c5a70005e61233cdc67c084036e70141a932a8b61.
- `/mnt/apps/peticao-final/infra-rootinstaller-client-20261115/DECISIONS-OPERATOR.reference.json`, SHA0c9edf470e7e51c4a675e384df30b73a734273d0bbd52f782271b11048508231.

## Superfície e autoridade

Client default usa `denied`; install/observe chamam o guard PRIMEIRO, antes de arquivos, diretórios, pin reads ou transportes. OwnerContract sem template recusa IntegrationPending. O CLI de produção continua fechado e sem leitura de argv/arquivos ou SSH. PinnedSSH também fica fechado por padrão. Não há aquisições de lease ou leitura de chave privada no código: o caminho fixo da identidade só aparece na configuração pública do futuro SSH.

OwnerContract é concreto, sem callbacks de validação produtivos. Recebe somente o template canônico revisado de15 chaves, com execution_notice=0 e deadline_unix=0 literais. O Gate deve devolver `{action,execution,authority}` público estável, sem token: authority contém session/execution_event/source_notice/root_window_notice/fence/lease_expires/window_closes; execution contém operation_id, payload_sha256/bytes/path e header_template já reparseado, header_path/header_sha256/header_bytes do template canônico e remote_code_sha256 dos dois blobs públicos. O source_notice do header é autenticado pelo template pinado; authority.source_notice pode nomear a fonte separada do operador. Session e escopo são fixos; todos os demais campos do header devem coincidir byte a byte após restaurar os dois zeros. Payload deve ser o arquivo relativo exato do packet indicado pelo Gate.

`prepare(grant)` liga execution_notice ao evento canônico já consultado pelo Gate, sem prever seq. Gera deadline uma única vez: min(now+900,lease.expires-120,window.closes-120), exigindo ambas as margens>=1020s. A callback Gate é revalidada imediatamente antes de CADA subprocesso SSH; identidades públicas devem continuar iguais. Gate/central indisponível é recusa redigida, nunca autoridade implícita.

Observe não troca janela nem evento: usa os mesmos bytes concretos persistidos, inclusive deadline já expirado, e exige a janela original ainda corrente e cap própria viva. Autoridade vencida/bloqueada não é contornada. Não há busca ou abertura automática de outra janela. Uma resposta já recebida pode ser registrada sem exigir uma NOVA margem1020; isso não faz outra troca de rede nem renova autoridade.

## Persistência/no replay

Estado fixo é `Path(__file__).absolute().parent/execution-state`, com packet próprio0700, state0700 e arquivos600. Parent deve Gitignorar execution-state/ e test-state/ ANTES de congelar, para que efeitos locais não invalidem o guard Git clean. Esse .gitignore não pertence ao escopo deste autor.

Install persiste os bytes canônicos exatos em install-header.json com O_EXCL/fsync, depois install-intent.json exclusivo/durável, depois chama transporte. Intenção só contém hashes/tamanho/ação, nunca grant/cap/token/header arbitrário. Qualquer resposta perdida, recusa após intenção, SourceExit falho, timeout ou erro mantém intenção e proíbe novo install. Só observe RO é repetível. Receipt só é publicado após reply com whitelist exata e hash/stat final do MESMO fd do payload; o state fd fica aberto nessa verificação.

Header e intent parciais ou existentes nunca são sobrescritos/removidos. Uma instalação incerta pode produzir um receipt com estado explicitamente incerto; existência de receipt não é sucesso nem prontidão. Apenas os estados seguros do Owner são devolvidos, com false flags preservados.

## Framing e transporte

Wire: uint64 big-endian de8 bytes indicando tamanho do header canônico<=2MiB, header em chunks<=64KiB e payload comprimido exato em chunks<=64KiB. Não existe concatenação do payload inteiro. Observe não envia payload. Tamanho/SHA/tipo/owner/nlink/mode e ancestralidade NOFOLLOW do arquivo são conferidos antes de enviar; tamanho/SHA dos bytes enviados e hash/stat/named identity do mesmo fd são revalidados ao sair. Nenhum arquivo recebido é importado ou executado.

Rootremote code é construído exclusivamente dos dois blobs públicos materializer.py/root_entry.py com SHA/size aprovados no manifesto. Ambos são lidos/verificados como dados locais, limite conjunto64KiB e command96KiB. Bootstrap usa ModuleType com nomes próprios, insere sys.modules antes de compilar/exec, e chama dispatch install|observe explicitamente; não usa __main__ nem tar como código. O contrato confirmado do Owner retorna dict de dispatch: o bootstrap imprime uma única JSONline. Exceções geram somente state INSTALL_UNCERTAIN_PRESERVE_ALL_NO_RETRY e error_type público, com exit1, sem repr/traceback. O transporte aceita exit1 somente para essa variante exata. O recheck do Gate imediatamente pré-Popen também compara os dois remote_code_sha256 aos blobs já verificados. O CLI e o transporte padrão permanecem fechados.

SSH é fixo para100.122.224.82:22, HostKeyAlias212.2.241.70, known_hosts/pin do interface. Desabilita config de usuário, mux, agent, forwarding, proxy e password prompts. Apenas o futuro SSH lerá a identidade fixa; o client não copia seu conteúdo. Stderr é DEVNULL, descartado durante execução. Reader paralelo drena stdout e guarda no máximo32KiB; writer separado faz streaming. Timeout/OSError/argv/stdout/stderr nunca são propagados como texto de erro, apenas estado público incerto. Local SSH pode ser encerrado por timeout; isso não significa stop remoto nem autoriza retry.

## Replies e limites

Variantes exatas/matrix install versus observe seguem DECISIONS; chaves extras são rejeitadas. Writer tem somente pid inteiro positivo, start_ticks STRING decimal ASCII positiva canônica e boot_id igual ao header original. operational_ready/native_profiles_qualified/queue_cutover/candidate_programs_executed são sempreFalse; no_retry, quando presente, sempreTrue. Prefixo/publicação/contadores/operation/source/execution são vinculados ao header. Não se presume sucesso pela forma de mensagem ou log remoto.

Validação local até esta revisão:31 fixtures PASS/0,135s com `/usr/bin/python3 -B -W error::ResourceWarning -m unittest -q test_client`, TMPDIR em `/mnt/apps/peticao-final/infra-rootinstaller-client-20261115/source/test-state/tmp`. Gate/Owner/SSH são simulados; apenas filesystem privado local. O teste de IO do bootstrap executa exclusivamente dois módulos sintéticos públicos construídos dentro da fixture, verifica uma JSONline, retorno não-dict e exceção redigida/exit1; nunca carrega os módulos reais do Owner. Houve um run intermediário com erro de escopo de nomes no fake FixtureContract, corrigido exclusivamente nos testes e sem efeitos externos. Nenhum SSH, Root invocation, materializer real, host/deploy, pacote candidato ou payload de produção foi executado. qualified permaneceFalse.
