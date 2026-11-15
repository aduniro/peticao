# Ensaio proposto: alias curto de trabalho

PREPARO. Não há executor, instalador, SSH ou operação systemd neste pacote.
Nenhuma propriedade foi aplicada a servidores. Não substituir o adapter atual.

Objetivo: validar `/run/peticao-dev-work` somente na namespace do trabalho,
vinculado ao StateDirectory que ProjectStorage já monta sobre armazenamento
físico em `/mnt/apps/peticao-final/.runtime`. TMPDIR será o filho `t` do alias.
O payload verifica um socket UNIX com nome de PostgreSQL e troca bytes fictícios.
Não inicializa PostgreSQL, não acessa bancos, credenciais ou redes externas.

O futuro pacote TEST deve integrar o adapter sucessor e a infraestrutura já
qualificada: IDs novos, código/interpretador pinados, limites de recursos,
UnitReferences viva, recibos, intent exclusivo, epoch e admission sintéticos,
observação inotify de temporários no host, stop/cgroups, desmontagem e retenção.
O payload precisa ser mapeado para os caminhos fixos do pacote revisado.
O delta exige `TemporaryFileSystem=/run:rw`. O filho informa fstype e dev/inode
de `/run`; a comparação com os metadados do host antes, DURANTE e depois deve
comprovar tmpfs privado, alias ausente no host e a namespace distinta.

O executor root deve provar, antes e depois, que o alias está ausente na namespace
do PID1 e conferir dev/inode contra ProjectStorage; igualdade declarada pelo
filho sozinha não comprova armazenamento físico. Revalidar mountinfo, ausência
de temporários do host e isolamento. A evidência só qualifica o alias, não os
perfis reais, o PostgreSQL, a distribuição ou a troca de coordenação.

`proposed_properties()` é um delta de propriedades, não uma unidade instalável.
Os testes locais incluem um socket UNIX real em diretório temporário no projeto;
as propriedades systemd e os metadados de namespace permanecem fixtures.
Ao copiar a suíte para um caminho longo, o revisor pode definir apenas para
os testes `PETICAO_ALIAS_TEST_TMPDIR` como seu diretório curto privado dentro do
projeto. Isso não muda caminhos, ambiente ou contrato do payload nativo.
