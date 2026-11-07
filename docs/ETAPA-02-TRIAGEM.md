# Etapa 2 — triagem interna e campus ausente

Implementação local em andamento. Não publicada e sem alterações de layout, textos ou decisões existentes. A triagem é diagnóstico por regras, não autenticação do remetente nem autorização de alteração/envio.

## Contrato implementado

A classificação reaproveita a prioridade e os padrões de `tools/ponte/triagem-lib.mjs`, acrescentando campus. A coleta por SSH de `triagem.mjs` não é levada ao app: as consultas usam parâmetros, campos permitidos e uma transação de leitura com snapshot consistente. Falha de uma fonte fica explícita, usando savepoint; nunca vira lista vazia interpretada como prova de ausência. Os recortes são limitados; truncamento também produz análise inconclusiva.

A coleta usa somente metadados de cadastro, tentativas de confirmação/reenvio, eventos por endereço, bloqueio e contagens da fila. Não consulta colunas de CPF/hash do CPF, tokens, nascimento, mãe, sexo ou telefone, nem cache de identidade ou payloads de e-mail. O corpo do contato participa da classificação em memória; não é duplicado no snapshot persistido. O original continua na própria mensagem. A versão guarda fingerprint HMAC do input, com domínio próprio e o helper existente (sem alterar pepper ou hashes de CPF), e evidências estruturadas, sem copiar texto livre que possa conter dados pessoais.

Um envio aceito não prova entrega. Eventos por endereço ainda não são correlacionados a uma mensagem individual. Nome compatível não prova confirmação de identidade. Confirmação anterior ao relato não resolve automaticamente um relato novo; cadastros múltiplos, fontes indisponíveis e truncamento ficam inconclusivos. Remoção/correção exige conferir controle do solicitante; nenhuma análise modifica o cadastro ou dispara resposta.

Campus é uma proposta baseada em `ifes.json`, `municipios.json` e critérios regionais existentes. Município homônimo exige desambiguação; não se presume a UF da sede. Município conhecido fora da lista de campi exige fonte oficial adicional. Não altera as listas, exceções regionais ou assinaturas.

## Persistência e retomada

A sétima tabela administrativa, `contact_triage_jobs`, conserva revisões. Há uma única revisão ativa por contato. Reanalisar cria outra revisão e preserva resultados anteriores. Descoberta limitada inclui todo o backlog sem trabalho anterior; não usa o cursor nem o marco temporal do Vigia externo. Isso reanalisa evidências, sem reenviar respostas antigas ou alterar decisões humanas.

O agendador existente, autenticado antes de qualquer trabalho, descobre até 25 contatos e processa até três pedidos por chamada, com orçamento entre pedidos e timeout nas consultas. Posse por token/prazo do banco impede finalização por trabalhador antigo. Há três tentativas técnicas; queda no último processamento termina como falha após expirar. A recuperação é limitada e usa `SKIP LOCKED`. Fonte alterada durante a leitura reencaminha a mesma revisão pendente, sem publicar evidência antiga. Resultado e auditoria são transacionais; erros gravam códigos estáticos, sem texto de exceções.

GET/POST `/api/admin/contato/triagem` exigem Edição. A autoria vem da sessão e a origem é conferida. O histórico retorna até dez revisões e não expõe a posse do trabalhador. Não há importação das decisões do SQLite local nem escrita no banco de revisão.

## Ainda pendente

A integração visual no Contato aguarda AV-8: “Análise automática”, “Reanalisar”, “Evidências”, “Sugestão de resposta” e “Revise a análise antes de responder. Nenhuma resposta é enviada automaticamente”. Não foram inseridos esses textos. Minutas humanas, atualização após novos eventos, informe operacional durável somente ao dono e fluxo de curadoria/aprovação de campus ainda precisam ser integrados; este checkpoint não conclui a Etapa 2. O Vigia externo permanece ligado e não recebe chave/root dentro do app.

O motor atual é `contact-triage-v1`. Alterações futuras do motor precisam definir o tratamento das revisões pendentes antes de mudar essa versão; o ensaio atual não é prova de migração entre motores diferentes. Etapas 3–7 e pendências anteriores continuam no objetivo.


## Validação deste checkpoint

**307/307** cumulativos finais, tipos, build e migração antiga → sete tabelas aditivas aprovados. Os 15 testes novos cobrem categorias, limites da evidência, campus/homônimos, campos permitidos, retomada/posse expirada, concorrência, revisão preservada, alteração de fonte, tentativas/exaustão, rollback de auditoria, API por nível/origem/autor e agendador autenticado. Dados fictícios; nenhum acesso à API CPF-Brasil.

O roteiro `tools/admin-qa/triage.mjs` atravessou os handlers compilados, sessão de Edição e agendador reais do preview: análise completa, nova versão, versão anterior preservada e ausência de escrita em assinaturas/envio a participantes. O teste recusa banco/host externos e contatos sem marca de QA. Foram preservados os registros fictícios e revogada a sessão. Não é QA visual de um painel novo: nenhum controle novo foi ativado.

Evidências em `/mnt/dev/peticao/.cache/admin-audit-20261106/`: `stage02-cumulative-hmac.log`, `stage02-build-hmac.log`, `stage02-typecheck-hmac-serial.log`, `stage02-migration.log`, `stage02-triage-expanded-final.log`, `stage02-runtime-hmac.log` e `runtime-triage-hmac/triage.json`. O HMAC foi incluído na revisão final e a suíte/build/HTTP foram repetidos sobre essa versão. A execução de tipos paralela ao build encontrou arquivos gerados do Next removidos pelo próprio build; o log foi preservado e a conferência serial posterior passou. Não repetir essa concorrência entre build e tipos.

Os avisos AV-1–AV-8 foram reunidos e enviados somente ao dono por e-mail para revisão; continuam pendentes de resposta. Prévia 3031 retomada; servidor temporário 3032 encerrado. Nenhum deploy ou alteração da VPS/revisão local de CPFs nesta etapa.
