# Vigia

A versão completa, com abas, Git, IA e terminais por tarefa, está em construção.

## Monitor imediato de uma tela

Execute **`vigia-simples`** em outro terminal. O alias foi acrescentado a `/home/barre/.bash_aliases`, com cópia de segurança do arquivo anterior; o executável também está em `/home/barre/.local/bin/vigia-simples`.

Comando completo: `/mnt/dev/peticao/vigia-simples`.

- `q`: sair sem interromper tarefas ou serviços.
- `j` / `k`: percorrer os processos.
- Espaço: pausar somente a atualização da tela.
- `r`: atualizar.
- Em terminais pequenos, usa apresentação compacta; em terminais maiores, mostra detalhes.
- `--uma-vez` imprime um retrato; `--json` retorna dados estruturados; `--sem-vps` dispensa SSH.

A tela distingue atualizações registradas pelos agentes de processos/serviços observados diretamente. Estado do agente com mais de três minutos aparece sem atualização recente; não é transformado automaticamente em execução comprovada. Percentuais aparecem somente quando o agente informa itens concluídos e total fixo. Sem isso, não se inventa porcentagem.

A coleta local ocorre a cada dois segundos; a VPS é consultada a cada dez, por comando SSH fixo somente leitura. Mostra indisponibilidade e horário da última coleta. Ter arquivos de um módulo e build presentes não comprova, sozinho, que um deploy foi validado.

Não lê credenciais, entradas do formulário, arquivos de ambiente ou dados de assinantes. Argumentos de processos não são impressos. O monitor não inicia testes, modifica o servidor ou faz consultas CPF. Fechar a tela não cancela as atividades acompanhadas; enquanto fechada esta versão simples não coleta amostras novas. Os coletores persistentes pertencem à versão completa.

## Atualização pelos agentes

Use `/mnt/dev/peticao/vigia-simples --register identificador --title 'Título' --state running --stage 'Etapa real' --environment local --scope 'Backend' --detail 'Resumo verificável'`. Estados: `queued`, `running`, `waiting`, `interrupted`, `failed`, `completed`.

`--done N --total M` só deve ser usado para conjuntos efetivamente mensuráveis. O registro fica em `/home/barre/.local/state/peticao-monitor/simple/activities`, com modo 600; não é exportação de dados pessoais. O agente do deploy de diagnóstico já está integrado a essa atualização.

## Validação

`python3 -m unittest discover -s /mnt/dev/peticao/tools/monitor/tests -p test_simples.py -v`.

Cobertura: escrita atômica, preservação de criação, permissões, validação de total/identificador, filtragem de sequências de terminal, arquivos corrompidos e renderização compacta/detalhada. Os seis testes incluem uma sessão PTY real, com teclas em sequência e encerramento. Um travamento causado pelo buffer de entrada foi corrigido e coberto por regressão. A consulta somente leitura da VPS também foi exercitada.
