# Coordenação Neon da Petição — entrega isolada

## Estado e fronteiras

O perfil conecta ao banco **peticao_coordination**, em uma branch de validação do projeto Neon existente peticao-infra, PostgreSQL 17. Não usa o banco de assinaturas nem modifica DATABASE_URL do app.

**Não houve cutover.** O ledger cooperativo do Dell continua emitindo as reservas reais; a fila de jobs de Santiago continua executando os trabalhos. O novo banco oferece tarefas isoladas de validação, cadastro informativo de agentes/sessões, decisões/eventos e projeções somente de leitura da metadata existente. Essas projeções não podem ser reivindicadas como tarefas. `live_dispatch` recusa execução. O contrato `ADOPTION-CONTRACT.md` define, separadamente, a adoção autorizada por Root/Infra de um registro REAL de backlog administrativo novo, sem transferir leases ou jobs. O modo `isolated` significa isolamento do app; o namespace do piloto é explicitamente distinto dos testes.

Oracle é futura central, conforme orientação atual; esta entrega não transfere autoridade, sessões, cookies, serviços ou o control-plane. Não cria novos votantes/revisores obrigatórios. O perfil é adicional ao ambiente do app/A1 e usa Python nativo sem substituí-lo.

## Localização por conta

- CLI: `$HOME/.local/bin/peticao-tasks`.
- Código e venv versionados: `$HOME/.local/share/peticao/databases/current`, apontando para um release privado.
- Config runtime: `$HOME/.config/peticao/databases/config.json` (role writer de metadata isolada).
- Config de consulta: `$HOME/.config/peticao/databases/query-config.json` (role reader).
- Guia: `$HOME/.config/peticao/databases/README.md`.
- Catálogo existente: `peticao-credentials list coordination` ou `path coordination/query-config`.

As configurações contêm credenciais e têm modo0600; não usar `cat`, copiar para Git ou colocar URI nos argumentos. Config de owner/migrações e backups completos ficam SOMENTE no Dell, fora deste workspace. Nem reader nem writer criam databases ou roles. As identidades de metadata não são permissões para executar no host.

## Consultas compactas

```bash
~/.local/bin/peticao-tasks --config "$HOME/.config/peticao/databases/query-config.json" external-jobs --limit 20
~/.local/bin/peticao-tasks --namespace validation list --agent databases --limit 10 --min-priority 50
~/.local/bin/peticao-tasks --namespace validation events --after 0 --limit 10
```

`external-jobs` retorna a projeção datada de Santiago, não uma leitura viva por RPC; atualizar exige nova captura RO explícita. `list` usa cursor por UUID, `events` usa cursor sequencial; guardar o cursor retornado e abrir contexto extenso apenas por ID. Limites entre1e100; concluídas ficam fora da lista ativa por padrão. Sem polling, daemon, LISTEN persistente ou carregamento automático de chats.

Criar/atualizar tarefas de validação usa chave idempotente. Repetir mesma chave com conteúdo diferente falha; atualização exige versão esperada. Dependências devem existir no mesmo namespace. Reivindicação usa transação com `FOR UPDATE SKIP LOCKED`, fence crescente e token persistido em arquivo privado, nunca impresso.

```bash
~/.local/bin/peticao-tasks --namespace demonstracao create --key exemplo-unico --title 'Tarefa sintética' --ref docs/contexto.md
~/.local/bin/peticao-tasks --namespace demonstracao claim --agent demonstracao --lease-file "$HOME/.config/peticao/databases/leases/demonstracao.json"
```

Arquivo de lease existente impede sobrescrita; não reaproveitar tokens entre tarefas. Finalização usa `complete --lease-file ... --ref caminho-da-evidencia`, com agente/token/fence corretos e TTL vigente. A referência é registro de evidência; não prova por si mesma resultado externo. Nenhuma dessas reservas substitui o ledger real.

Expiração move a tarefa para `uncertain`; outro agente não a recebe automaticamente. `reconcile` requer fence e referência de comprovação de efeito/ausência de efeito. O prazo é conferido pelo relógio do banco APÓS adquirir o row lock de finalização, não pelo início da transação. `update` aplica controle otimista e só atua em pendentes. `decision` registra pergunta, escolha e referências. `progress ID --actor ... --ref ...` registra marcos sem concluir a tarefa, preservando referências concorrentes. A API Python do mesmo arquivo fornece cadastro de agentes e interfaces de importação.

## Offline, importação e recuperação

- `outbox-enqueue` guarda somente intenção de criação em SQLite privado, EXCLUSIVAMENTE sob `$HOME/.local/state/peticao/databases/outbox`. O arquivo novo é criado exclusivamente; arquivos existentes exigem marcadores application_id/schema2 e estrutura reconhecida, conferidos em RO antes de escrever. SQLite desconhecido, caminhos externos/symlinks e namespace divergente são recusados. Não concede lease nem executa enquanto offline. `outbox-flush` verifica hash da intenção, faz um lote limitado e não duplica após perder a resposta do servidor. Não apontar para DB de outro sistema; nem fixtures de teste usam bancos Codex reais.
- `queue_export.py` consulta diretamente a fila SQLite em `mode=ro`, `query_only=ON` e snapshot transacional: somente ID, estado, geração, digest e datas. Nunca exporta payload, error, destinatário, nonce ou conteúdo de mensagem. Acima de10mil jobs exige estratégia explícita de paginação.
- **Não usar RPC `jobs` ou `status` como RO:** no runtime observado chamam `reconcile`, que pode alterar estado. Não invocar `snapshot`, pois grava cópia. Console, executor, adminqueue e ledger são bancos distintos.
- A projeção PostgreSQL é idempotente por origem/watermark/checksum e recusa regressão ou conteúdo divergente no mesmo watermark, inclusive sob concorrência. O checksum do ledger inclui origem, watermark e corpo, com igualdade explícita do watermark interno. A listagem de jobs mostra SOMENTE o último snapshot completo da origem; IDs ausentes nele não aparecem como atuais, embora os registros históricos sejam preservados sem delete. Não é uma fila alternativa nem sincronização bidirecional.
- `recovery.py` faz backup transacional privado e restaura em outro banco isolado na mesma branch, verifica as nove tabelas por contagem/hash e posiciona fences/sequências acima dos valores preservados. Não faz drop/reset/delete de recursos. Guarda o histórico das migrações, incluindo timestamps originais.
- Migrações1/2 têm checksums e lock transacional. Executar mudanças de schema somente com o perfil owner local do Dell e lease próprio da branch; o perfil distribuído não é o caminho administrativo de migrações.

## Dependências e implantação

`requirements.lock` congela psycopg/psycopg-binary3.2.13 e typing_extensions4.16.0, com hashes oficiais PyPI de wheels Linux x86_64/aarch64 para Python3.11/3.12/3.13. Revisão2 acrescenta compatibilidade WAHA3.11; não muda o app/A1. A lista de fontes e `supersedes` está no manifesto de evidência.

`install_profile.py` cria venv sem pip global, verifica hashes antes de extrair wheels compatíveis e promove release por symlink somente após consulta real com TLS cliente e `verify-full`. O backend atrás do proxy Neon pode informar SSLfalse em pg_stat_ssl; a prova do transporte cliente é `PGconn.ssl_in_use` e a verificação de certificado do libpq. A instalação registra versão, release, wheelfiles, espaço e resposta SQL, sem valores de credenciais.

`deployment.py` obtém reservas próprias por host, transmite as duas configs mínimas somente por stdin em SSH privado e preserva ambientes existentes divergentes. Não transmite owner. `verify_hosts.py` faz conferência posterior de roles, permissões, configs, fonte e TLS. Não há mudanças de serviço, PATH global, APT, pip global ou DB de aplicação. Em WAHA a margem livre mínima é3GiB.

Reversão de um perfil significa deixar de chamar a CLI nova ou voltar a um `previous_release` COMPATÍVEL registrado; não é necessário restaurar produção ou trocar banco. **Não usar a outboxv1 em arquivos com marcador/formato v2 nem usar v1 para alterar o novo piloto administrativo.** Em incompatibilidade, suspender a invocação de escrita e conservar os arquivos protegidos, sem downgrade de dados. Se for a primeira instalação, conservar os arquivos para conferência. Não remover dados ou revogar chaves automaticamente.

## Provas, consumo e passagem

Ver `SUMMARY.json`, `evidence/TEST-RESULTS.json`, `evidence/RECOVERY.json`, `evidence/HOSTS-FINAL.json`, `evidence/HOSTS-INDEPENDENT-VERIFICATION.json` e as auditorias antes/depois de SP/WAHA. Evidências operacionais não entram no repositório público; fontes estáveis entram somente pelo manifesto `PUBLICATION-CHECKPOINT.json` coordenado com Migração Git.

Plano Free confirmado nas duas contas. API de histórico de consumo retornou403 para Free; isso não prova cota esgotada ou ilimitada. SQL real prova disponibilidade no instante do teste. Compute de validação limitado a0,25CU e suspensão controlada pelo provedor; alterar o intervalo foi recusado412. Conexões são curtas, encerradas por transação; não há gasto de polling. Observar consumo pela conta/painel antes de ampliar carga.

Para um futuro cutover serão necessários janela de Root/Infra, snapshot completo coerente, mapa de IDs, reconciliação de estados/leases, prova de fencing no efeito real e plano de reversão. **Essa troca de autoridade não foi executada nesta entrega.**
