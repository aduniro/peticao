# Registro de coordenação — criação do worktree de layout

A primeira tentativa de aquisição usou o recurso `ref:refs/heads/feat/materials-layout-assessment-20261111`. O ledger recusou o prefixo com `Recurso invalido`; os prefixos aceitos são path/code/deploy/db/coord.

O comando de shell tinha a criação do worktree em outra linha e não estava configurado para falhar de forma fechada. Por isso criou `/mnt/apps/peticao-final/_ops/drafts/materials-layout-20261111` e a branch `feat/materials-layout-assessment-20261111` mesmo após o Python terminar com erro. Isso ocorreu antes de uma lease válida. Nenhuma fonte foi editada nesse intervalo. O resultado de `git worktree add` registrou HEAD na base `12224c3f5654f6a4d727d2ee5aa4a0e794060067`.

O agente informou o root, preservou worktree/ref e corrigiu a reserva para os dois caminhos físicos:

- `/mnt/apps/peticao-final/_ops/drafts/materials-layout-20261111`;
- `/mnt/apps/peticao-final/peticao/.git/refs/heads/feat/materials-layout-assessment-20261111`.

O ledger concedeu a lease com fence 180 antes da primeira escrita de fonte. A consulta explícita posterior confirmou a lease válida, HEAD ainda na base 12224 e nenhum arquivo rastreado alterado; o único arquivo novo era o avaliador escrito após a concessão. Não houve exclusão de worktree/ref, alteração da prévia, takeover ou mudança na base integrada. Não se alega uma consulta Git de limpeza antes da aquisição que não foi realizada.

Prevenção adotada: aquisição e mutação dependente em chamadas separadas; verificar returncode e `ok` no Python antes de prosseguir. Uma recusa/conflito de lease interrompe a escrita e deve ser informada. Não encadear novamente uma mutação em shell que continua depois da falha de aquisição.
