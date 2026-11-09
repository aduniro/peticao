# Regressão integrada do snapshot8cdd97a

## Resultado do escopo validado

App congelado `8cdd97a0484d22cb5e7907e956bdcf42f0f851fe`, worktree `/mnt/dev/peticao/.cache/admin-integration/candidate-cumulative-8cdd97a-20261109`. Plano fixo140arquivos de teste e1.231fontes;130testes anteriores inalterados e10adicionados. Não houve exclusão de testes ou alteração do aplicativo para esta rodada.

**670/670 testes passaram; zero falhas, cancelamentos e ignorados; saída0.** Execução serial com banco novo/fictício54364, configuração vazia e Node20.19.2 oficial pinado. Fontes rastreadas idênticas antes/depois. Tempo total do runner601,7s; TAP570,2s.

| Fase | Resultado | Log e SHA-256 |
| --- | --- | --- |
| Toda a lista140arquivos |670/670; saída0|`/tmp/admin-accepted-cumulative-8sbiq_ed/validation.log` · `b4fe175154bd66097716690d4f444f9653bdf3a89f15037150d1213d5c169c67`|
| Schema22 |Saída0, originais/replay/bootstrap preservados|`/tmp/admin-accepted-cumulative-rgxqyo06/validation.log` · `cad3fff333f11c1634008d1c14b2f54cccd2a6cb1ea810b13df83e7f1634b87d`|
| Tipos |Saída0, sem diagnóstico|`/tmp/admin-accepted-cumulative-2ewpli6m/validation.log` · `9ae4d91b1345742c823c113266a4e5fea221b56270bb6418b81ae96d144965a2`|

Os testes incluem os incrementos de inbox autenticada, armazenamento/consulta, grupos de contatos, elegibilidade, histórico binário e verificação documental. A migração preserva definições/campos antigos, assinantes fictícios, configurações, registros de diagnóstico, versões/ciphertexts/timestamps e recibos administrativos ao reaplicar o esquema e o bootstrap antigo.

## Identidade do build e HTTP compilados

A frente APOIO produziu build e HTTP em Node20, depois liberou a janela para esta bateria. A conferência cruzada leu os metadados e confirmou: hash aceito,1.231fontes iguais,102pacotes instalados/50opcionais ausentes iguais ao plano, Node20.19.2/SHA exato, fonte estável e saída0.

- Build: `/tmp/admin-inbox-compiled-755kfymg/`.
- HTTP: `/tmp/admin-inbox-compiled-j2o0d80p/`, cinco grupos de provas aprovados.
- Conferência privada: `.cache/accepted-cumulative-node20/evidence/compiled-evidence-crosscheck.json`.

O produtor usa hash abreviado `8cdd97a` em seus metadados. A primeira checagem esperava string completa; preservou-se o registro dessa diferença e verificou-se a resolução Git para o hash completo aceito, além doSHA exato do plano e das contagens. Não se alteraram aplicação, artefato ou testes para resolver essa diferença de formato.

O runtime oficial isolado tem SHA de binário `b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac`; arquivo oficial `cbe59620b21732313774df4428586f7222a84af29e556f848abf624ba41caf90`. Não se substituiu Node/npm global nem se instalaram dependências do projeto. A versão20.19.2 corresponde à referência obtida anteriormente com `node --version` na VPS, somente leitura; isso não é comparação do binário remoto inteiro.

## Preservação e limites

O namespace `.cache/accepted-cumulative-node20/` deste checkout contém plano, fases e `final-summary.json`. Portas3044/54364 conferidas fechadas; sem processos de QA próprios ativos ao finalizar.

A rodada Node18 do44ade26 continua reprovada611/609/2; a nova rodada Node20 do44continua aprovada610/610+schema18+tipos. Nenhuma foi sobrescrita ou reclassificada. Seu build antigo foi expressamente retirado do escopo e não foi executado. A aprovação atual pertence apenas ao8cdd97a e aos contratos realmente exercitados; não comprova a causa da diferença da rodada18.

Os28hashes públicos críticos continuam iguais à captura de produção registrada no manifesto. Novas rotas fora desse conjunto foram relacionadas no mapeamento8cdd; a captura antiga não equivale a validação da configuração ou do banco real da VPS.

Não houve dado real, envio real, escrita na VPS, deploy, merge remoto ou execução do WIP interrompido de IA/texto rico. Este marco não declara o admin-v2 integral concluído nem dispensa revisão das interfaces/funcionalidades pendentes ou autorização explícita para publicação.
