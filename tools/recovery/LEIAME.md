# Recuperação isolada dos CPFs

## Rotina completa com um único comando

No terminal do Zorin, dentro de `/mnt/dev/peticao`, execute:

```bash
./atualizar-cpfs.py
```

Esse arquivo é autossuficiente: inclui os dois recuperadores, o exportador de
campos e o executor da VPS. Não depende dos demais arquivos desta pasta durante
a execução. Requer Python 3.11 ou superior, `ssh`, `scp` e o acesso `peticao-root`
já configurado no computador. Na VPS requer Python, PostgreSQL local e systemd.
Não execute o lançador com sudo: ele usa suas configurações e chaves SSH normais.

Antes de novas buscas, faz backups dos SQLite/CSV locais e da VPS para
`/mnt/dev/cpfs/backups/<execucao>/`, verificando integridade SQLite e SHA-256.
Backups da VPS também são preservados em `/root/peticao-recovery/backups/`.
Só depois do download e da verificação desses backups inicia as novas buscas.

Cria snapshots dos dois grupos antes das buscas longas e captura os campos do
formulário nesse momento, para que alterações posteriores dos cadastros pendentes
não mudem o conteúdo do CSV. O grupo de confirmados mantém o filtro anterior:
`status='confirmed'`, com hash de CPF e sem `cpf_name_check='match'`.
O outro inclui todos os pendentes com hash de CPF.

Executa as buscas sequencialmente em um serviço separado, limitado a meio núcleo
de CPU e 512 MiB. Os novos bancos ficam em `/root/peticao-recovery/runs/<execucao>/`.
Gera para cada grupo um SQLite e três CSVs: CPFs, nomes/CPFs e dados completos.
Baixa os oito arquivos para `/mnt/dev/cpfs/`, com identificador da execução nos
nomes, mais um manifesto de verificação. Não sobrescreve os resultados anteriores.

Mostra contagens a cada 30 segundos. Se fechar o terminal, o serviço já iniciado
continua na VPS. Execute o mesmo comando novamente para retomar o acompanhamento
e os downloads. Depois de uma execução concluída, repetir o comando inicia outra
atualização com novos snapshots e backups. Não permite dois lançadores locais
simultâneos. Se a busca esgotar os candidatos com faltantes, informa resultado
parcial explicitamente.

Não publica código, não reinicia serviços da aplicação, não chama a API CPF-Brasil
e não grava no PostgreSQL. Segredos ficam na VPS e não aparecem na saída.
Os snapshots podem conter dados pessoais; diretórios novos usam modo 700 e os
arquivos de dados usam 600. Não existe garantia de impacto zero: a rotina consome
CPU, memória e disco, sob os limites definidos.

`./atualizar-cpfs.py --check` confere o pacote interno sem acessar rede ou dados.
O fluxo foi testado com dados fictícios e SSH/serviços simulados; a execução real
depende do terminal do proprietário. Não confundir ferramenta pronta com buscas
ou downloads já concluídos.

`recover_cpfs.py` usa apenas a biblioteca padrão do Python e o `psql` da VPS.
Não importa nem modifica a aplicação. Não chama a API CPF-Brasil.

## Escopo e proteção

- Lê `HASH_PEPPER` e o endereço local do banco dentro do processo; não imprime valores.
- A conexão PostgreSQL usa autenticação local como `postgres`, por meio de `runuser`.
- Executa somente uma transação `READ ONLY` com snapshot consistente.
- Seleciona assinaturas **confirmadas**, com `cpf_hash`, cujo `cpf_name_check`
  é diferente de `match`, incluindo `NULL`. O resultado original é preservado.
- Não inclui assinaturas pendentes nem estrangeiros sem CPF.
- Copia identificador, nome, categoria, hash e os três horários originais como texto.
- O CPF recuperado é uma correspondência HMAC, não uma validação de titularidade.
- Não lê o cofre de infraestrutura nem as pastas de segredos do projeto.
- Não muda o segredo e não consulta os backups de configuração.
- SQLite e arquivo de bloqueio têm permissão `600`, em pasta root `700`.
- Exige acesso root para executar, mas não instala qualquer permissão para o agente.

## Execução pelo terminal do proprietário

No Zorin, execute cada comando e interrompa em caso de erro:

```bash
ssh peticao-root 'install -d -m 700 /root/peticao-recovery'
scp /mnt/dev/peticao/tools/recovery/recover_cpfs.py peticao-root:/root/peticao-recovery/recover_cpfs.py
ssh peticao-root 'python3 /root/peticao-recovery/recover_cpfs.py --max-candidates 100000'
```

O terceiro comando cria o snapshot e faz uma busca curta; `paused` significa que
há candidatos restantes, não uma falha. Verifique contagem e escopo antes da busca completa.
Se o comando falhar, não envie configurações, hashes ou dados pessoais: envie só a mensagem genérica.

Depois, execute a busca restante em segundo plano, limitada a meio núcleo de CPU:

```bash
ssh peticao-root 'systemd-run --unit=peticao-cpf-recovery --collect --property=CPUQuota=50% --property=MemoryMax=256M --property=UMask=0077 /usr/bin/python3 /root/peticao-recovery/recover_cpfs.py'
ssh peticao-root 'journalctl -u peticao-cpf-recovery -n 20 --no-pager'
```

O segredo não aparece nos argumentos nem no journal. O processo imprime apenas
contagens e velocidade. A busca pode demorar horas; o tempo real depende da VPS.
O consumo de memória depende também do tamanho do snapshot; o limite pode encerrar
o processo se a base for grande.

## Resultado e retomada

Resultado: `/root/peticao-recovery/assinaturas.sqlite`, inicialmente apenas na VPS.
Não substitui o banco da aplicação. Não publique nem anexe o SQLite à conversa.

`complete`: todos os hashes selecionados foram encontrados. `paused`: busca parcial.
`exhausted_with_pending`: todo o espaço foi percorrido, mas restaram hashes sem correspondência;
isso não comprova CPF incorreto, pois pode haver diferença de chave ou formato histórico.

Há checkpoint a cada 100 mil bases e na interrupção normal. Para parar:

```bash
ssh peticao-root 'systemctl stop peticao-cpf-recovery'
```

Repita o comando `systemd-run` para retomar. Não há novo snapshot na retomada,
não são adicionadas assinaturas posteriores, e uma chave diferente é recusada.
Não execute `deploy/publicar.sh` para esta tarefa.

## Monitor ao vivo com nomes e CPFs

O monitor é separado da busca. Pode ser instalado e aberto com o serviço já
rodando, sem interromper a recuperação:

```bash
scp /mnt/dev/peticao/tools/recovery/watch_recovery.py peticao-root:/root/peticao-recovery/watch_recovery.py
ssh -t peticao-root 'python3 /root/peticao-recovery/watch_recovery.py --show-personal-data'
```

Mostra as correspondências já recuperadas ao abrir e acrescenta cada nova
correspondência uma única vez, com identificador, nome e CPF formatado.
Exibe a cada dois segundos hashes correspondidos, CPFs recuperados, restantes,
posição da busca, velocidade e estimativa até o fim do espaço de candidatos.
Hashes correspondidos e CPFs recuperados têm a mesma contagem neste esquema.
A estimativa mede o fim do espaço, não o instante em que o último CPF será encontrado.

O monitor lê exclusivamente o SQLite em modo `ro`, sem abrir `app.env` ou
PostgreSQL. Reflete apenas dados já confirmados pelos checkpoints da busca
(a cada 100 mil bases); pode haver atraso até o próximo checkpoint.
Nomes e CPFs aparecem somente com a opção explícita e um terminal interativo;
não são acrescentados aos logs do serviço. Não inicie o monitor com `systemd-run`.
Sem `--show-personal-data`, mostra apenas contagens.

`Ctrl+C` ou fechar a conexão encerra apenas o monitor; a busca continua no serviço.
Se não houver processo de busca ativo, mostra o resultado atual e encerra.
As associações mostradas são com o nome declarado na assinatura; a API ainda
não confirmou se esse nome pertence ao CPF.

## Recuperação separada das assinaturas não confirmadas

`recover_pending_cpfs.py` é independente do recuperador anterior. Seleciona
`status = 'pending' AND cpf_hash IS NOT NULL`, mesmo se já houver conferência
nome/CPF, e usa `/root/peticao-recovery/assinaturas-pendentes.sqlite`.
Não abre nem substitui o SQLite dos confirmados. Também recusa retomar um
SQLite cuja seleção registrada pertença a outro escopo.

```bash
scp /mnt/dev/peticao/tools/recovery/recover_pending_cpfs.py peticao-root:/root/peticao-recovery/recover_pending_cpfs.py
ssh peticao-root 'systemd-run --unit=peticao-cpf-recovery-pending --collect --property=CPUQuota=50% --property=MemoryMax=256M --property=UMask=0077 /usr/bin/python3 /root/peticao-recovery/recover_pending_cpfs.py'
ssh -t peticao-root 'python3 /root/peticao-recovery/watch_recovery.py --output /root/peticao-recovery/assinaturas-pendentes.sqlite --show-personal-data'
```

Se o monitor for aberto antes da criação do SQLite, aguarde e execute-o novamente.
O monitor existente funciona com esse banco mediante `--output`.
Para uma execução inicial curta, use `python3 .../recover_pending_cpfs.py --max-candidates 100000`
na VPS antes de iniciar o serviço. O serviço retomará o ponto salvo.

O grupo corresponde aos pendentes existentes no instante do snapshot. Confirmações
e novos cadastros posteriores não alteram esse grupo, inclusive em retomadas.
Os horários originais são copiados literalmente e `confirmed_at` permanece nulo
quando assim estava na origem. Não confirma assinaturas nem chama a API.

Para parar apenas esta busca:

```bash
ssh peticao-root 'systemctl stop peticao-cpf-recovery-pending'
```

Repita o comando `systemd-run` acima para retomar. Para baixar uma cópia depois
da conclusão:

```bash
scp peticao-root:/root/peticao-recovery/assinaturas-pendentes.sqlite /mnt/dev/peticao/assinaturas-pendentes-recuperadas.sqlite
```

Os exportadores existentes aceitam este banco com `--source`; forneça também
`--output` separado para os CSVs dos pendentes. O exportador de dados completos
exige que os mesmos IDs e hashes ainda estejam no PostgreSQL.

## CSV com todos os campos persistidos do formulário

`export_full.py` cruza os IDs e hashes do SQLite com o PostgreSQL em transação
somente leitura. Exige que todos os registros recuperados ainda existam com os
mesmos IDs e hashes; caso contrário, recusa a exportação. Não exporta assinaturas
fora desse grupo. Nomes e demais campos vêm do estado atual do PostgreSQL;
os CPFs vêm do SQLite recuperado. Não altera os horários.

```bash
scp /mnt/dev/peticao/tools/recovery/export_full.py peticao-root:/root/peticao-recovery/export_full.py
ssh peticao-root 'python3 /root/peticao-recovery/export_full.py'
scp peticao-root:/root/peticao-recovery/dados-completos-recuperados.csv /mnt/dev/peticao/dados-completos-recuperados.csv
```

O CSV tem 24 colunas: ID, nome, CPF, e-mail, categoria, instituição, cargo, campus,
município, UF, país, universidade, idioma, indicadores de instituição/campus
listados, códigos IBGE, declarações e critérios regionais, resultado anterior da
conferência nome/CPF e horários de criação, consentimento e confirmação.
Campos não aplicáveis permanecem vazios. CPF é texto com 11 dígitos.
Não inclui segredos, hashes, tokens, IPs ou dados de navegação.
Nascimento e nome da mãe não foram persistidos e não podem ser recuperados por
esta exportação. É uma exportação dos campos armazenados, não uma reprodução de
respostas transitórias ou da grafia original anterior à normalização do app.
Arquivos existentes não são sobrescritos; em outra exportação use `--output`.

## Validação realizada

Testes locais com registros fictícios verificaram geração de CPF, recuperação HMAC,
retomada, preservação literal dos horários, modo `600` e recusa de chave diferente.
O acesso real ao PostgreSQL da VPS ainda depende da execução pelo proprietário.

Testes do monitor: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/recovery -p 'test_*.py'`.
Verificam leitura sem modificação do SQLite, atualização ao vivo sem repetir linhas,
detecção de bloqueio da busca, remoção de controles de terminal dos nomes e recusa
de exibir dados pessoais em saída redirecionada.
