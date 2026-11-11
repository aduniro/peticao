# R0003: cinco recusas reais da rota gov.br — harness privado

**Estado: draft local; não instalado, não registrado na fila, não executado com aplicação ou PostgreSQL.**

Fonte Git exata `93557bfba931f8f731807fc9f30f1d88dbafedf1`, cujo backend é o commit integrado `f55595cd348c23ffe559dba2de9150259db9f1e7`. As cinco callbacks são exclusivamente `session`, `level`, `stepup`, `origin` e `rate`, no arquivo `site/src/lib/petition-base-route.test.ts`. O regex ancorado e um processo Node novo impedem executar as outras callbacks definidas nesse mesmo arquivo. Imports estáticos necessários desse arquivo continuam sendo avaliados; o conjunto não é uma sandbox de módulos hostis.

Não se trata de homologação ICP-Brasil A1/gov.br, envio, aprovação, contatos/IA ou liberação do fluxo sem assinatura. As cinco rotas devem recusar o POST antes de registrar intenção; o GET exato posterior deve comprovar ausência. Os testes usam somente dados sintéticos, provedor HTTP fictício de loopback e e-mail dev. O provedor fictício deve registrar zero chamadas; os próprios testes conferem ausência de mensagens/envios. Nenhum validador ou endereço real é configurado.

## Arquivos locais

Raiz: `/mnt/apps/peticao-final/_ops/r0003-govbr-route-nativepg-harness-20261111`.

- `prepare_source.py`: exportação Git completa dos 1.353 arquivos app, verificação de blobs e manifesto. 21 exclusões são somente referências fora do app.
- `prepare_devdeps.py`: três pacotes completos do cache, lockmatched: tsx 4.23.15, esbuild 0.28.2 e @esbuild/linux-x64 0.28.2; 40 arquivos e 23.429.120 bytes no tar. Não houve npm, download ou execução de pacote. Os arquivos atuais foram atestados por SHA; o tar do registro npm não foi baixado nem reatestado.
- `registry.json`: kind/pins/source/backend/versões/portas/limites fixos.
- `run.py`: implementação futura do perfil fixo; CLI aceita somente job UUID32hex. Não oferece comandos, caminhos, URLs ou env arbitrários.
- `worker_context.py`: lê somente o fence da fila já existente: payload exato, digest, boot, geração, authority primary, state running, marker execution.started, PID/startticks/UID/cgroup. Não copia token/SQLite/lease local e não cria outro coordenador.
- `native_pg.py`: cópia privada da biblioteca R4 com porta 55487 e socket nonce próprio. Verifica PG17.11/binários, SQL database/nonce/datadir/port antes de qualquer import da aplicação. Não gerencia cluster/serviço preexistente, sudo, Docker ou firewall.
- `node_guard.cjs` e `guard_policy.cjs`: require CJS com syncBuiltinESMExports para imports ESM; TCP só DB127.0.0.1:55487 e portas de até cinco listeners HTTP fictícios registrados em 127.0.0.1:0. DNS externo, TLS, UDP, demais listeners, fetch remoto e todos os pipes IPC são bloqueados. Subprocessos aceitos somente Node20 test child com argv/env exatos ou binários esbuild atestados, args de service fixos, sem shell/env/cwd arbitrários.
- `staging.py`: rejeita links, arquivos especiais, duplicação, traversal, inventário e bytes divergentes. Confere todo tar de produção, mas copia só node_modules; não recompila nem inicia Next.
- `receipts.py`: gate TAP de exatamente cinco testes admitidos e nenhum extra; exportação técnica allowlist sem PGDATA, senha, pgpass, fonte/deps, runtime, credenciais ou lease.

## Ponto conhecido: IPC opcional tsx

O loader direto evita criar o servidor CLI, mas tsx 4.23.15 ainda tenta conectar ao pipe opcional `TMPDIR/tsx-UID/PPID.pipe`. O guard NÃO abre pipe/conexão: lança ENOENT antes do connect original; o próprio tsx trata a ausência. Apenas esse pathname exato em TMPDIR privado, sem symlink, é classificado como esperado. Todos os outros caminhos/derivas falham. O recibo deve conservar `reportedDenialsTotal`, `expectedOptionalCliIpcDenials` e `unexpectedDenials`. Nunca interpretar isso como zero tentativas de rede.

Os mocks já provam original connect não chamado; um dummy Node com apenas builtins comprova sincronização CJS/ESM e bloqueios sem conexão. Outro dummy comprova argv real do runner Node e guard instalado no pai e no filho. Esses dummies não importam tsx/aplicação nem usam PostgreSQL. A qualificação real do loader/esbuild com os cinco testes ainda falta.

## Integração futura com a fila existente (proposta; NÃO instalada)

1. Revisar esse draft e congelar SHA do `harness-manifest.json` no adaptador kind fixo existente; esse pin externo é obrigatório. A leitura do próprio manifesto no runner não substitui o pin externo.
2. Disponibilizar somente os arquivos allowlisted do manifesto e os inputs fixos na raiz remota privada `/srv/admin-v2-worker/admin-r0003-route-gates-20261111`, owner vigia-worker,0700. Reutilizar o runtime f555 já instalado, sem rebuild/pull/npm.
3. **Conferir e alinhar o caminho do runtime existente antes de instalar.** O caminho proposto no draft é `/srv/admin-v2-worker/admin-r0002-runtime-qa-20261111/inputs/runtime.tar`; não foi consultado por SSH nesta tarefa. Se o caminho real for outro, alterar esta constante no draft e renovar hashes/peer review antes da submissão. Não aceitar pathname do payload.
4. Kind `govbr-route-gates-native-pg17-r0003-v1`; payload normalizado exato `{kind,source_commit,project_subdir:'site'}`. Sem env/cmd/URL/pasta/portas fornecidos pelo chamador. O adaptador de admissão precisa normalizar esse mesmo contrato.
5. Execução futura somente pelo launcher systemd da fila existente com **2 CPU,3GiB,256PID**, timeout soft600s e hard720s, com **cleanup grace>=60s antes do hard kill**; teste interno limitado480s, reservando extração e limpeza no orçamento total. Não executar junto do outro perfil pesado da mesma máquina.
6. A fila mantém autoridade única, idempotência e marker exclusivo. Após desconexão, consultar o mesmo job. Não repetir efeitos/rodadas automaticamente. A coleta deve aceitar somente `work/artifacts/govbr-route-gates` após encerramento, estado/geração corretos e **cgroup inteiro drenado**, não apenas exit0 do Python.
7. O runner cria PGDATA/socket próprios por nonce, porta55487, nenhum estado real. Usa ambiente limpo, devmail, sem PREVIEW/segredos. Não usa lease local, sudo, Docker ou chaves.
8. A coleta só passa se TAP exatamente5, guard no pai+filho, unexpectedDenials0, dados/nonce PG corretos, schemas removidos, fonte/deps estáveis, Node sem descendentes, stop PG e socket removido. Resultado com incerteza de startup/cleanup deve permanecer falha/uncertain, sem promoção.

Comando **proposto**, executado futuramente somente pelo adaptador dentro da unidade existente (não executar manualmente fora do fence):

`/usr/bin/python3 /srv/admin-v2-worker/admin-r0003-route-gates-20261111/run.py UUID32HEX_DA_FILA`

`/usr/bin/node` em Santiago está pinado ao SHA do inventário anterior `ca0728526aa1cc4e3056decec848ecc6d2c5391cecdd4e21a0ebd221d665c84e`, versão20.19.2. O Node local dos mocks é a mesma versão com hash distinto `b9640779...`; nunca substituir um pelo outro implicitamente.

## Orçamento e limitações

Estimativa inicial, não SLA: extração/hash30–90s, initdb/start5–20s, cinco callbacks30–180s, revisão de hashes10–60s, cleanup15–40s. Reserva total até720s,2CPU3GiB, pelo menos2GiB livres em disco. Antes da primeira execução o adaptador deverá conferir espaço e que a porta55487 não pertence a outro trabalho; se ocupada, falhar sem matar o processo e sem trocar a porta silenciosamente.

O guard é uma restrição das APIs Node do código QA revisado, não uma barreira OS contra código malicioso ou acesso sudo. Não foram alterados firewall, ACLs, redes, serviços, código publicado ou banco real. Nenhuma prontidão de deploy/produção é afirmada.
