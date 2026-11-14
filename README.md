# Checkpoint completo de dados e restauração passiva na Civo

Este pacote prepara e restaura dados da fila **de desenvolvimento**. Não promove
a Civo, não para Santiago e não inicia serviços. O coordenador ativo continua
em Santiago. Não acessa o banco de assinaturas ou a fila de validação Nome–CPF.

## Conteúdo e consistência

O baseline fixa todas as linhas das tabelas, schema, sqlite_sequence, estados e
hashes de authority/config/version. A origem deve continuar sem tarefas não
terminais ou units de trabalho ativas. Qualquer mudança recusa a captura; não
há drain ou nova tentativa automática. O checkpoint inclui fontes, bundles e
os metadados/logs/artefatos dos jobs; exclui worktrees de execução, node_modules,
credenciais SSH, arquivos de ambiente privados e os demais nomes privados
recusados pelo recovery original.

O exportador acompanhante mantém o formato legado e preserva uma cópia base.
Fecha explicitamente as conexões SQLite e normaliza somente a cópia para DELETE
antes de calcular os hashes. Isso evita incluir WAL/SHM mutáveis do backup.
Acrescenta original_mode ao manifesto para preservar scripts executáveis.
O código recovery instalado permanece intacto e é importado somente após
verificação de hash e propriedade root. Os quatro módulos importados pelo
probe também são verificados por hash/propriedade antes de executar. Raízes
source/worker em symlink e target existente são recusados.

## Transporte e permissões

O checkpoint flui por SSH fixo/pinado diretamente ao GPG local. Não há arquivo
de plaintext salvo no Dell. O GPG usa a chave de transporte já existente do
bundle Civo, sem criar ou girar uma credencial. A descriptografia local em fluxo
deve reproduzir exatamente o hash e tamanho da origem antes da transferência.

O ciphertext segue por SSH para uma tentativa privada e exclusiva na Civo. Em
outra sessão SSH, o GPG recebe a chave somente por stdin/passphrase-fd, sem
arquivo de unlock no destino. Timeout não depende de uma segunda conexão para
apagar segredo persistido. Arquivo de unlock inesperado impede qualificação.
Nenhum valor entra em argv, logs ou Git. GPG, tmp e testes ficam em diretórios do projeto. O socket GPG da tentativa
real tem caminho curto; os testes root usam o diretório reservado .gpt1/ na
raiz do projeto para respeitar o limite de sockets Unix.

Dados restaurados pertencem à identidade existente vigia-coord UID999/GID987,
com shell nologin. Diretórios são 0700; arquivos 0600, ou 0700 quando o original
era executável. Bits setuid/setgid/sticky são recusados. Um processo real sem
privilégios lê todos os arquivos, verifica standby desarmado e prova recusa de
primary, dispatch, submit, cancel e import-source sem modificar a fila.

## Gatilhos e limites

O cliente exige fonte limpa, manifesto imutável, ACK independente de apoio e
uma lease **migration** própria de Infra para o recurso exato. Cada fase grava
uma intenção exclusiva antes do efeito externo. Timeout significa resultado
incerto, não permissão para repetir. capture-status/verify permitem observar
estado já gravado; não disparam outra captura ou restauração. decrypt-status
permite observar o recibo e hash após uma resposta perdida na descriptografia.

Não há start, stop, enable, reload, listener, timer, nova chave SSH ou promoção.
Não se adapta o gateway/replicação legados nem a configuração de topologia
contida no checkpoint. Bootstrap/RPC, ensaio de fencing, promoção, recuperação
operacional completa e backend remoto são etapas separadas. A prova de cópia
dos dados não será apresentada como infraestrutura distribuída pronta.

## Validação

Os testes usam somente fixtures. Incluem WAL da origem aberto, corrupção e
symlinks, script executável, schema/linhas/sequence, target ocupado, recusa de
ações de ativação, transporte incerto sem replay e GPG real com chave somente
em stdin, sem keyfile no destino tanto no sucesso quanto no erro. O helper sudo cria e remove apenas
fixtures próprias do projeto, sem criar contas ou alterar serviços do host.
Antes de testes compartilhados, reservar também /mnt/apps/peticao-final/.gpt1.
