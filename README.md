# Detalhes operacionais atuais na árvore do relatório — rascunho

Raiz privada: /mnt/apps/peticao-final/_ops/report-step-evidence-fix-20261111. Nenhuma fonte canônica foi alterada e nenhum e-mail/envio foi solicitado. App e serviços não são modificados por este patch.

O coletor anterior calculava corretamente f-5.1.2 em75%/running, mas descartava steps.detail e devolvia evidence=[]; renderLiveTree ignorava ambas as informações. Assim o e-mail horário não informava19HTTP aprovados e UI autenticada pendente.

Três arquivos de produção propostos:

* collect.py: SELECT inclui detalhe SOMENTE das etapas admin-v2-progresso-arvore, limitado8192caracteres no SQL; sanitização/redação e limite1500. Nenhum detalhe novo de outros processos/solicitações é exportado. Árvores usam note/evidence dos registros atuais; demais campos e pesos permanecem iguais.
* tree-render.mjs: detalhes/evidências aparecem escapados e com wordwrap dentro da mesma célulaHTML, fonte13herdada, cores/colunas/barras preservadas. SVG permanece a mesma árvore gráfica cumulativa. Caminhos são texto, nunca anchors ou execução.
* report.mjs: CSV e texto incluem os mesmos dados; nenhum código de envio, destinatário, timer, slots ou outbox foi alterado.

Evidências limitadas a4caminhos absolutos técnicos de até512caracteres, sob /mnt/apps/peticao-final ou /mnt/dev/.peticao-. Caminhos são extraídos literalmente, sem read/resolve/stat/fetch e sem ler seus conteúdos. Traversal/arquivos privados conhecidos são excluídos. Sufixo truncado não vira evidência. E-mails/identificadores/segredos declarados por token/password/etc são redigidos, como a política de saída já existente.

O cálculo continua exclusivamente folhas/pesos/estados, nunca números encontrados no detalhe. Um teste antigo proibia qualquertexto99% em toda árvore: o novo requisito passa a permitir tal texto em note, mas a regressão continua exigindo que o cálculo real permaneça30%, independente dessa string.

Provas dirigidas:10testesPython passaram, incluindo readonlyDB/semalteração,75%+19HTTP+UIpendente+receiptatual, limites/redação/nenhuma leitura de links e integração coletaRO→renderHTML/CSV/texto com HTMLescaping. A integração importa apenas renderReport; não chama main/deliver, --send, provider, keystore ou outbox. Tests antigos de envio manual não foram executados.

Prévia operacional sanitizada em evidence/current-preview.html, gerada por coletaRO atual e função pura renderReport. Não é nova homologaçãoUI/PG e não foi enviada.

## Alvos futuros distintos, aplicação pelo root após revisão

Os arquivos versionados e os usados pelo timer são cópias em inodes diferentes; os três devem ser atualizados atomicamente em AMBAS as raízes depois da revisão/ACK/lease do responsável:

/mnt/apps/peticao-final/_ops/coordenacao-dupla/versioned-report/collect.py
/mnt/apps/peticao-final/_ops/coordenacao-dupla/versioned-report/tree-render.mjs
/mnt/apps/peticao-final/_ops/coordenacao-dupla/versioned-report/report.mjs
/mnt/apps/peticao-final/peticao/.cache/relatorios-periodicos-20261109/collect.py
/mnt/apps/peticao-final/peticao/.cache/relatorios-periodicos-20261109/tree-render.mjs
/mnt/apps/peticao-final/peticao/.cache/relatorios-periodicos-20261109/report.mjs

O timer existente permanece ativo; este artefato não o reinicia nem dispara serviço. Baselines e hashes exatos estão no manifesto.

Reprodução isolada sem envio:

```bash
/usr/bin/python3 -B -m unittest discover -s /mnt/apps/peticao-final/_ops/report-step-evidence-fix-20261111 -p test_collect.py -v
```

Não executar report.mjs --send. Nenhum certificado/config/segredo/banco pessoal foi copiado. Esta pasta contém somente fonte operacional e evidência sanitizada de QA.
