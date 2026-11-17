# Migração, preservação e proveniência

Esta documentação registra a publicação inicial de 16/11/2026. A publicação
sanitizada é uma representação do código e do histórico revisados; não contém
os bancos, backups, credenciais ou registros pessoais preservados privadamente.

## Correção da revisão inicial

Uma identificação usada em fixture, cuja origem sintética não estava comprovada,
foi detectada depois do primeiro envio. A revisão deveria ter concluído essa
verificação antes da publicação. A correção substituiu o identificador e suas
representações na cópia pública, preservando o original privado.

Às 07:58 UTC, a sessão automatizada responsável pela migração atualizou
**10 branches e 5 tags** já publicadas. O envio também incluiu um avanço normal
e sete branches novas. A operação foi atômica, condicionada aos hashes esperados
de cada referência, sem divergência remota observada antes do envio. Houve
reescrita pública; ela não deve ser descrita como ausência de force-push.

Isso foi uma correção da publicação inicial, não o fluxo de desenvolvimento
adotado daqui em diante. Correções futuras usam commits, branches e PRs novos.
Não se afirma que a atualização de referências apague caches ou cópias externas.

## Como interpretar a cadeia histórica

As duas primeiras revisões de sanitização são alternativas da mesma origem;
seus mapas não devem ser concatenados como etapas sucessivas. A cadeia adotada
usa a segunda revisão e, em seguida, a sanitização pública final.

- A primeira etapa considerada possui 834 entradas: 833 commits sobreviventes e
  uma omissão documental privada. A comparação possui 163 identificadores iguais
  e 671 diferentes, incluindo a omissão.
- A etapa final possui 844 entradas: 143 identificadores alterados, 701 iguais
  e nenhuma omissão adicional.
- As 833 saídas sobreviventes da etapa anterior entram no mapa final. As outras
  11 entradas correspondem a seis commits de preservação de WIP, empacotamento
  documental, requisitos de infraestrutura e coordenação administrativa.
- Autoria, identidade do committer, datas, fusos, encoding e tradução dos pais
  foram comparados em 833 pares da primeira etapa e 844 da segunda, sem
  divergência inexplicada. Isso não é uma afirmação sobre assinaturas Git.

O commit omitido acrescentava apenas um documento operacional explicitamente
excluído da publicação. Ele não era vazio na origem. O objeto e sua ligação com
os pais permanecem no arquivo privado. A omissão conhecida não demonstra perda
de código funcional da aplicação, nem autoriza republicar o documento.

Os mapas integrais e as correspondências privadas permanecem protegidos. Esta
documentação não publica identificadores ou links para recuperar material
removido. Não se fabricaram commits históricos para preencher a omissão.

## Fluxo de integração

Cada desenvolvedor mantém seus commits, branches e testes. Uma entrega informa
repositório, branch, SHA, responsável, objetivo aprovado e evidência de QA.
A integração confirma o SHA atual e a origem dos checks antes do merge. Um check
antigo, pulado ou produzido por identidade diferente da esperada não é PASS.

Uma mudança no resultado de um check pode gerar nova avaliação do mesmo SHA.
Repetições do mesmo evento não devem repetir a integração. Após falha de rede
ou interrupção, a operação remota é reconciliada antes de qualquer retry.

Se uma integração já publicada precisar ser desfeita, a recuperação é um revert
aditivo em nova branch e PR, com os testes pertinentes. Não usar reset,
force-push ou movimentação de tag publicada. Aprovar merge não aprova deploy.

O principal é público e os dois aplicativos auxiliares mantêm repositórios
privados e contratos próprios. Limitações de proteções nativas nos privados
devem ser declaradas; auditoria operacional não equivale a um bloqueio servidor.

O PR administrativo R2 existente permanece fora da aprovação desta implantação.
Produção, banco de assinaturas e fluxo PDF/assinatura continuam separados da
integração Git e não são alterados por este documento ou pelos checks iniciais.
