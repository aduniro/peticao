# Controle operacional privado

Fontes: `/mnt/apps/peticao-final/_ops/controle-operacional`.

Coordenação única e leases: `/mnt/apps/peticao-final/_ops/coordenacao-dupla`.

Esta árvore reúne o catálogo privado de versões, autenticação Owner, fila de
instruções por e-mail, transporte funcional de respostas, gateway local e
adaptador de publicação. Não é o site público nem o banco de assinaturas.

O catálogo exige versão e artefato imutáveis. O deploy de admin-v2 depende da
autorização específica do responsável, ACK de compatibilidade e lease vigente.
O adaptador SP e o gateway real permanecem desabilitados até qualificação.
Testes fictícios não comprovam envio, entrega ou execução contínua.

Dados de execução, credenciais, spool e provas privadas permanecem fora do Git.
O relatório periódico usa o mecanismo único já existente; o transporte desta
árvore atende apenas mensagens funcionais, códigos de acesso e respostas.

Testes locais, sem executar efeitos reais:

```sh
/usr/bin/python3 -m unittest discover -s /mnt/apps/peticao-final/_ops/controle-operacional/tests -p 'test*.py' -v
```

Contratos por componente:

- `/mnt/apps/peticao-final/_ops/controle-operacional/console/CONTRACT.md`
- `/mnt/apps/peticao-final/_ops/controle-operacional/executor/README.md`
- `/mnt/apps/peticao-final/_ops/controle-operacional/deploy/CONTRATO-SP.md`
- `/mnt/apps/peticao-final/_ops/controle-operacional/infra/LOCAL-CODEX-GATEWAY.md`
