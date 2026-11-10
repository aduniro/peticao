# Acompanhamento privado da infraestrutura

Disponível em Santiago, com Tailscale conectada:

- IPv4: http://100.80.18.81:8766/
- IPv6: http://[fd7a:115c:a1e0::3e2f:1252]:8766/
- Dados filtrados: http://100.80.18.81:8766/api/status

É um painel da infraestrutura/fila. **A fila não representa percentual de conclusão do admin-v2.** Mostra contagens de estados, últimos 100 trabalhos, commit, exit code, heartbeat e última replicação, atualizando a cada 10 segundos. O horário da captura está em `queue_snapshot_at` na API. Não mostra logs, payload completo, segredos ou dados de assinantes.

Se `/srv/admin-v2-coordinator/vigia-summary.json` estiver disponível, uma seção separada mostra os campos sanitizados de tarefas exportados pelo Vigia, incluindo percentual e estimativa informados por ele. Mostra horário da exportação e `updated_at` de cada tarefa. Exportações com mais de 120 segundos são rotuladas antigas, sem comprovar atividade atual; ausência do arquivo e perda de conexão também recebem aviso. Textos dinâmicos são inseridos exclusivamente por `textContent`. O dashboard não produz nem altera esse arquivo; sua exportação é feita por outro processo autorizado.

Somente GET e HEAD, duas rotas fixas; demais métodos retornam 405 e caminhos desconhecidos 404. A lista de origens permite somente os endereços Tailscale IPv4/IPv6 informados de local, SP, Santiago, a15galaxybb e os três registros TL10/VAIO/Haven. Nenhuma chave SSH, sudo ou execução de comandos foi concedida aos dispositivos. Não há encaminhamento público nem bind 0.0.0.0/::; a porta 8765 permaneceu intacta. A proteção criptográfica do transporte é fornecida pelo túnel da Tailnet.

A fila SQLite original é lida por cópia temporária privada de DB+WAL, sem alterar os originais. Conferem-se inode/tamanho/mtime/ctime antes e depois; máximo 64 MiB por arquivo, três tentativas e `PRAGMA quick_check` na cópia. A consulta usa SQLite `mode=ro` e `query_only`. É uma visão de melhor esforço: concorrência persistente ou falha mostra indisponível, sem apresentar estados inventados. Temporários são removidos após a consulta. Somente a fila de coordenação é consultada; não há acesso ao banco da aplicação.

Fonte local: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/infra/dashboard.py`.
Unidade local: `/mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/infra/admin-v2-dashboard.service`.
Na VPS: `/opt/admin-v2-cluster/dashboard.py` (root:admin-v2-exec, 0640), `/etc/systemd/system/admin-v2-dashboard.service`.

Serviço ativo como vigia-coord, CPUQuota 5%, MemoryMax 96 MiB, TasksMax 24; memória observada aproximadamente 10 MiB. ProtectSystem=strict, sem escrita na fila original, ProtectHome, PrivateTmp e NoNewPrivileges ativos.

Verificação em 10/11/2026: HTTP 200 em IPv4 e IPv6, fila legível com oito jobs de infraestrutura (6 completed, 1 failed, 1 canceled), heartbeat e réplica disponíveis. POST/DELETE 405, caminho de arquivo 404; origem loopback fora da allowlist 403. Cinco testes locais passaram, incluindo leitura WAL sem alterar hashes dos originais, supressão de valores pessoais fictícios e resumo do Vigia ausente/recente/antigo.

TL10 estava offline no levantamento: inclusão na lista não significa que sua abertura visual tenha sido observada. O mesmo vale para qualquer dispositivo ainda não testado diretamente pelo responsável. Não foram alterados app, produção, SSH2222, mesh2223 ou fontes principais. Nenhum commit Git foi feito nesta frente.

Teste local:

```sh
/usr/bin/python3 -m unittest discover -s /mnt/apps/peticao-final/peticao/.cache/admin-v2-executores-20261110/tests -p dashboard_test.py -v
```
