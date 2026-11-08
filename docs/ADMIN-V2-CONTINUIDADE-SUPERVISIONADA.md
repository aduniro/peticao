# Handoff para execução persistente — 08/11/2026

O admin-v2 completo continua prioridade 1. Esta supervisão foi autorizada pelo
proprietário para evitar encerramento silencioso do trabalho. Não publicar nem
fazer merge/integração de código com a VPS. Não alterar produção, hashes, datas,
assinaturas ou decisões da revisão local. Enviar mensagens apenas ao proprietário.

## Checkout de desenvolvimento

`/mnt/dev/peticao/.cache/admin-integration/candidate-stage02-domains`, branch
`admin-v2-domain-actors`, base `d8b8bac`, contém a cadeia de funcionalidades locais.
Preservar o candidato essencial, o espelho live na porta3031 e os demais worktrees.
Não editar o checkout que estiver sob build/teste de outro processo.

Há alterações não commitadas em `institutional.ts`, rota `api/admin/dominios` e
`admin-settings-domains.test.ts`: revalidação transacional do ator, mantendo a
classificação institucional. Os 15 testes direcionados passaram. Falta fechar
types, migração estrita das 13 tabelas aditivas e validação HTTP, documentar/commitar.
O ledger de intenções de indicação está preparado; não está ligado à rota/form.

## Evidência recente

Na cópia `candidate-stage02-content-retention`: cumulativa serial **500/500**, build
e tipos aprovados. A tentativa anterior paralela foi499/500 por lock_timeout;
teste isolado8/8, sem enfraquecer timeouts ou corridas internas. O HTTP inicialmente
falhou porque o fixture usava kind=admin (visualização restrita); alterado apenas
o fixture para confirmacao. Repetição compilada passou com todas as garantias de
expiração/cron/idempotência/originais preservados. Não apresentar primeira falha
como sucesso. Fix do fixture ainda precisa de checkpoint local nessa cópia.

Artefatos privados de QA em `/home/barre/.cache/peticao-admin-mirror-qa/20261108`.
Não versionar runtime. Helpers de QA podem consumir configuração fictícia
internamente sem imprimir valores; nunca ler configurações reais de produção.
Usar verificações independentes locais por `tools/monitor/verify_admin_candidate.py`
(executar a partir do candidato). Porta54349 exclusiva do novo QA; não reutilizar
listeners desconhecidos. A cumulativa deve serializar arquivos e manter corridas
internas. Não executar `npm test` paralelo indiscriminadamente.

## Decisões

AV15 foi aprovado: textos Arquivados/Restaurar/resultado/restauro/conflito e30 dias
para conteúdo de e-mail, anexos e rascunhos. A UI de restauro em
candidate-stage02-retention passou495 testes, build/types e navegador390/1440.
AV16 (editor de rascunho compartilhado e seus textos) ainda aguarda resposta.
Não considerar AV15 como aprovação geral de outros textos. Guardas de aprovação
e envio, avisos públicos e estética fora do pedido continuam preservados.

Código segue cadeia local: stage02 → email-version → permissions → retention →
content-retention → drafts(codec apenas) → referral-intents → domains.
Alguns commits finais de documentação estão em branches laterais; comparar antes
de consolidar LOCALMENTE, nunca importar/mesclar código da VPS sem autorização.

## Plano e conclusão

Consultar a matriz e documentos ETAPA/ETAPAS no candidato e o plano integral
`/mnt/dev/peticao/docs/PLANO-INTEGRACAO-ADMIN-VPS.md`. Cada etapa termina com relatório
estruturado; trabalho parcial usa continue, impedimento real usa blocked. Continuar
etapas independentes enquanto uma aprovação estiver pendente. Nenhum percentual
de bloco ou bateria de testes significa conclusão de todo o painel. A última
etapa entrega manifesto/reversão para revisão e autorização, sem executar deploy.
