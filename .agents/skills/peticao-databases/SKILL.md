---
name: peticao-databases
description: Integrar Neon Postgres à coordenação de tarefas e agentes Codex da Petição, preservando ledger, histórico e produção. Use na sessão peticao databases e em sua implementação.
---

# Databases da coordenação

Responsável `01a1e313-ac26-7f40-854c-ab475c3845e3`. Ler primeiro `_ops/delegacoes/databases-neon-20261116/PLANO-E-GOAL.md` e `_ops/delegacoes/AUTONOMIA-20261116.md` na raiz `/mnt/apps/peticao-final`. Usar skills neon/neon-postgres conforme tarefa, sem reler materiais que não mudaram.

## Contexto e autoridade

Herda história concluída do Root; integrar históricoInfra por leitura paginada e índice de fontes, não afirmar fusão integral de memórias. Registrar o que consultou e lacunas. PostgreSQL coordena tarefas/decisões/agentes; JSON compacto é retorno, Markdown é explicação. Não substituir DB internaCodex nem banco de assinaturas/SP.

Criar goal nativo a partir do handoff. Autonomia nas tarefas atribuídas; não esperar perguntas ao dono. Registrar pergunta, decisão, justificativa/evidência e resultado. Não terminar turno enquanto houver trabalho executável; perante dependência, avançar independentes e coordenar impedimento. Sem busyloops/atividade fictícia, sem invadir objetivos alheios; goal sócomplete após critérios reais. Adendos preservam progresso se a ferramenta não editar objetivo.

## Informes e sincronização

Reportar início, marcos, bloqueios, decisões materiais e conclusão aos DOIS:
- Root `01a1cad7-4a65-7d43-b8c2-f0b50a90a580`.
- Infra geral `01a1d130-2948-7140-bcfb-34696b20ab8d`.

Sincronizar contratos/commits/requirements com MigraçãoGit `01a1e2f4-ee1d-75d1-938a-013b7943e2a4`, hosts com agentesInfra; não modificar WIPs de outros ou duplicar operações. Mensagens curtas com prova/caminho/próximaação/ETA; confirmar recebimento só quando comprovado, sem cascataACK/polling. Guardar relatórios detalhados em arquivo.

Manter comunicação bidirecional também com Admin-v2 `01a1d97c-5d7f-7a92-8cc5-798070a3d6e0`: contratos, esquemas, dependências e prontidão precisam chegar ao desenvolvedor, que inicia pelo GitHub após recibo da Migração. Banco de coordenação não substitui o banco do app/SP; nenhuma mudança incompatível de interface deve ser feita sem sincronizar o consumidor.

## Invariantes técnicos

- Civo baseline de versões; Oracle futura central, sem cutoveragora.
- Identificar conta/projeto/branch reais antes de mutações; catálogo protegido, nenhum segredo em contexto/logs/Git/Neon.
- Branch/schemaisolado para testes e migrações versionadas; conexão direta para migrações e pooled para tráfego normal. Não reaproveitar DATABASE_URL do app.
- Uma autoridade da fila/ledger; reservas atômicas, idempotência, fencing, outbox/recovery quando necessários aos contratos atuais. Não duplicar fonte de verdade por dualwrite improvisado nem alterar quorum.
- Consultas filtradas/paginadas, referências a contexto extenso, evitar polling contínuo e recursos extras que consumam créditos sem necessidade.
- Executor61 opcional; antigas exigências dele não suspendem ordens explícitas do dono. Manter leases e verificações técnicas reais.
- Ferramentas Neon destrutivas exigem autorização específica; não executar drop/reset/revoke/delete para resolver dúvidas. Continuar outras partes do objetivo e reportar aos coordenadores.

Entregar prova operacional além de instalação/login: testes concorrentes/idempotência/recovery, acesso por host, esquema/versões, consumo/cota e manual de uso. Acesso à API administrativa não comprova integração da fila.
