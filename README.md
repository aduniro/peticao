# R4 local — rascunho de histórico populado em HTTP real

Estado: PREPARADO PARA REVISÃO, NÃO EXECUTADO. Treze mocks locais aprovados; zero Docker/PG/app/HTTP real executado nesta preparação. Não é prontidão de deploy, homologação de produção, A1 ou gov.br real.

Raiz exclusiva: /mnt/dev/.peticao-r0004-local-history-http-qa-20261111
Entrada: /mnt/dev/.peticao-r0004-local-history-http-qa-20261111/functional_smoke.py
Controle local: /mnt/dev/.peticao-r0004-local-history-http-qa-20261111/local_controller.py
Controle Docker: /mnt/dev/.peticao-r0004-local-history-http-qa-20261111/docker_control.py
Prova: /mnt/dev/.peticao-r0004-local-history-http-qa-20261111/mock-proof/result.json

## Fontes e diferenças deliberadas

A lógica dos19checks HTTP é byte-idêntica ao R4 0ce878406810a4537268e2c7e3c8810e066bd7ef de /mnt/apps/peticao-final/_ops/r0000-cluster-history-native-pg17-r4-20261110/r0002/r0002_harness/functional_smoke.py. O arquivo /mnt/dev/.peticao-r0004-local-history-http-qa-20261111/fixture.cjs também é idêntico; sete fontes SQL e seu manifesto foram copiados do mesmo freeze. PROVENANCE.json registra hashes/origem. O controlador Docker foi extraído apenas das funções de controle qualificadas da tentativa2 R3 local; porta/prefixo/label/cluster_name foram adaptados ao R4. Nenhum WorkerContext, fila remota, geração fictícia ou estado remoto é usado.

Runtime fonte existente: /mnt/dev/.peticao-r0002-production-profile-20261111/export/runtime
Manifesto: /mnt/dev/.peticao-r0002-production-profile-20261111/export/release-manifest.json
SHA manifesto7b853db39899691fef6426d0e2dc1b893a48f14c201fc38eedb6f3df9ade2dc3, commitf55595cd348c23ffe559dba2de9150259db9f1e7,12043arquivos. Não há build, npm, extração ou download. Valida todos os arquivos antes de UMA cópia para a rodada e verifica origem/cópia depois. Tamanho lógico464335026bytes, aproximadamente499687424bytes em blocos4KiB. Preflight usa f_bavail (espaço do usuário, sem contar blocos reservados) e exige2GiB mais a única cópia e64MiB para recibos. Não copia runtime duas vezes.

Node local20.19.2 em /home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node, SHAb9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac. PostgreSQL17.11 Docker, imagem localsha256:665dc7b37ac52a17e298511414c21d23ffa4e6a6ef6225b3e5d59c7afb35e994, --pull=never, sem volume/bind real. Uma bridge normal exclusiva por nonce, containerCPU1/Mem512MiB/PIDs128, PGDATA tmpfs256MiB, rootfs read-only; publish somente127.0.0.1:55485. Next somente127.0.0.1:31385.

Única diferença da guarda funcional: assert FUNCTIONAL_PGDATA agora é o caminho REAL dentro do container /var/lib/postgresql/data. O mesmo valor é conferido por SQL pela fixture inalterada. Não se alega que esse caminho é PGDATA nativo no host. Regras de autenticação, rede, portas, subprocessos, TLS/UDP/DNS/fetch não foram ampliadas. O guard continua cooperativo Node, sem garantia de isolamento OS de egress.

Criação/start e cleanup preservam validação de fases antes/depois de start, labels/UID/nonce, CID/NID conhecidos e imagem fixada. Antes de qualquer schema/app, handshake exige PG170011, databasefixture_only, cluster_name=nonce, data_directory real do container e porta interna5432, tanto por TCP no container quanto pelo TCP127.0.0.1:55485 do host, com cliente Node guardado. Porta publicada não é confundida com inet_server_port interno. Timeout de create/start é incerto, não repete; limpeza/reconciliação somente dos próprios IDs/labels. Nunca prune.

## O que os19checks cobrirão

Histórico sem sessão401; senha errada303 sem cookie; login real do owner fictício303; step-up exigido403; seed explícito do estado step-up após login; histórico com duas versões sintéticas e metadados/ordem; filtro ordinal; dois downloads com bytes/hashes/headers exatos; versão de outro lote404; inexistente404; IDmalformado400; download sem sessão401; login real do leitor fictício303 e step-up semeado; histórico/download negados ao leitor403; inventários base/recibos/artefatos e página de lotes200. São dois logins bem sucedidos mais uma tentativa com senha errada.

Dois PDFs sintéticos são inseridos diretamente por SQL somente na base fictícia, identificados como sem assinatura criptográfica. Nenhuma chamada gera/assina/carrega/prepara/envia documento ou pacote; nenhum fluxo unsigned, IA, contatos, certificado, validador ou provedor real é exercitado. Antes/depois compara contagens e hashes dos documentos/lotes. Login/auditoria/sessões e inicialização lazy de schema acontecem exclusivamente na base fictícia: não é alegação de transação SQLsomenteleitura. O desafio OTP/email não é homologado; step-up é fixture explícita.

## Execução e prova externa

Comando proposto, NÃO EXECUTADO: /mnt/dev/.peticao-r0004-local-history-http-qa-20261111/EXECUTION-COMMAND.txt. Root revisa manifesto, recursos e lease antes de executar. Unidade user fixa peticao-r0004-local-history-http-qa-20261111.service, CPUQuota200%, MemoryMax3G, TasksMax256, orçamento suave600s mais reserva de limpeza120s. RemainAfterExit=yes é obrigatório para reter ExecMainStatus e Result reais antes de qualquer stop. Unhandledsignal/timeout/OOM deve invalidar sucesso.

Após execução, o responsável deve capturar Id/InvocationID/Result/ExecMainCode/ExecMainStatus/ActiveState/SubState/NRestarts reais da unidade retida, os19checks/resultados, outer-result.json e hashes do export. Depois comprovar cgroup sem processos/ausente, portas55485/31385fechadas e ausência dos recursos Docker dos IDs/nonce exatos. Só então poderá parar a unidade retida e liberar lease. `systemctl not-found` e seus valores padrão zero NÃO comprovam exit0. O caso R3 revelou exatamente essa limitação; aqui não será substituída por uma inferência.

A prova autoritativa local é runs/<nonce>/outer-result.json, escrita após exportação técnica. Resultado interno pode ainda conterexit0 se export falhar: coletor deve exigir outer-result+exit real da unidade+drain+hashes. Não editar/repetir rodada falha; preservar e reconciliar. Exportação allowlist não inclui runtime, fonte, dados PG ou configuração/credenciais. Prontidão operacional permanecefalse.

## Ponto seguro para futura prova de navegador (somente planejado)

Não há hook implementado. Ponto proposto: imediatamente após os19checks HTTP, antes de result['after']=fixture('snapshot') e de cleanup. Root está preparando /mnt/dev/.peticao-r0005-auth-history-browser-qa-20261111. Um hook futuro revisado poderia usar o MESMO cookie owner fictício obtido no login real e já com step-up semeado; sem novo login/sessão. Cookie apenas em arquivo0700/0600 ou canal privado, nunca stdout/export/email/Git. Navegação /admin/presidente?lote=1 e histórico/downloads; sem assinatura/OTP/upload/validador. Deve manter snapshot antes/depois, restrição de rede e orçamento/cgroup explícitos. Root decidirá entre qualificar19HTTP primeiro ou revisar esse hook como passo separado. Nada disso foi executado ou incluído como prova dos13mocks.
