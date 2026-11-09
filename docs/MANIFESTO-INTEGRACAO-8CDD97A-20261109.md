# Mapeamento do snapshot44ade26 para8cdd97a

Commit integrado aceito: `8cdd97a0484d22cb5e7907e956bdcf42f0f851fe`.

## Manifesto preparado, sem execução pesada

Nova worktree limpa: `/mnt/dev/peticao/.cache/admin-integration/candidate-cumulative-8cdd97a-20261109`; branch `qa/cumulative-8cdd97a-20261109`. Plano `.cache/accepted-cumulative-node20/plan.json`.

- 1231 arquivos rastreados; SHA agregado de caminhos/hashes em JSON ordenado sem espaços: `152f8079e57365e0520e51054f1eca9a6d99c151699aa751ff208566bc1f9954`.
- 140 arquivos de teste; SHA do mapa ordenado caminho/hash: `458465ec5eb8edfff10fed3561bef883486490f73cc4140b8d19d4fc69c4a039`.
- Todos os130arquivos de teste anteriores estão presentes e byte a byte inalterados. Dez novos; nenhum excluído.
-102pacotes instalados iguais ao lock;50opcionais de outras plataformas ausentes, identificados. Nenhuma dependência instalada ou trocada.
- Node20.19.2 oficial pinado, SHA do binário `b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac`.
- Fontes não rastreadas/ignoradas em `site/src`, WIP de texto rico e configurações runtime são recusados. A worktree principal não foi copiada.

## Novos testes

- `site/src/lib/batch-document-history.test.ts`
- `site/src/lib/communication-eligibility.test.ts`
- `site/src/lib/contact-group-execution.test.ts`
- `site/src/lib/contact-group-preview.test.ts`
- `site/src/lib/document-verification.test.ts`
- `site/src/lib/mail-inbound-codec.test.ts`
- `site/src/lib/mail-inbound-contract.test.ts`
- `site/src/lib/mail-inbound-route.test.ts`
- `site/src/lib/mail-inbound-store.test.ts`
- `site/src/lib/mail-inbox-read.test.ts`

## Áreas de modificação

Os incrementos incluem inbox autenticada, codecs/armazenamento/consulta, grupos de contatos (prévia e execução explícita), elegibilidade, histórico binário de lotes, verificação documental mínima e atualização do ensaio de migração para22tabelas. Além das APIs administrativas, há adições fora dos28arquivos críticos: `/api/mail/inbound` autenticada por contrato e `/api/documentos/verificar/[versao]` para metadados. Esses endpoints novos precisam de suas próprias provas; igualdade das fontes antigas não os certifica.

Os28hashes públicos críticos continuam iguais à captura somente leitura da VPS encerrada em `2026-11-09T01:50:31.892692+00:00`. Não foi realizada nova leitura remota ou cópia de fontes. Evidências comparativas privadas: `mapping-44-to-8cdd97a.json`, `public-compatibility.json`, `source-changes.txt` no namespace do plano.

## Sequência coordenada

1. APOIO prepara build/HTTP Node20 do8cdd97a em sua cópia limpa, com manifesto de fonte/dependências antes/depois. Manifesto acima liberado; sem build duplicado44/079.
2. Após o término do build pesado e handoff explícito, executar nova bateria completa140arquivos, schema22 e tipos com o mesmo runtime/pin e configuração fictícia. Não começar durante compilação, para evitar acrescentar pressão aos testes com deadlines curtos.
3. Usar evidências próprias do8cdd97a;610/610do44não substitui a nova regressão. Manter a rodada18reprovada e a rodada20aprovada do44 sem sobrescrita.

Na preparação documentada aqui, nenhum teste de aplicativo, build ou browser foi iniciado para8cdd97a. O Vigia deve mostrar espera de janela, não execução de unidades. A autorização posterior para rodar após handoff não é autorização para publicar.

O build44foi expressamente retirado do escopo pelo integrador; permanece não executado. Isso não cancela a prioridade do admin-v2, não declara sua conclusão integral nem autoriza merge/deploy na VPS.
