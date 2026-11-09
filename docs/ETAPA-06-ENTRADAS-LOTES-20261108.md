# Etapa6 — contrato de entrada das rotas

Estado: **continue**, bloco validado; não conclui Etapa6. Não usar os33 testes de
`e5f5913` como prova deste patch, que tem as evidências próprias abaixo.

IDs de mutações passam a exigir inteiro decimal positivo no limite PostgreSQL.
Formulários de aprovar/código/cancelar/criar são limitados a1024 bytes antes do
processamento. Código duplicado é recusado; campos desconhecidos continuam sem
autoridade para escolher autor. Autorização e stepup precedem leitura dos corpos.

Upload assinado conta o fluxo real antes de interpretar multipart, com limite de
25MB mais64KB de envelope. O limite já existente de25MB do arquivo e a validação
estrutural/ICP permanecem na biblioteca. Arquivos repetidos no mesmo formulário
são recusados; arquivos vazios conservam a mensagem existente. O parser aceita
File do FormData sem depender de uma classe global específica do runtime.
Sem alteração de aparência, assinatura digital, CPF ou documentos publicados.

Contratos preparados:

- `tools/admin-qa/batch-input-unit.mjs`: parser/IDs puros, cancelamento de fluxo,
  header menor que corpo, bytes preservados e UTF-8 inválido; sem banco/transportes.
- `tools/admin-qa/batch-input.mjs`: HTTP compilado isolado, IDs400/corpos413,
  multipart fragmentado, ambiguidade, ausência de efeitos e mensagens preservadas.

`node --check` dos dois roteiros e `git diff --check` passaram. Não confundir isso
com execução dos testes. A invocação com `node --import tsx --test` relatou somente
o arquivo como um caso. Para comprovar os casos internos, executei do diretório
`site/`: `node --import tsx ../tools/admin-qa/batch-input-unit.mjs`; **4/4**, saída0,
sem falhas/ignorados/cancelamentos. Log em `.cache/qa-batch-input-20261108/unit.log`.
Build2 do principal informado saída0 às23:44Z. Contrato HTTP executado no build
fechado, em banco novo54357/HTTP3035, com quatro fontes de configuração vazias e
mail dev: `python3 tools/admin-qa/batch-local.py --contract batch-input`, saída0,
`/tmp/admin-batch-local-amsu3m0x/validation.log` e `batch-input.json` positivos.
As fontes relevantes tiveram SHA-256 conferido antes/depois pelo helper. Cópias
em `.cache/qa-batch-input-20261108/`, fora Git. O helper foi depois estreitado para
expor somente o modo HTTP executado, retirando uma seleção futura de testes ainda
inexistente; o caminho executado permaneceu igual.

HTTP comprovou autorização antes do corpo, IDs400, corpo1025 com413, multipart
fragmentado acima do limite com413, arquivos/códigos duplicados400, snapshot de
documento/auditoria preservado nas recusas, mensagens legadas de arquivo vazio e
código ausente, cancelamento autorizado e nenhuma mensagem/fila/envio criado.
Não houve QA em54349 durante a janela do root;54351 continua exclusiva da cumulativa
congelada `c975304`. Novo build global somente sob coordenação do principal.

Após fechar este bloco, prioridade de implementação é fluxo/documento final e
portal do presidente da ADUNIR conforme auditoria `c401848`, sem prolongar
hardening em detrimento das funcionalidades. Novos arquivos/QA serão coordenados.
Sem deploy, merge VPS, credenciais, alterações de terceiros ou envio real.
