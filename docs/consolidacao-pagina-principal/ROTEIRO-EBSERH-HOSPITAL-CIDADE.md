# EBSERH: unidade de lotação e município

Solicitação de09/11/2026. Escopo local, sem deploy ou escrita no banco da VPS.

## Comportamento aprovado

- Para EBSERH, selecionar hospital/unidade e preencher automaticamente cidade/UF.
- Incluir a sede administrativa em Brasília/DF.
- Mostrar sigla em MAIÚSCULAS em destaque e nome por extenso ao lado, no padrão do seletor de instituições.
- Armazenar identificador da unidade e município em campos separados e relacionados no banco.
- Preservar aparência e comportamento das demais instituições e categorias.

## Decisões de implementação

Catálogo selecionável:47 hospitais identificados como rede atual, mais sede administrativa (48 opções). Complexos-pai não se repetem como hospitais; projetos em construção/não confirmados ficam fora. As subunidades físicas informativas permanecem no catálogo de pesquisa, sem duplicar os hospitais na seleção inicial.

O backend resolve cidade/UF/IBGE pelo ID da unidade; não confia nos campos enviados pelo navegador. Unidade obrigatória para novo pedido EBSERH, inclusive fora da região. Checkbox regional conforme município escolhido. Preservar registros históricos sem inventar unidade. Banco local recebe catálogo e FK; nenhuma migração de produção está autorizada.

## Checklist

- [x] Catálogo validado e sede Brasília.
- [x] Unidade obrigatória e cidade resolvida no backend, inclusive submit direto.
- [x] Banco com campos separados, FK e coerência de município.
- [x] Seleção mostra sigla/nome; seta completa e digitação filtrada.
- [x] Cidade automática readonly e região coerente.
- [x] Limpeza ao trocar hospital, instituição e categoria.
- [x] Teste integrado PostgreSQL fictício e API/fluxo.
- [x] Typecheck, build e testes de navegador.
- [x] Commit, Vigia e e-mail de conclusão.

Testes amplos de regressão permanecem para etapa posterior, conforme decisão anterior.

## Resultado da validação

- Catálogo: 48 opções, 47 hospitais operacionais e Administração Central em Brasília; 39 municípios.
- Banco: `signatures.ebserh_unit_id` referencia `ebserh_units.id`; cidade/UF/código IBGE ficam separados em `city`, `uf`, `city_ibge`, com FK composta unidade/município. Campos de campus permanecem compatíveis para o fluxo anterior. Legados sem unidade preservados.
- O backend resolve cidade pelo ID; campos geográficos forjados não substituem o catálogo. CHECKv2 null-safe bloqueia instituição nula/divergente, categoria indevida e vínculo de município incompatível.
- 29 testes rápidos de regressão aprovados; 5 testes backend aprovados; 1 integração adicional PostgreSQL/handleSign aprovada com duas solicitações persistidas e outbox fictícia. Conjuntos têm sobreposição, não somar como testes únicos.
- Typecheck e build aprovados. 10 grupos de verificações no navegador aprovados, incluindo 48 opções e siglas/nome, Manaus/região, sede Brasília, cidade readonly, unidade obrigatória, mismatches e modal, trocas repetidas de instituição/e-mail/categoria e resposta antiga atrasada. Duas consultas reais ao endpoint local de e-mail reconheceram EBSERH e UFAM corretamente; outros cenários usaram respostas derivadas do catálogo.
- Nenhum erro JavaScript nem requisição de assinatura no navegador. Testes backend usaram somente schema PostgreSQL fictício, CPF/MX simulados e transporte dev, sem SMTP externo. A guarda de .gov.br de QA foi preservada; teste positivo usa domínio fictício cadastrado só no schema de teste.

## Achados e correções durante os testes

1. CHECK inicial permitia instituição NULL porque PostgreSQL aceita resultado NULL em CHECK. Corrigido para IS NOT DISTINCT FROM 'EBSERH', versão v2, e teste explícito confirmou recusa.
2. Fixture antiga de EBSERH permitia informar só cidade; atualizada para fornecer a unidade agora obrigatória. O backend não foi afrouxado para manter o teste antigo.
3. Expectativas antigas de subdomínios/kind da EBSERH foram alinhadas à política já aprovada; proteções de envio permaneceram intactas.
4. Build de snapshot anterior foi encerrado intencionalmente para incorporar CHECKv2. Exit 137 dessa tentativa corresponde ao SIGKILL do container temporário de build, sem relação comprovada com falta de memória; containers da aplicação e produção preservados. Build final passou.

Prévia: http://127.0.0.1:3062/ . Evidências privadas: `/mnt/apps/peticao-final/peticao/.cache/ebserh-flow-qa-20261109/` e `/mnt/apps/peticao-final/peticao/.cache/siglas-dominios-20261109/ebserh-units-tests.log`.

Nenhum deploy, migração ou alteração do banco da VPS neste trabalho. Testes extensos posteriores continuam pendentes conforme a decisão anterior.
