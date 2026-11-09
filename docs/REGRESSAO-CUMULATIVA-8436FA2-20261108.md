# Regressão cumulativa congelada — 8436fa2

A repetição integral concluiu **534/534 aprovados**, zero falhas, cancelados ou
ignorados. Commit exato `8436fa2485f79139f97a834c08b5a75b9d825ec6`,114 arquivos,
Node18.19.1, PostgreSQL fictício exclusivo54351, arquivos serializados e corridas
internas preservadas, heap Node limitado a1536MiB. Nenhum transporte real.

Cópia de código isolada:
`/mnt/dev/peticao/.cache/admin-integration/candidate-stage02-regression-8436fa2`.
Dependências já instaladas foram reutilizadas; ambiente vazio de credenciais e
configuração de produção. Nenhum backup, banco real ou revisão de CPF foi copiado.
A fonte rastreada permaneceu limpa no início e no fim da execução.

## Falha inicial e correção do ambiente

Primeira rodada:531/534, zero cancelados/ignorados. As três falhas foram
`admin-ip`, `geo-coexistencia` e `geo-retry`. A cópia Git não incluía `geo-data`,
dependência pública não versionada presente no ambiente anterior. Não era prova
de regressão funcional do código e não foi registrada como aprovação.

Disponibilizadas as duas bases públicas MMDB por link na cópia de QA, sem alterar
aplicação, geofence ou testes, os três dirigidos passaram3/3. Repetida então toda
a bateria, com o mesmo código e parâmetros, para obter resultado integral limpo.

- Inicial: `/tmp/admin-cumulative-8436fa2-vmctr2v0/validation.log`.
- Dirigidos: `/tmp/admin-cumulative-8436fa2-5yjgt96n/validation.log`.
- Final: `/tmp/admin-cumulative-8436fa2-1n8_7fgz/validation.log`.
- Resultado e horários: `execution.json` na pasta final. Saída0,660214ms.

Cópias verificadas dos logs, resultado e checksums preservadas em
`.cache/qa-cumulative-8436fa2-20261108/`, ignorada pelo Git. O banco de QA foi
encerrado pelo runner; a cópia fonte foi mantida para rastreabilidade.
O monitor foi atualizado e o relatório HTML ao dono foi aceito pelo provedor.

## Limites do aceite

Este resultado se aplica EXCLUSIVAMENTE a8436fa2. Não abrange as correções
posteriores de conciliação/AV17 (`f549418`), preparo atômico (`fdc77b2`), captura
consistente da lista (`e6c2665`) ou desenvolvimento seguinte. O candidato final
precisa de verificação cumulativa e visual própria. Não conclui o admin-v2 inteiro,
não autoriza deploy/merge e não comprova disponibilidade de provedores externos.
