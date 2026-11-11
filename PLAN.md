# Materiais: aplicativo Next compilado e prévia autenticada

Preparação local. Nenhum build, instalação, PostgreSQL, aplicativo ou HTTP real foi executado nesta etapa. `config.json` mantém `infra_reviewed=false`. Não é deploy nem validação da produção.

## Fonte e receita

- Fonte Git exata: `/mnt/apps/peticao-final/_ops/drafts/materials-preview-api-20261111`, commit `140ce6b98af23045849335693a82b426fdc9c826`.
- Receita de referência: `/mnt/dev/.peticao-r0002-production-profile-20261111/production_profile.py` e `/mnt/dev/.peticao-r0002-production-profile-20261111/portable_runtime.py`. Os scripts antigos foram lidos, não executados.
- Todo scratch, run e export novo ficam em `/mnt/apps/peticao-final/_ops/qa-materials-app-http-20261111`. Não usar a partição quase cheia de `/mnt/dev`.
- O Git fornece somente os 1.246 arquivos regulares da allowlist, 20.038.250 bytes. `source-manifest.json` fixa tamanho, SHA e objeto Git. Nenhum `.env*`, diretório de segredos, banco, estado de prévia ou `node_modules` é copiado. `site/src/lib/secrets.ts` é fonte regular, não armazenamento de credenciais.
- `site/package.json`, `site/package-lock.json` e `site/next.config.mjs` não diferem da base f555. O helper cliente não está nesta fonte e não será transplantado.
- Node fixo: `/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node`, SHA `b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac`, versão 20.19.2.
- Cache compartilhado: `/home/barre/.cache/peticao-admin-deps-preview-v1/node_modules`, apenas leitura, com inventário SHA completo em `dependency-cache-manifest.json`. O inventário será conferido antes e depois do build; uma divergência aborta, sem reinstalação automática.
- PDFjs somente pelo arquivo offline previamente usado, com tamanho e SHA512 do lock da nova fonte. Nada será baixado.

## Fase A: build e exportação

1. Revisão independente dos scripts e dos pinos, seguida de ativação explícita da configuração. A preparação não a efetua.
2. Uma unidade de usuário exclusiva `peticao-materials-production-build-20261111.service`, com `RemainAfterExit=yes`, CPU máxima 300%, memória máxima 5 GiB, TasksMax 256, RuntimeMaxSec 930, TimeoutStopSec 120 e KillMode control-group. O perfil valida o nome efetivo do cgroup e os limites reais.
3. Piso de 4 GiB livres antes do build. Um marcador exclusivo impede repetição automática da execução.
4. Exportar os objetos Git para uma cópia privada sem `.git`. Vincular o cache de dependências somente nessa cópia. Não editar a fonte nem o cache.
5. Ambiente allowlisted de produção, sem `PREVIEW_MODE` ou bypass de senha, HOME e diretórios de credenciais vazios, e-mail dev, destinatários/approver/cron vazios, WhatsApp desligado e SIGNER none. DATABASE_URL fictícia na porta 1, recusada pelo guard.
6. Guard R0002 com alteração apenas do namespace: bloqueia DNS, TCP externo, TLS, UDP e fetch externo; preserva somente o IPC privado necessário aos workers de build. Isso é proteção no processo Node, não isolamento de rede do sistema operacional.
7. Preparar PDFjs offline e executar o Next build real com prazo de 900 s. Preservar logs, exit, PIDs/grupo, inventários da fonte, dos assets, do perfil e das dependências. Cancelamento não significa sucesso.
8. Só exportar após os gates de sucesso, guard sem violações e drenagem. Piso de 3 GiB antes da exportação. O novo runtime materializa somente a closure de produção e recebe manifesto/tar com SHA de todos os arquivos.
9. O runtime antigo f555 não contém os endpoints novos e não pode ser usado como prova desta fonte. Compatibilidade do host de produção permanece uma evidência parcial distinta.
10. Capturar Result/ExecMainCode/ExecMainStatus/InvocationID da unidade ainda carregada e retida, antes do STOP intencional. Uma unidade ausente não prova exit zero.

## Fase B: HTTP real — contrato preparado, launcher ainda pendente

`materials_http.py` define assertions para chamadas ao Next real. Não cria servidor alternativo e não executa sozinho. Ainda faltam o launcher, a fixture/admissão de PG e os pinos do novo runtime. A bateria não está pronta para execução.

- PostgreSQL 17.11 local, imagem fixa `sha256:665dc7b37ac52a17e298511414c21d23ffa4e6a6ef6225b3e5d59c7afb35e994`, usuário/banco `fixture_only`, cluster_name nonce e verificação TCP antes de qualquer SQL.
- Reaproveitar o controlador create90 aceito, sem novo framework: prelatched uncertain antes de mutações, identidade de container/rede por nonce, nenhum retry automático e dependências mantidas se houver resultado incerto. Bridge exclusiva normal e publicação apenas em `127.0.0.1:55497`; não usar bridge internal, que já falhou na instalação local.
- Listener Next somente `127.0.0.1:31397`. Conferir ambas as portas livres sob lease antes de iniciar. Unidade HTTP distinta, limitada a CPU2/Mem3G/Tasks256, prazo lógico 600 s mais janela de cleanup 120 s, retida ao terminar. Limites do container PG são adicionais: CPU1/Mem512M/tmpfs256M.
- Fixture aplica o schema base e o DDL Materiais exatos da fonte pinada. Semeia somente usuários fictícios edição/leitura e suas senhas scrypt, nunca materiais/versões/recibos. Login e sessão vêm da rota real `/api/admin/login`; nenhum bypass de autenticação.
- MAIL_PROVIDER e MAIL_PROVIDERS dev, spool privado vazio, recipients/approver/cron vazios. Todos os recursos de assinatura, publicação documental, WhatsApp e provedores externos desligados. Sem PFX, mensagens, Contatos, IA ou R16.
- Guard runtime derivado da receita Next aceita: permitir somente conexão PG na porta fixa e listen na porta fixa de loopback; negar outros destinos, TLS, DNS externo, UDP, fetch e subprocessos. Fixar os asserts às flags desta fixture; não herdar PRESIDENT_OWN_ENABLED=1.
- O protocolo deve comprovar: anônimo 401; login real; create real v1; recuperação do pedido; revise CAS para v2; replay antigo continua v1; CAS obsoleto 409; histórico v2/v1; leitura não grava; pedido é restrito ao ator; archive acrescenta v3; preview v1 após head v3 continua exatamente v1; query duplicada 400; par versão/revisão incorreto 404; UUID desconhecido 404; biblioteca arquivada retorna v3; recibo continua v1.
- Prévia: conferir HTML da versão solicitada, SHA canônico, headers de versão/head, escopo histórico, Cache-Control, nosniff, SAMEORIGIN, no-referrer e CSP com SHA256 do style real. Nenhum browser ou teste de UI é alegado por essa bateria HTTP.
- Depois: contagens exatas head1/versões3/recibos3, autoria/auditoria correspondentes, nenhuma tabela de mensagens/envio/assinatura alterada, spool vazio, bytes do runtime/cache estáveis, guard instalado no PID real e zero violações.
- Cleanup exige ownership/nonce/UID/identidade, container e rede confirmadamente ausentes, processos e cgroup drenados, portas fechadas e unidade retida com resultado real. Não remover recursos desconhecidos ou incertos.

## Aceite e limites

A Fase A só está preparada após revisão do freeze; build ainda não realizado. A Fase B possui apenas o contrato de assertions e esta receita, não um launcher aprovado. Nenhuma porcentagem de conclusão funcional muda por estes testes puros. Build, HTTP, UI, integração, produção, merge e deploy são estados separados.
