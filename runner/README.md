# Runner de imagens fixas — draft, ainda não ativado

`job_runner.py` está preparado e testado como cliente do gateway. O caminho
de entrada final será `/opt/peticao-runner/run-profile`, com UID10001,
capabilities vazias, NoNewPrivs e filesystem raiz somente leitura. O catálogo
continua com todos os perfis desabilitados: não há imagem habilitada ou prova
de execução dos seis perfis em Kubernetes.

O runner só aceita um dos seis nomes fixos. O manifesto da imagem deve conter
o hash de cada entrypoint Python, commit e hash do manifesto de fontes. Esses
pins precisam coincidir com os valores fixados pelo coordenador no Pod.
Os entrypoints concretos, o manifesto completo e o Dockerfile ainda precisam
ser preparados e qualificados.

Antes de executar, faz um único POST autenticado de start. Resposta perdida,
recusa ou recibo indicando execução iniciada não autorizam repetir comandos.
Após executar, uma resposta perdida de finish é reconciliada consultando o
mesmo recibo. Um teste com HTTPS real, SQLite e API K8s simulada comprovou que
o runner executa uma vez e recupera o resultado depois de perder essa resposta.

O ambiente dos subprocessos é montado com uma lista fixa e valores fictícios;
não herda a capability, configuração SMTP nem o ambiente do host. Timeout,
cancelamento e encerramento bem-sucedido do processo pai recolhem também seu
grupo de processos. Artefatos técnicos são limitados e links são recusados.

## Guards e reprodução

`production-build-guard.mjs` preserva o guard já usado na prova de build de
`f55595c`, alterando somente a raiz fixa para `/work`. `guard-origin.json`
registra hashes e a prova com o binário exato Node20.19.2. Foram recusados seis
probes: DNS, TCP, TLS, UDP, fetch e escape de IPC. O ensaio usou diretório
privado central, sem iniciar aplicação ou fazer nova execução em `/mnt/dev`.

O orçamento do build foi corrigido para 3CPU/5GiB, como na prova anterior;
não foi presumido que caberia em 3GiB. Logo, esse perfil não cabe no teto de
SP. O teste pesado em SP deverá usar outro perfil qualificado que caiba em
2CPU/3GiB, mantendo as reservas reais de produção.

## Pendências que impedem ativação

- Entry points dirigidos e imagens reproduzíveis dos seis perfis; nenhum
  `npm test` genérico, WIP bloqueado ou canal real de envio.
- PKI real e imagem contendo somente o certificado público do gateway.
- Arquivo de fontes verificado, dependências, Node/PG/fontes/browser/assets
  pinados e incluídos no contexto de build sem dados ou configurações reais.
- Os artefatos inline atuais comportam logs/PDFs/PNGs pequenos. O runtime
  portátil anterior tem cerca de475MB: é necessário transporte autenticado
  em blocos, com orçamento próprio e hashes, antes de qualificar o build
  completo. Não interpretar o limite inline de32MiB como coleta completa.
- Provas reais de isolamento/claim/cancelamento e equivalência nos três nós.

O cliente do coordenador deve ser o `kubectl v1.37.2` independente, SHA256
`c04487523e7aa7d1493f7808174c899db93d7a9cf57531420cd76b9bd415f8f4`.
O wrapper `k3s kubectl` extrai um runtime sob HOME e falha no serviço
protegido; o cliente independente foi verificado contra o checksum oficial
e testado sem escrita em HOME. O binário ainda precisa entrar no pacote
de instalação do backend.
