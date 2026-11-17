# Triagem de Contato: apresentação AV14

## Escopo

Candidato isolado de `6f36d07`, branch `qa/contact-triage-display-20261109`, worktree `/mnt/dev/peticao/.cache/admin-integration/candidate-contact-triage-qa-20261109`.

A aprovação AV14 em `ADMIN-AVISOS-PARA-APROVACAO.md` permite integrar a legenda humana da triagem. O componente existente passa a mostrar Categoria, Processamento, Diagnóstico, Prioridade e Histórico, com os estados/categorias exatos aprovados. Códigos desconhecidos não são interpretados como sucesso ou diagnóstico conhecido. O JSON estruturado e os códigos técnicos permanecem no expansor fechado “Evidências”. Os avisos de falha e dados obsoletos usam as frases aprovadas.

A lógica de triagem, IA, cadastro, CPF, banco/schema, sugestões e envio permanece intacta. A mudança não envia respostas, não publica nem modifica a prévia já disponível. Layout e classes admin-v2 existentes são reutilizados, sem CSS novo.

## Isolamento de QA

Runner `tools/admin-qa/triage-local.py`: configuração fictícia vazia, PostgreSQL novo54363 e HTTP3043, dependências existentes de preview-v1, sem `.env` ou dados reais. Uma porta inicialmente escolhida3040 estava ocupada: o runner recusou iniciar; o serviço existente não foi interrompido. A nova dupla3043/54363 foi verificada livre antes da execução.

O contrato de navegador usa autenticação e rotas reais do aplicativo compilado. Perda de rede, payload inválido e sugestão obsoleta são falhas controladas do transporte; o processamento determinístico de triagem é chamado diretamente na fixture, sem acionar o cron ou qualquer serviço de IA/envio. Requisições externas são bloqueadas e falham a verificação.

## Reprodução

Sequencialmente nesta worktree:

```sh
python3 tools/admin-qa/triage-local.py tests
python3 tools/admin-qa/triage-local.py build
python3 tools/admin-qa/triage-local.py types
python3 tools/admin-qa/triage-local.py http
```

Os resultados e checkpoints privados ficam em `.cache/contact-triage-qa/`. Isso não constitui autorização para merge/deploy da VPS.

## Resultados observados

- 18/18 testes dirigidos passaram: parsing seguro, mapas exatos AV14, códigos futuros sem diagnóstico inventado, processamento/API existentes e revisões concorrentes. Log `/tmp/admin-triage-isolated-n1kge6lq/validation.log`.
- Build0, fontes rastreadas idênticas antes/depois: `/tmp/admin-triage-isolated-o673ietq/validation.log`.
- Contrato compilado/browser0: `/tmp/admin-triage-isolated-emhrlam_/validation.log` e `contact-triage-ui.json`.
- Seis larguras390,320,768,992,1280,1920 sem overflow horizontal; inspeção visual direta320,390,1280. Barras fixas e aparência existentes preservadas.
- Abertura preguiçosa, estados em fila/concluída, legendas e evidências técnicas fechadas, expansão interna sem recarregar o pai, sugestão somente leitura e revisões anteriores inalteradas.
- Perda da resposta após POST efetivamente aceito: uma nova revisão registrada, seguida de leitura do estado; nenhum POST repetido. Cliques concorrentes não duplicam pedidos.
- Rede indisponível, payload inválido, sugestão obsoleta, job com falha e permissão rebaixada produzem avisos humanos aprovados, sem expor código técnico no resumo ou disparar respostas.
- Zero escrita em respostas/e-mails/fila, assinantes fictícios idênticos e zero erro não tratado/requisição externa. Portas3043/54363 encerradas depois do teste.

Typecheck0, fontes inalteradas: `/tmp/admin-triage-isolated-915ol7xo/validation.log`.
