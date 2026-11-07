# Etapa 3 — consultas administrativas de mensagens

Implementação no candidato; não publicada. O endpoint `GET /api/admin/emails/mensagens` exige sessão ativa com nível Edição ou superior e as guardas existentes de origem/taxa. Respostas de dados usam `Cache-Control: no-store`. Não há novo aviso, componente ou mudança visual nesta etapa.

## Contrato de leitura

A lista admite `recipient` (endereço exato, sem busca parcial), `kind`, `channel`, `status`, `limit` (1–50) e `before` (cursor). Sem filtros, lê mensagens novas e logs legados ainda não vinculados. Cada linha tem chave `message:<uuid>` ou `legacy:<id>`; um log vinculado não aparece como mensagem adicional. Um log antigo é uma tentativa independente: não inventa identidade coletiva, conteúdo, entrega, abertura ou clique.

Na lista, `sent` legado significa `accepted`, e `failed` legado vira `indeterminate`, pois o log antigo não comprova recusa anterior ao aceite. No detalhe legado, o `status` original é preservado com `source=legacy_attempt`. O cliente deve respeitar essa proveniência. Estados não são prova de recebimento na caixa do destinatário.

`?id=message:<uuid>` consulta metadados e as cem tentativas mais recentes, com indicação explícita de truncamento. `?id=legacy:<id>` lê apenas o log sem vínculo, sem corpo/erro livre. Misturar ID com outros parâmetros, repetir chaves, usar parâmetros desconhecidos ou limites inválidos é recusado. Esta rota não escreve nem envia e-mails.

A paginação usa instante com seis casas decimais e chave em ordenação fixa, sem reduzir microssegundos à precisão do Date JavaScript. Como em qualquer histórico vivo, novas inserções anteriores ao cursor aparecem ao recarregar a primeira página; não há promessa de snapshot entre requisições. Cada consulta usa transação somente leitura e prazo de dois segundos. O cursor é posição, não credencial ou autorização.

## Dados excluídos

Não são selecionados assunto/corpo/anexos, payload da fila, ciphertext, fingerprint, chave do pedido, tokens ou erro livre do provedor. O estado de arquivo expirado é calculado pelo relógio do banco, sem apagar ou renovar conteúdo numa leitura. CPF, nascimento, nome da mãe, sexo e hashes de assinantes não integram esta consulta. Prévia de conteúdo, anexos e editor exigem contrato separado; não há endpoint de conteúdo bruto.

## Evidências e continuidade

Os testes específicos exercitam handler e banco fictício: permissões por nível, revogação, origem, filtros parametrizados, desempate de microssegundos, mistura de legado/novo, campos excluídos, expiração sem escrita, limites e truncamento. `tools/admin-qa/mail-history.mjs` confere o contrato HTTP compilado apenas no preview local isolado, com contas e e-mails fictícios.

Logs e relatório ficam em `/mnt/dev/peticao/.cache/admin-audit-20261106/`, prefixo `stage03-history-` e pasta `runtime-mail-history`. Este checkpoint não completa eventos/IDs reais dos provedores, recuperação de tentativas, retenção das cópias, prévia segura, conversas/editor, interface de triagem ou demais Etapas 2–7. Textos pendentes e autorização de deploy não são inferidos deste trabalho.

Resultado deste checkpoint: **335/335 cumulativos**, quatro testes específicos, build, tipos após build e HTTP compilado aprovados. A primeira execução HTTP foi preservada em `stage03-history-runtime-initial.log`: exigia igualdade literal de `Cache-Control`, mas a camada Next acrescenta diretivas. A verificação passou a exigir a diretiva `no-store`; nenhuma guarda de produção foi relaxada. O relatório final está em `runtime-mail-history/mail-history.json`. As duas sessões de QA foram revogadas em cada execução; o servidor temporário 3032 foi encerrado e a prévia 3031 retomada, com `/admin` respondendo 200. Nenhum e-mail foi escrito na pasta de saída dev deste teste. Não houve alteração de schema, interface, textos, dados reais ou instalação na VPS.
