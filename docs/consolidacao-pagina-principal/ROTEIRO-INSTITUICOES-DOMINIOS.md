# Roteiro — siglas, domínios, instituição e lotação

Solicitação expressa do responsável em 09/11/2026. Base: main local consolidado, sem autorização de deploy de código na VPS. O responsável autorizou corrigir especificamente os 35 registros identificados; esse saneamento deve ser separado, auditado e verificado antes/depois.

## Regras aprovadas

- Usar a grafia predominante nas páginas da própria instituição. Comparar homepage, apresentação e notícias, preservando fonte, data e limites. Não inventar caixa alta nem trocar marca por código administrativo.
- Correlacionar ID institucional estável, sigla de apresentação, nome por extenso, aliases históricos e vários domínios. Um domínio fica em uma linha ligada por FK à instituição; a consulta agregada retorna um array, nunca valores separados por vírgula.
- Domínio e subdomínio: correspondência por limites de rótulo DNS, com regra mais específica e rejeição explícita prioritária. Nunca reconhecer por simples substring nem atribuir sufixos públicos genéricos a uma instituição.
- Instituição é determinada pelo domínio do e-mail. O dropdown continua editável. Escolha divergente deve permanecer visível, marcar e-mail e instituição com os estilos de erro existentes, informar a divergência e impedir o envio pelo modal existente.
- E-mail reconhecido preenche a instituição automaticamente. Trocar apenas a parte local ou receber resposta assíncrona antiga não pode desfazer uma escolha manual nem vincular um domínio novo à instituição anterior.
- Instituição com todos os municípios/campi na Amazônia Legal: marcar caixa automaticamente e exigir local de lotação. O servidor deve repetir essa regra, mesmo se receber checkbox falso por POST forjado.
- Preservar layout, fontes, tamanhos e textos existentes. Somente o novo aviso solicitado de divergência foi acrescentado. Comentários MUDAR AQUI continuam disponíveis para edição pelo responsável.

## Implementação e evidências

- [x] Pesquisa dos 122 registros do catálogo. Evidência própria contemporânea em 117; cinco casos têm limites explícitos (UFFN e quatro escolas militares). Fontes institucionais tentadas sem contornar TLS, captcha ou acesso negado. Aliases preservam as formas anteriores.
- [x] IDs institucionais estáveis independentes de sigla; 30 formas de apresentação normalizadas conforme amostras. Exemplos: IFFar, IFC, IFF, IF Sudeste MG, IFSertãoPE, UFSCar, UFDPar, UnB, Ufac, Ufam, Unifap.
- [x] Transformações documentadas: UFCIMG/UFCIRJ, mantendo CEFET/MG e CEFET/RJ como aliases e domínios antigos na transição.
- [x] Catálogo inicial de 123 instituições autorizadas (122 do catálogo e EBSERH), 131 regras, 15 instituições com múltiplos domínios. Domínios genéricos compartilhados não foram atribuídos por suposição.
- [x] Schema institution_registry, FK institutional_domains.institution_id, include_subdomains e visão institution_registry_with_domains. Semente idempotente preserva rejeições manuais e associações não relacionadas.
- [x] API de validação de e-mail retorna instituição reconhecida sem remover validações de e-mail/antirrobô.
- [x] Cliente: preenchimento por domínio, escolha manual visível, duas bordas, aviso e modal, checkbox automático e campus obrigatório. Treze testes rápidos e typecheck passaram.
- [x] Backend: validação vinculada ao registro atual do banco, recusa de divergência e conferência final antes da gravação. Regra de Amazônia aplicada também no servidor.
- [ ] Conferir testes rápidos finais do backend/cadastro e o smoke do navegador com o conjunto integrado.
- [ ] Executar e verificar a correção transacional dos 35 registros autorizados. Preservar valores anteriores, status, tokens, dados pessoais e documentos; revalidar flags derivados sem inventar ou apagar campus.
- [ ] Atualizar prévia local, abrir para edição e enviar relatório HTML de resultados.

## Smoke obrigatório agora

1. E-mail de instituição conhecida seleciona a instituição correta.
2. Segundo domínio e subdomínio dessa instituição mantêm o mesmo ID.
3. Escolha manual de outra instituição não é revertida silenciosamente; ambos campos ficam inválidos e a submissão é bloqueada com o modal.
4. Retornar ao par correto remove aviso/bordas antigos.
5. Domínio de aparência semelhante (`instituicao.br.evil.invalid`) e raiz genérica não são reconhecidos.
6. Rejeição de subdomínio vence aprovação do pai.
7. Instituições totalmente na Amazônia marcam a caixa; sem lotação o cadastro é recusado no cliente e no servidor.
8. Troca entre formulários continua limpando estados e não transfere essa regra a apoiador/estrangeiro.
9. Comparar classes e textos anteriores; só aviso de divergência e nomes/siglas pesquisados podem mudar.

## Testes detalhados adiados por solicitação do responsável

- [ ] Atualizar fixtures e repetir a suíte completa (o resultado histórico 208/208 da fase anterior não valida automaticamente estas novas regras).
- [ ] Repetir regressão visual em todos os tamanhos, categorias e estados de erro.
- [ ] Validar corridas de respostas assíncronas, carregamento tardio, edições rápidas e alteração de domínio aprovado no banco.
- [ ] Validar bootstrap/migração em restauração da produção, idempotência e compatibilidade com admin-v2 antes de integrá-lo.
- [ ] Conferir domínios compartilhados e instituições sem domínio próprio comprovado; não abrir raízes amplas automaticamente.
- [ ] Verificar integração externa real (DNS/SMTP/provedores/CPF/Cloudflare) em escopo autorizado. QA fictícia não comprova envio nem disponibilidade de serviços externos.
- [ ] Conferir estatísticas, exportações, lotes, hashes, PDFs e auditoria após saneamento, sem regenerar documentos antigos.

## Caminhos e operação

- Código principal: /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109
- Workspace: /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109/peticao-principal.code-workspace
- Pesquisa e dados protegidos (fora do Git): /mnt/apps/peticao-final/peticao/.cache/siglas-dominios-20261109
- Pesquisa anterior e origem dos 35 casos: /mnt/apps/peticao-final/peticao/.cache/normalizacao-instituicoes-20261109
- Prévia de QA: http://127.0.0.1:3062/ — dados fictícios. A fonte editada precisa ser reconstruída pela tarefa do VSCodium para aparecer nessa prévia.
- ID Vigia: instituicoes-siglas-dominios-20261109. E-mails HTML nos minutos 00 e 30 enquanto a frente estiver ativa, somente ao responsável.

Nenhum teste extenso ou resultado antigo deve ser apresentado como validando alterações posteriores. Atualizar os checkboxes deste roteiro apenas com evidências efetivamente obtidas.

## Restrição MEC e titularidade — decisão adicional de 09/11

- [x] Política central escrita em `docs/POLITICA-CENTRAL-DOMINIOS-INSTITUICOES.md` e referenciada em `AGENTS.md`.
- [x] Titular de `eb.mil.br`: Exército Brasileiro; reconhecimento separado da elegibilidade.
- [x] Validar filtro compartilhado MEC na lista, preenchimento automático e backend.
- [x] Testar rejeição de órgãos de outros ministérios, escolas militares e instituição desconhecida.
- [x] Verificar EBSERH e domínios alternativos aprovados após build.
- [x] Atualizar prévia local com os filtros; sem deploy em produção.

Os 11 testes rápidos de correspondência/campus/parser passaram antes de finalizar o filtro MEC; não são comprovação de validação integral da alteração MEC. Testes amplos e revisão visual permanecem pendentes conforme escopo solicitado.

## Correção pontual dos35 na VPS — executada

Em 09/11/2026 às 14:56 UTC, transação única aplicada com35 correções e35 auditorias encadeadas. Verificação posterior somente leitura:35 campos-alvo conferidos, hashes dos demais campos preservados e nenhum rollback/segunda operação.22 campi incompatíveis e2 ausentes seguem para revisão, sem inventar lotação. Código/DDL não publicados. Evidência privada: `/mnt/apps/peticao-final/peticao/.cache/siglas-dominios-20261109/dados35/production-verify-result.json`.

## Validação rápida final

- 27/27 testes focados passaram em Node 20.19.2, sem rede externa.
- Typecheck e build Next.js passaram.
- Duas integrações em PostgreSQL fictício passaram: catálogo/API e domínio alternativo aprovado no banco após build, com rejeição posterior preservada.
- 8/8 cenários no navegador passaram, sem erros JavaScript ou envio de cadastro/e-mail real. Confirmados: seleção por domínio; conflito manual com duas bordas e modal; campus obrigatório; 11 titulares externos ao MEC ausentes; EBSERH com 39 municípios; limpeza entre categorias; alias IFFarroupilha; troca de domínio com limpeza do campus.
- Prévia local: http://127.0.0.1:3062/ . Ambiente fictício, separado da produção.
- Catálogo reproduzível: 124 instituições, 113 elegíveis MEC e 132 regras de domínio; cinco arquivos reproduzidos byte a byte.
- Evidências privadas em `/mnt/apps/peticao-final/peticao/.cache/siglas-dominios-20261109/`.

### Próxima etapa de testes, conforme pedido do responsável

A suíte extensa não foi repetida neste bloco. Revisar fixtures históricas que usam domínio fictício genérico como instituição válida antes da regressão ampla; repetir concorrência, rede, integração externa, acessibilidade e comparações visuais em diferentes larguras. Aprovação rápida não equivale à comprovação de entrega real de e-mail ou ausência de todo bug. Nenhum deploy de código ou DDL foi executado na VPS.
