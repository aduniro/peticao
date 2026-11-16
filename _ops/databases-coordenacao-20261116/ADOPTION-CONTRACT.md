# Piloto administrativo real — autorização Root/Infra de16/11/2026

## Autoridade e alvo

Root autorizou o primeiro registro real: **Consolidar aceite da padronização Civo nas máquinas e revisões pendentes**. Responsável Infra geral, participantes Root e Infra. Não é uma tarefa artificial para contar testes; a padronização e seus aceites estão em execução e ainda incompletos.

Alvo: projeto existente peticao-infra, branch br-autumn-sunset-bbrpz9x3, banco peticao_coordination, schema peticao_coord. A branch foi criada isolada do app para validação; passa a hospedar também este piloto administrativo em namespace exclusivo **infra-adoption-20261116** após correções/testes e rolloutv2. Os namespaces test-/validation continuam ensaios, sem autoridade de execução. Nenhuma tabela de assinaturas ou banco interno Codex participa.

Neon será a autoridade APENAS do novo registro de backlog administrativo e de seus informes/evidências. Os resource leases continuam EXCLUSIVAMENTE no ledger cooperativo Dell. Os dez jobs e estados de execução da fila Santiago permanecem EXCLUSIVAMENTE lá; a projeção Neon é informativa e datada. Não criar dual-write ou mover a autoridade dos jobs. Nenhum claim de tarefa Neon autoriza SSH, deploy, migração, reinstalação ou novo trabalho de host. Esses efeitos continuam exigindo autorização e reservas canônicas existentes.

## Ativação e registro único

1. Corrigir os achados DB-I1–DB-I6, testar somente fixtures/branchisolada, preservar checkpointv1 e gerar releasev2 e novo manifesto público. Configs600 e dependências do lockb347 ficam preservadas; novas versões do código não são novas dependências do app.
2. Distribuirv2 com reservas próprias e manter rollback para release52edce02f7cc58a06e3e. Conferir fonte atual/TLS/roles nas16contas; a revisão informativa não é novo quorum.
3. Criar uma única tarefa com chave idempotente `infra:civo-standardization-acceptance:3748`, namespace `infra-adoption-20261116`, responsável `infra`, prioridade80. As referências iniciais apontam a baselineV1/evento3748/hash382f2797f05403484a88e50f0c276c3db1ba4c66056ec89aeeb97cf7373af49e, o contrato público de instalação e este contrato.
4. Guardar ID e comandos em `ADOPTION-RECEIPT.json` e enviar diretamente aos dois coordenadores. Nenhum segredo ou URI deve constar do recibo.

## Uso real por Infra e Root

- Infra lê o item com a CLI instalada, registra um marco REAL com `progress ID --actor infra --ref CAMINHO-DA-EVIDENCIA`. Pode informar apenas provas já existentes e aceites parciais conhecidos; não criar novos installs ou coletar dados de produção para este piloto.
- Root faz uma segunda leitura e registra sua conferência com `progress ID --actor root --ref CAMINHO-DO-RECIBO-REAL`. Cada sessão confirma sua própria operação por mensagem nativa, com retorno/caminho, para distinguir probes de adoção real.
- `progress` acrescenta referências e evento de forma transacional, mantendo o estado anterior e incrementando a versão; duas atualizações simultâneas não perdem referências.
- Consultar `context ID`, `list --agent infra` e `events --after SEQ --limit10`. A identidade no banco usa o serviço writer compartilhado; o nome do autor é cooperativo e confirmado pelos recibos das sessões, não autenticação criptográfica por agente. Isso não aumenta permissões no ledger.
- O item continua **pending** enquanto a padronização geral estiver incompleta. Não chamar `claim`, `complete` ou `reconcile` apenas para demonstrar o piloto. Pendências A1/oscrypto, QA e K3sCivo devem permanecer explícitas até haver provas posteriores aceitas.

## Evidências, reversão e aceite

Antes do piloto, fazer novo backup privado do estado isolado e registrar hashes/contagens. Se ocorrer falha, suspender novas escritas deste namespace, manter a tarefa e eventos preservados no Neon e registrar a pendência pelo canal existente. Não inicializar outra fila oficial, reproduzir automaticamente eventos, apagar/revogar ou alterar produção. Restaurar somente em outro banco isolado com verificação e decisão coordenada.

Aceite da adoção: guards v2 e testes aprovados; runtime/sourcev2 homologado; ID único real; leitura/escrita comprovadas de Infra e Root; eventos/evidências persistidos; estado ainda aberto; nenhuma chamada de jobdispatch/novo votante/cutover e ledger/filas anteriores intactos. Isto comprova adoção do backlog administrativo, **não migração total da execução distribuída**.
