# Checkpoint operacional — revisão2

Raiz: `/mnt/apps/peticao-final/_ops/controle-operacional`.
Coordenação única: `/mnt/apps/peticao-final/_ops/coordenacao-dupla`.

Revisão2 aprovada pelo responsável e registrada no evento216. Esta sessão
cuida da página pública (novos detalhes ainda aguardados) e da infraestrutura
independente. Não reabrir revisão unsigned bloqueada nem modificar produção.

## Estado mais recente — fase A concluída

A fase A privada foi instalada sob lease crítico fence12 e encerrada no evento391.
Prova: `/mnt/apps/peticao-final/_ops/controle-operacional/evidence/private-phase-a-installed.json`.
HTTPS privado https://sonda-verifica3.tail1a6d71.ts.net:9443/ responde com TLS
verificado; RDP3389 preservado; ops-control/ops-ingress ativos sem reinícios na
medição. Runtime instalado é EXATO e5;35 arquivos conferidos por hash.

104 testes operacionais passaram no Python3.13 da VPS. Seis testes exclusivos
do qualificador Codex local não foram executados lá por faltar jsonschema, que
não é dependência dos serviços. O harness isolado corrigiu apenas3 caminhos
absolutos de testes; não alterou o runtime instalado. Nenhum turno real foi
repetido. Filas/outboxes estavam vazias, sem e-mail ou OTP solicitado no bootstrap.

A fase B (callback público e MX/rota de executor@exec.sancionaintegral.org) ainda
aguarda manifesto/ACK próprios. Não há recepção pública, bridge Codex live,
GERAL real ou migração do relatório horário para VPS. Os registros abaixo são
histórico das etapas anteriores e não substituem este estado mais recente.

## Fonte e provas

- Commit e5a90f49bd269f697d349e650b4c8a15861a6bd1: console privado, revisão Owner,
  fila/worker, ingresso HMAC, processamento durável e transporte funcional.
 110 testes passaram, TMPDIR=/dev/shm,4.416s. Log imutável0400:
  `/mnt/apps/peticao-final/_ops/controle-operacional/evidence/tests-rev2-110-ram.log`.
  SHA2569400561e44a5a0cd7ff47de012cce0ec19354060ac12dbc7b9f1357941dba248.
- Commits4a62a54 e f495866 acrescentam somente módulo GERAL isolado/contrato
  e alinhamento de recibos;18 testes específicos passaram. Não está integrado
  ao daemon nem a sessões reais. Não declarar GERAL operacional.
- Um teste anterior em disco foi interrompido com SIGINT por rq_qos_wait;
  PID1636532 já terminou. Nenhum processo da aplicação foi sinalizado.

## Instalação pendente de ACK

Manifesto privado fase A:
`/mnt/apps/peticao-final/_ops/controle-operacional/evidence/install-phase-a-manifest.json`.
SHA256b9d7f0e2891841fbdef4d1e9421963702fa8c7651c45a78e3334841a303449cc.

Pacote EXATO e5, sem alterações GERAL posteriores:
`/mnt/apps/peticao-final/_ops/controle-operacional/evidence/ops-source-e5a90f49bd269f697d349e650b4c8a15861a6bd1.tar`.
409600bytes;SHA256ba0ffcb07726e97a0bbb892e7e634a19d6a7589d8ae95bcfb2bc34a8c99b6e5a.

Notice298 foi substituído por333: o encoding antigo não satisfazia o schema
do ledger. Usar333 para lease crítico após ACK admin. O arquivo de manifesto,
o pacote e o escopo são os mesmos. Não alterar bytes após revisão.

Fase A permite SOMENTE instalar identidades novas isoladas/configuração e
SQLite operacionais, serviços loopback8767/8768 e HTTPS Tailnet9443, preservando
RDP3389. Nenhum DNS/CF/Caddy/firewall público, appDB/deploy ou bridge live.
Nenhum OTP/e-mail automático no bootstrap. Não criar scheduler de relatório.

Não houve instalação, envio real, cópia de credencial ou mudança remota nesta
entrega até este checkpoint. Conferir estado ao retomar, não inferir pelo texto.

## Revisão cruzada e comunicação

ACK313 do hotfix Vigia registrado por apoio no evento337, após leitura do patch,
hashes do manifesto e provas68PASS/3deselected. Revisão em:
`/mnt/apps/peticao-final/_ops/controle-operacional/evidence/review-vigia-hotfix-313.json`.
Exige backup consistente, zero pedidos gerenciados executando, lease próprio
e observação após reiniciar SOMENTE o monitor local. Não é deploy da aplicação.

Resposta admin329 foi reconhecida no evento338; resposta apoio339 forneceu o
log110PASS. A ferramenta direta de mensagens ficou indisponível para admin;
ler novos eventos do ledger ao retomar e durante esperas. Observação automática
de arquivo não substitui ACK. Não criar coordenação ou plano paralelo.

## Lease e gates

Lease de edição apoio fence9,ID78fb950d364a4908a0dc96ed10f1942e, estava ativo.
Recibo privado: `/mnt/apps/peticao-final/_ops/controle-operacional/evidence/implementation-lease-rev2.json`.
Conferir validade atual sem imprimir token. Se expirou, reconciliar com ambos
os coordenadores, sem takeover. Instalação usa lease crítico distinto, após ACK.

O daemon Codex reiniciou e existem releases0.167.x locais. A prova real fictícia
das19:29 é histórica, sobre cliente0.166. Não repetir o turno one-shot; gateway
permanece live-disabled até nova qualificação explicitamente coordenada.

Relatório único das18hPortoVelho/22UTC: accepted_by_provider202; entrega não
comprovada. Scheduler continua local, não afirmar prontidão24h do computador
desligado. Cutover para VPS exige fencing/desativação comprovada do anterior.

Fase B pública está somente preparada em:
`/mnt/apps/peticao-final/_ops/controle-operacional/infra/PUBLIC-INGRESS-PHASE-B.md`.
ConsultaRO22:01UTC: exec.sancionaintegral.org sem DNS e MailerSend sem rotas.
Reconsultar antes de qualquer escrita. Não alterar MX Proton ou produção.
