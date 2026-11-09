# Roteiro da interface — instituição vinculada ao e-mail

Solicitação de09/11/2026: preservar fontes, layout e textos existentes; acrescentar somente o aviso solicitado de divergência. Sem deploy ou correção de banco por esta frente.

## Implementado

- Preenchimento automático de instituição quando o domínio é reconhecido, usando o mesmo parser puro do backend e o catálogo autorizado.
- Identificador estável e aliases permitem siglas oficiais sem perder reconhecimento histórico.
- Um preenchimento por domínio efetivo: reconsultas, mudança apenas da parte anterior ao@ e escolha manual não sobrescrevem silenciosamente a instituição selecionada.
- Seleção manual segue editável. E-mail sem vínculo e instituição incompatível recebem os erros existentes nos dois campos; submit exibe o modal existente e bloqueia a assinatura.
- Aviso novo: Este e-mail não corresponde à instituição selecionada. Adicionado nos cinco idiomas, sem substituir os345textos anteriores em cada idioma.
- Ao corrigir o par instituição/e-mail, o erro de divergência é removido. Ao escolher campus válido, o erro antigo do campus também é removido.
- Instituição com todos os municípios/campi na Amazônia Legal tem a caixa marcada automaticamente. O local de lotação torna-se obrigatório; não se presume sede como campus.
- Regra de caixa automática usa todos os municípios, não apenas o estado/sede. Instituições com campus fora da região não são marcadas por essa regra.
- Nenhuma folha CSS, classe existente ou fonte alterada.

## Validação rápida feita

13testes passaram comNode20.19.2, emcontainer efêmero semrede. Incluem testes de estado deautofill, override manual, catálogo tardio, troca de domínio, duas raízes institucionais, subdomínio, rejeição específica, spoof de sufixo, aliases, geografia e modal sem mensagem duplicada. Paridade de traduções aprovada. Typecheck completo passou com fonte e dados atuais montados somenteleitura.

Prova: /mnt/apps/peticao-final/peticao/.cache/siglas-dominios-20261109/frontend-proof.json. Log: /mnt/apps/peticao-final/peticao/.cache/siglas-dominios-20261109/frontend-quick-tests.log.

## Smoke no navegador após recompilar a prévia

1. Digitar e-mail de instituição totalmente naAmazônia: dropdown preenche, caixa fica marcada e campo de lotação aparece. Não deve enviar sem lotação.
2. Alterar manualmente para instituição incompatível: a seleção permanece, ambos campos ficam vermelhos e o novo aviso aparece. Assinar deve abrir o modal e não chamar o cadastro.
3. Corrigir a seleção ou mudar o e-mail para domínio vinculado: os erros devem desaparecer.
4. Editar só a parte anterior ao@: não pode desfazer a seleção manual conflitante.
5. Testar dois domínios e um subdomínio da mesma instituição: todos devem apontar ao mesmo identificador.
6. Testar domínio com sufixo falso e regra específica rejeitada: não pode haver validação institucional.
7. Trocar entre Servidor/Apoiador/Estrangeiro: limpar vínculo e estado sem interferir nas demais categorias.
8. Verificar carregamento tardio dos catálogos e resposta antiga deAPI: não preencher pelo e-mail anterior.

## Testes detalhados para a etapa posterior

Repetir suíte integrada completa, testes de concorrência/latência e falhas de rede, acessibilidade e comparações visuais em múltiplas larguras, conforme o responsável solicitou deixar para depois. As integrações externas e a entrega real de e-mail não são comprovadas pelos testes locais.

## Arquivos

- /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109/site/src/components/SignForm.tsx
- /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109/site/src/components/GeoFields.tsx
- /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109/site/src/components/Combobox.tsx
- /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109/site/src/lib/institution-form-state.ts
- /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109/site/src/lib/datasets-client.ts
- /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109/site/src/lib/form-validation-notice.ts
- /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109/site/src/i18n/pt.ts (e traduçõesen/es/fr/de).

## Restrição posterior: vínculo verificado ao MEC

A lista do formulário e a validação utilizam a mesma função de elegibilidade. As instituições históricas fora do MEC permanecem no catálogo de origem e na curadoria, mas não entram no dropdown nem no autofill do formulário Servidor. O resolvedor puro de titularidade continua identificando o Exército Brasileiro em eb.mil.br; o wrapper de elegibilidade recusa esse titular. O tipo legado ifes sozinho não concede permissão.

O e-mail é validado com o binding atual do banco: domínio alternativo aprovado depois do build funciona para uma instituição MEC existente. Rejeição atual do DB não pode ser anulada por uma regra antiga do catálogo estático. O vínculo recebido do navegador nunca é usado como binding confiável.

Validação focada adicional:23testes rápidos sem rede passaram, além de teste separado em PostgreSQL17 fictício e rede interna exclusiva (1/1). Esse teste insere um domínio novo com FK da UNIR, valida um subdomínio, rejeita-o depois e confirma que eb.mil.br com kind legado ifes continua bloqueado. Containers e rede temporários foram removidos. Log: /mnt/apps/peticao-final/peticao/.cache/siglas-dominios-20261109/mec-live-db-test.log.

A busca de instituições inclui os aliases na mesma ordenação existente; digitar IFFarroupilha continua mostrando a sigla oficial, sem mudança de rótulos, fontes ou estrutura do dropdown.

## Lotação EBSERH por hospital/unidade

Implementado no componente /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109/site/src/components/GeoFields.tsx: seletor obrigatório sempre visível para EBSERH, com 48 unidades (47 hospitais e sede). A seta abre a lista completa; digitação pesquisa sigla, nome e cidade. A lista utiliza sigla em maiúsculas e nome completo como dica, preservando o Combobox e os estilos existentes. O rótulo reutiliza “Lotado em:” e a cidade reutiliza “Cidade”, sem novos textos.

A escolha preenche cidade/UF somente leitura e campus/IBGE pelo ID da unidade; a caixa regional corresponde ao município selecionado. Manaus marca a região, Brasília/sede não marca. Trocar instituição limpa unidade e cidade. O backend deve resolver novamente o ID, sem confiar na cidade do navegador.

Validação rápida: 9/9 testes do módulo /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109/site/src/lib/institution-form-state.test.ts passaram, incluindo catálogo completo, busca, sede, Amazônia Legal, fronteira e limpeza; TypeScript --noEmit --incremental false passou. Testes de navegador e fluxo API ficam sob coordenação do agente principal e QA antes de qualquer publicação.
