# Regressão incremental44ade26: rodada reprovada e diagnóstico isolado

## Resultado cumulativo

Fonte congelada `44ade26c44d35c1e872e9526d51314fc2fe63909`, worktree `candidate-cumulative-44ade26-20261109`, plano fixo130arquivos de teste/1.183fontes. Node18.19.1, dependências existentes102pacotes com versões iguais ao lock e50opcionais de outras plataformas ausentes. Sete testes do runner passaram antes da preparação; fonte não rastreada, inclusive ignorada, é recusada, e somente `.env.example` rastreado é permitido como exemplo.

**Rodada NÃO aprovada: saída1; relatório Node com611tests,609pass,2fail, zero cancelados/ignorados.** A lista de arquivos não foi reduzida. Fontes rastreadas idênticas antes/depois. Início e término completos estão em `.cache/accepted-cumulative/tests.json` e no diretório privado de execução.

Log original `/tmp/admin-accepted-cumulative-5436_amg/validation.log`, SHA-256 `4b19e48f6db45dd346d96620abf254777a52aec67ee42fed57300727230035ce`.

## Duas falhas distintas

1. Os dois casos de `signed-pdf.test.ts` passaram, mas o worker permaneceu comCPU100% e sem novas linhas. Após318,86s sem progresso, o integrador autorizou finalizar somente esse worker. Foram conferidos PID297672, PPID265162, início22933909ticks e caminho exato do arquivo duas vezes. Apenas SIGTERM foi necessário; nenhumKILL, banco ou serviço foi atingido. O Node registrou a falha de encerramento do arquivo e continuou a lista. Essa intervenção impede promover o resultado a aprovado, independentemente do restante.
2. `signup-diagnostics.test.ts:81`, concorrência: esperava duas linhas e encontrou uma, com aviso `write_unavailable`. Duração observada9,3s. A mensagem genérica não identifica a causa SQL; portanto, não é correto atribuir automaticamente à carga ou ao Node. Os limites existentes de lock250ms/statement1000ms e o contrato de não transformar falha de diagnóstico em falha da assinatura permaneceram intactos.

O contador611 inclui a falha agregada do arquivo além dos seus casos internos. Uma futura rodada sem esse erro pode ter outro total de linhas de relatório sem alteração na lista fixa; comparar também arquivos/hash e os próprios casos, sem “corrigir” contagem removendo testes.

## Runtime de referência e reproduções

O comando somente leitura `node --version` no alias SSH `peticao` confirmou `v20.19.2`. Não houve acesso a banco/segredos nem escrita na VPS.

Foi obtido um runtime oficial isolado em `/home/barre/.cache/peticao-qa-node20-20.19.2`, sem substituir Node/npm global e sem instalar dependências do projeto. Origem `https://nodejs.org/dist/v20.19.2/node-v20.19.2-linux-x64.tar.xz`; checksum oficial de `SHASUMS256.txt` conferido: `cbe59620b21732313774df4428586f7222a84af29e556f848abf624ba41caf90`. Os5.371membros do arquivo foram verificados contra caminhos absolutos, travessia, arquivos especiais e links externos antes da extração. SHA do binário: `b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac`.

- Apenas `signed-pdf.test.ts`, mesma fonte congelada, Node20.19.2 e configuração fictícia:2/2pass, saída0 e encerramento normal779ms. Log `/tmp/admin-signedpdf-node20-ue2vtx5v/validation.log`, SHA `25d2196653f482901fb679c89bd1ce1f5c626b2b0438a4dc06b6bffd3293b1f7`.
- Apenas `signup-diagnostics.test.ts`, banco novo/fictício54364, Node20.19.2:8/8pass, saída0,3,4s; concorrência413ms. Log `/tmp/admin-signup-diagnostics-node20-ynpnwdj2/validation.log`, SHA `0d6eccb893642ec954e5d59e86a68017df571006028783a42258ab43b236307d`. O único `write_unavailable` é o caso que injeta explicitamente falha para comprovar que a assinatura não é afetada.

As reproduções preservaram todas as fontes. Elas ajudam a delimitar a falha, mas não substituem a regressão completa nem provam isoladamente a causa da diferença entre runtimes/condições.

## Schema como diagnóstico independente

Autorizado expressamente após a reprovação, sem promover o resultado global: upgrade/bootstrap/replay de18tabelas aditivas passou0 comNode20.19.2 e banco novo. Preservou campos originais, registros fictícios de assinatura/diagnóstico, ciphertext/versões de rascunhos, histórico, reservas e desafios de presidente; nenhum envio, assinatura criptográfica ou descriptografia de contatos foi executado.

Log `/tmp/admin-schema-node20-6041pgz5/validation.log`, SHA `4818ebb1ca8f3ba29a4a491de266a0bdc936db3597c2f477ec049ae53c26fc6a`. Fontes antes/depois idênticas. Portas54364/3044 conferidas fechadas após os diagnósticos.

## Próximo passo proposto

Fixar explicitamente runtime20.19.2 e seuSHA no runner/plano; preparar nova evidência separada e repetir toda a lista congelada. Se houver nova perda concorrente, registrar externamente apenas código SQL e tempos sanitizados no QA para identificar a causa, antes de propor alteração em fonte pública. Não aumentar timeouts nem retirar assertivas apenas para obter aprovação.

Não houve build/browser da rodada, publicação, merge, dados reais, serviços externos ou execução do WIP interrompido. Os28hashes públicos do snapshot continuam iguais à captura de produção registrada. A prioridade do admin-v2 continua; esta é evidência parcial reprovada, sem autorização para deploy.
