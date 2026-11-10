# Plano conjunto para aprovação — 10/11/2026

Estado: PROPOSTA. Novas publicações Tailnet, caixa executor e automação de deploy não foram implantadas por este plano. Há desenvolvimento local já autorizado em andamento. Nenhum deploy de produção foi realizado.

## 1. Objetivo e prioridade

Construir uma única aplicação cumulativa: página principal de assinaturas + frontend/backend do admin-v2. Prioridade imediata: documentos, petição, lotes, aprovação e envio. Uma assinatura digital é opcional no caminho explicitamente escolhido pelo operador; não bloquear envio legítimo por ausência de A1/gov.br/nativa.

Interpretação registrada: “enviar sem assinaturas” significa documentos sem assinatura digital do sindicato/presidente; as assinaturas coletadas na petição continuam preservadas e incluídas normalmente. Esse modo terá alerta na interface e confirmação humana. Texto proposto: “Este pacote será enviado sem assinatura digital. Deseja continuar?”. Não inserir novo aviso deslegitimador no PDF, não alegar ICP inexistente nem chamar produção sem assinatura de TESTE. Uma nova apresentação gera uma nova versão imutável; PDFs históricos permanecem intactos.

## 2. Base comprovada, sem reiniciar trabalho concluído

- Público: /mnt/apps/peticao-final/peticao/.cache/consolidacao-pagina-principal-20261109, commit b9e8ae2574125df90d80fc18ef24832f5d646ce0.
- Admin: /mnt/apps/peticao-final/peticao/.cache/admin-v2-final-20261109, HEAD0a5f734da4f9b8a35a10a20eaa9fb4fd5adb0e4f; coorte backend4a29bf61941b70148d05359d2d3173a587ca9eb7.
- O patch público já existe no admin como cherry-pick0e362245e36a2b7a2e40c6a35bc1db03a4ac98ea, com Patch-ID idêntico. Não reaplicar ou copiar backend antigo por data.
- Histórico de e-mails concluído localmente: Next real +PostgreSQL fictício,26 registros/251tentativas/205eventos, inclusive hard/soft/blocked após100. Primitivos transacionais de e-mail:36PG aprovados e tipos; duas versões congeladas passaram typecheck em Santiago. Não equivalem a build de produção novo de0a5.
- Documentos: revisão/canvas e assinatura nativa possuem aceite local. A1 real e gov.br real ainda têm homologações pendentes; certificado e-CNPJ não disponibilizado. Isso não deve impedir o modo unsigned.
- Unsigned já tem contrato6puros, envelope5puros, preparação6puros/tipos e PDFs QA renderizados em drafts. Falta integrar publicação de nova versão, aprovação/OTP, seleção de bytes, envio/reconciliação e navegador completo. Não está pronto para produção.
- Reenvios foi preservado em drafts qualificados (reserva, geração, controller, transporte, finalizador). A retomada vem após a prioridade documental, sem perder artefatos.

## 3. Organização e sincronização

Uma coordenação, um histórico e um fluxo de relatórios: /mnt/apps/peticao-final/_ops/coordenacao-dupla/. Protocolo: /mnt/apps/peticao-final/_ops/coordenacao-dupla/PROTOCOLO.md. Dois coordenadores: admin01a1a4bd-cdf4-7253-88e7-0c9fb9265aa7; apoio/público01a1c0b3-f069-75a0-a2e9-e691094c9bab.

Antes de tocar código compartilhado: declarar arquivos/contratos/DB, reservar recurso e obter ACK de compatibilidade da outra sessão. Usar leases curtos na janela de integração, não manter toda a plataforma bloqueada durante drafts. Ao terminar: registrar commit real, testes, artefatos e liberação. Metadados são observados a cada30s; não são prova de execução nem substituem ACK. Histórico bruto, segredos e dados pessoais não entram no ledger ou Git.

Alteração pública nova deve avisar o admin automaticamente, com diff e manifesto. O admin avalia API/schema/domínios/instituições/CPF/consentimento/tokens/WhatsApp e adapta sua parte. Nenhuma sessão sobrescreve implicitamente backend, lockfile ou migrações da outra.

## 4. Integração cumulativa por níveis

Diretório proposto: /mnt/apps/peticao-final/peticao-integrado. Branch principal de integração: integration/admin-v2-publico-20261110, iniciada de0a5f734 (que já contém o patch público equivalente). Worktree local separada; preservar os dois candidatos. Não copiar .git/worktree, dependências ou bancos entre máquinas.

Para cada funcionalidade: branch específica → revisão cruzada → merge controlado na base cumulativa → testes dirigidos de backend/banco/navegador e build adequado → versão imutável. Ao fechar módulo: regressão do módulo e nova versão. Ao fechar seção: regressão da seção e nova versão. A base sempre incorpora as funcionalidades concluídas anteriormente.

Releases: integrado/r0000, integrado/r0001...; branches de trabalho por escopo. Artefatos protegidos fora do Git em /mnt/apps/peticao-final/_ops/releases-admin-publico/rNNNN/. Cada manifesto registra origem dos dois checkouts, commit, arquivos, funcionalidades/módulos/seções, concluído/pendente, schema, testes, runtime, build, hashes e rollback.

Estados distintos: fonte capturada, em validação, pronta para deploy, em deploy, publicada, falhou, revertida. r0000-source não é r0000-validated. Só declarar pronta após compatibilidade e artefato executável completo, não apenas uma pasta .next. Preservar secrets/HASH_PEPPER, bancos, exportações e builds fora dos commits. Migrations devem permitir retorno do código preservando dados posteriores; não restaurar banco destrutivamente por um simples rollback de versão.

## 5. Primeira entrega prioritária: documentos e petição

1. Nova versão de PDF de produção unsigned, sem TESTE e sem assinatura falsa, preservando conteúdo/assinaturas coletadas/versões anteriores.
2. Escolha explícita entre original sem assinatura, assinatura nativa, A1 e petição-base gov.br quando disponíveis. Original pode ser escolhido mesmo com versão assinada histórica, sem confundir seus bytes ou hashes.
3. Modo unsignedV3 próprio com alerta/aceite humano e aprovação existente; não afrouxar o V2 assinado nem exigir certificado/base gov.br nesse caminho.
4. Congelar versão/hash/lista/destinatários antes da aprovação. Usar identidade física estável por documento/destino, sem reiniciar deduplicação por UUID novo. Recuperar resposta perdida por consulta, nunca reenviar automaticamente resultado incerto.
5. Testar preparação→revisão→aprovação→envio dev→recibo/reconciliação, concorrência e falhas. Fazer previewPDF e percurso de navegador no conjunto público+admin.
6. Emitir r0001-documents-unsigned validada. Depois integrar recursos assinados individualmente, sem transformar ensaio sintético em homologação real.

## 6. Central privada de Versões e Deploy

Uma página acessível pela Tailnet listará versões, datas/commits, mudanças, o que terminou/falta, testes, compatibilidade, versão publicada e logs. Mostrará frontend público, frontend/backend admin e schema como uma única composição identificada.

Botão “Fazer deploy”: clique autenticado do proprietário autoriza publicar aquela versão exata em São Paulo, sem nova pergunta no chat. O servidor valida release imutável, autorização, compatibilidade e lease global; não aceita comando shell, target arbitrário ou caminho enviado pelo navegador. Resposta perdida leva a consultar o mesmo job, sem novo deploy automático.

Deploy terá staging, backup verificado, migrations controladas, troca de versão e smoke tests da página pública/admin/confirmação/documentos. Falha produz estado/log/alerta e recuperação documentada. Rollback de aplicação usa versão anterior compatível, preservando dados; qualquer ação de dados exige escopo próprio. Criar a central não publica nada agora.

O controle e o monitor persistem fora do processo atualizado, preferencialmente em VPS, para acompanhar inclusive queda/restart da aplicação. Implementar/testar com projeto fictício antes de habilitar São Paulo.

## 7. Vigia persistente e relatórios

Vigia acompanha jobs, versions/hashes, deploys, health checks e erros HTTP (4xx/5xx agrupados por endpoint, sem tokens/CPF/e-mails em URL/log). Correlaciona problemas com versão e operação. Nem todo4xx é bug; mostrar o fato e classificar a causa. Bugs sem evidência não são inventados.

Serviços persistentes supervisionados dão monitoramento contínuo, fila e recuperação. Agentes de IA analisam incidentes quando disponíveis; não prometer modelo100% acordado ou contornar créditos/permissões. Falha gera registro e resposta rastreável, não silêncio.

Relatório único por e-mail a cada1h para o destinatário já autorizado: ambas sessões/subagentes, atividades reais, commits, releases, testes, erros, pendências, percentuais e estimativa quando houver base. Timer já ativo, próximo15hPortoVelho na verificação. Não criar segundo timer nem repetir manualmente slots bloqueados/incertos. Aceite SMTP/API não comprova entrega.

## 8. Páginas locais e Tailnet

Inventariar todos os containers e processos web, com URL, host, origem/commit, autenticação, health e tipoHTML/API. Não confundir listenerHTTP ou socket com container ativo. Entregar lista completa e sinalizar links antigos quebrados.

Prioridade de acesso privado: versão integrada/documentos, admin somente leitura, formulário consolidado, CentralVersões/Vigia e ferramentas de apoio relevantes. Manter a prévia essencial para comparação. Novos endpoints só na Tailnet; não habilitar Funnel público por esta aprovação.

Escolher host por duas amostras de CPU/RAM/disco e importância operacional. FotoRO mostrou SãoPaulo menoscarregada, mas hospeda produção; só portais leves/isolados ali com limites, sem builds pesados. Santiago recebe integração/testes e serviços de controle se a carga permitir. Se não houver folga, manter serviço atual até reservar capacidade; não mover DB real ou aumentar custos automaticamente. Não instalar agentes/containers de repos não relacionados sem escopo.

Inventário/links verificados serão anexados a este plano. A prévia localFunnel443 retornou502; produção sancionaintegral.org200. Isso não é falha da produção.

## 9. Executor por e-mail: executor@exec.sancionaintegral.org

Criar após aprovação, em subdomínio isolado sem alterar os MX existentes do domínio principal. Confirmar capacidade de receber e enviar no provedor já contratado, custos e DNS:MX/SPF/DKIM/DMARC/TLS. LevantamentoRO encontrou exec ainda semregistros; nenhuma caixa foi criada. Não instalar um servidorSMTPaberto ou presumir que um remetente de marketing receba e-mails.

Serviço24h na VPS: recebimento→autenticação→ID/fila durável→ACK→roteamento→execução→resposta com andamento/resultado. Cada conversa mantém ID e sessão de destino; permitir nomes simples ADMIN/PÁGINA/APOIO/STATUS/LISTAR. Usar interface suportada do Codex, preservar contexto, evitar duas execuções sobre a mesma sessão e respeitar pausas, permissões, bloqueios e limites.

Autenticação não será só comparar From. Validar origem e vincular a conta do responsável por mecanismo criptográfico ou pareamento seguro, com nonce/dedup e teste de mensagens forjadas. Escolher o mecanismo compatível com seu cliente de e-mail na prova de conceito. Conteúdo citado/anexos/terceiros não vira instrução. Credenciais ficam protegidas, nunca em Git, chat ou relatório.

Se a máquina local/sessão/modelo cair, manter pedido na fila, informar erro/espera e disponibilizar consulta alternativa no portal. Nenhum pedido autenticado pode ser descartado silenciosamente. Serviço supervisionado busca prontidão24h; rede/provedor/IA impedem promessa literal100%. Uma falha de entrega também fica registrada; não fabricar resposta enviada.

Operações externas mantêm autorização concreta, versão/alvo e escopo. Pedido autenticado pode orientar trabalho; publicação continua vinculada a pedido específico/clique e aos gates de compatibilidade. Nada de execução irrestrita por mensagem recebida.

## 10. Ordem de execução e aceite

A. Aprovar este plano e atualizar/retomar um goal específico em cada sessão.
B. Criar baseline integrada, registrar protocolo/manifestos e publicar as prévias privadas aprovadas.
C. Em paralelo: concluir unsigned/documentos; montar catálogo de releases/CentralDeploy; preparar PoC autenticada do executor.
D. Primeiro release funcional integrado; ensaiar deploy/rollback em ambiente fictício e depois habilitar botãoSãoPaulo. Nenhum deployreal antes do clique/pedido correspondente.
E. Fechar módulos/seções em versões cumulativas; retomar Reenvios e demais prioridades após documental operacional.

Não prometer prazo global antes da baseline/build e da PoC de recebimento de e-mail. O aceite exige provas de cada escopo: URL real/autenticação, commit/build exatos, testes relevantes, envio dev sem duplicação, monitoramento, ACKs e rollback. Falta de certificado real bloqueia apenas a homologação desse modo, não o envio unsigned ou o restante independente.

## 11. Papéis e goals

Admin: documentos/assinaturas, contratos/backend e integrador da base cumulativa. Apoio/público: página pública, infraestrutura, CentralVersões/Deploy, Tailnet e único e-mail/Vigia. historico_comum: histórico e compatibilidade/leases, sem autoridade própria de publicar. Subagentes de código/testes recebem escopos disjuntos pelos pais. Executor/Vigia são serviços persistentes com supervisão, não sessõesLLM prometidas como eternas.

Goals para copiar: /mnt/apps/peticao-final/_ops/coordenacao-dupla/docs/GOAL-ADMIN-V2-20261110.txt e /mnt/apps/peticao-final/_ops/coordenacao-dupla/docs/GOAL-PAGINA-OPS-20261110.txt. Goals internos: /mnt/apps/peticao-final/_ops/coordenacao-dupla/docs/GOALS-SUBAGENTES-E-SERVICOS-20261110.md.


## Anexo — inventário e localização conferidos

Inventário local completo: /mnt/apps/peticao-final/_ops/coordenacao-dupla/reviews/INVENTARIO-PAGINAS-LOCAIS-20261110.md e .json. Medições das três máquinas e URLs: /mnt/apps/peticao-final/_ops/coordenacao-dupla/reviews/inventario-hosts-links-20261110/HOSTS.md e hosts.json. DNS/mail: DNS-MAIL.md nesse diretório. PonteCodex: CODEX-INTERFACE.md nesse diretório.

Duas amostras curtas: localCPU45,8→50,3%, Santiago75,6→61,7%, SãoPaulo3,3→2,0%; são fotos, não capacidade de pico. Local tem18containers ativos/16parados, root96%ocupado e /mnt/apps86%, swap9,64/9,65GiB; não inferir thrashing só por isso. Santiago semcontainers, SPumReacher; aplicações também rodam como serviços/processos.

Proposta de alocação após aprovação: prévias leves e limitadas podem usar SãoPaulo, que está menos carregada; nunca trocar serviços/DBprodução ou executar builds pesados ali. ControleVigia/filas e executor emVPS persistente, preferencialmenteSantiago se houver folga e com limites/umjobpesado; reavaliar carga no instante da instalação. A disponibilidade do computador local não deve ser requisito para ACK/status por e-mail. Hospedar um serviço emVPS não faz sessõesCodexlocais funcionarem com computador desligado; nesses casos o pedido espera e recebe estado.

LinksTailnet existentes: https://dell3576-zorin.tail1a6d71.ts.net:9443/ (espelhoadmin), https://dell3576-zorin.tail1a6d71.ts.net:8443/ (revisãoCPF), http://100.80.18.81:8766/ (dashboard remotoVigia/execução). Não são a nova integração; o candidatoadmin-v2-final atual não temlisteneridentificado. O Funnel público local443 retornou502/Unixconnectionrefused; a produção https://sancionaintegral.org retornou200. O inventário não modificou nenhum desses serviços.

O executor não está criado: exec.sancionaintegral.org não possui registros na consulta; existem capacidades inbound do provedor mas nenhuma rota configurada nessa coleta. Não alterar MXProton/Cloudflare principais nem presumir mailboxIMAP. A documentaçãoCodex confirma stdio/socketUnix, mas não comprova anexação segura ao processo atual: testar bridge→thread/resume/turn/start/turn/steer emsessãofictícia antesativação e jamais publicar app-server na internet.


### Decisões técnicas propostas para aprovação

- Nesta medição SãoPaulo é o hostmenoscarregado: propor primeiro as prévias leves importantes emcontainersisolados lá, comCPU/RAMlimitadas, bind/proxyexclusivoTailnet e prioridadeinferior àprodução. Construir/testaremSantiago; parar/reduzirprévias se o monitor detectar degradação da produção. Não moverprodução/DBreal e não expor bancos/terminal/SMTP.
- Preferir proxyTailnet do host existente; cada container não precisa ganhar um nó/chaveTailscale independente. Rotas/portas definitivas só após reserva e teste; não inventar URLs de serviços ainda não criados.
- Serviçoexecutor e controledeploy ficam fora da aplicação que é atualizada. Recebimento/ACK/fila emVPS; ponte local só quando a máquina estiver online. Levar o único scheduler de relatório e persistência de controle paraVPS na implantação24h, com cutover/fencing e desativação da cópia anterior, semdoiswriters/timers simultâneos. No estadoatual esses componentes ainda são locais e não operam com este computador desligado.
- Ensaiar schema/migrations também na versão efetiva PostgreSQL17 da produção; QA18.4 não é equivalência automática. Conferir o binárioNode usado pelo serviço, sematualizarversõesglobaisimplicitamente.
- Antes de prometer executorparaqualquersessão: PoC emconversa/projetofictício deve demonstrar ler/encaminhar a uma sessãoexistente ociosa e a uma ativa, receber eventos correlacionados, manter contexto e não duplicar execução. Se a interface atual impedir anexação, registrar o limite e manter recepção/fila/status, sem fingir pontefuncionando ou contornarsegurança.
- O modo unsigned mantém autenticação, revisão dos destinatários e aprovação de envio existente; remove somente assinatura digital como requisito desse caminho. Não altera assinaturas coletadas e não publica nada por si.


### Revisão cruzada do Apoio incorporada

Parecer: /mnt/apps/peticao-final/_ops/coordenacao-dupla/reviews/REVIEW-PLANO-OPS-20261110.md. Concordância técnica não equivale à aprovação do responsável.

1. E-mail: webhook de provedor externo não alcança Tailnetprivada. A implementação deve comprovar API/coletaautenticada de armazenamento disponível ou usar ingressoHTTPSexterno mínimo com autenticação/assinatura, tamanho limitado e replayprotection. Esse ingresso só recebe eventos de e-mail; não publica controleCodex, terminal, dashboard, broker ou executor. Respostas vão somente ao endereço do responsável pareado, nunca a Reply-To arbitrário.
2. Deploy: exigir Owner autenticado, CSRF/Origin, autorização vinculada a release+hash+destino e requestId idempotente. Clique autoriza versãoexata; mesma requisição consulta job existente e resultado incerto não é repetido automaticamente. Não executar shell/caminhos/alvos fornecidos pelo cliente.
3. Conferir manifesto/releaseefetiva emSãoPaulo e compatibilidade de migrations antesdecompor/publicar. Reparar o Funnel502 existente é ação separada das novas prévias e não pode apontar para admin/CPFprivados. Reavaliar folga do host antes da instalação.
