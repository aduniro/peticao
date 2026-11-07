# Auditoria somente leitura — experiência de assinatura em produção

Coleta em 07/11/2026, aproximadamente 14:38–14:50 UTC. Relógio local e VPS conferidos simultaneamente às 14:41:08Z; SQL `clock_timestamp()` retornou 14:41:08.730Z. O fuso da sessão PostgreSQL é America/Sao_Paulo; os horários abaixo são UTC. Não foram reutilizados resultados antigos. Nenhum código, cadastro, configuração, serviço ou decisão de revisão foi alterado. Não houve consulta de CPF nem envio de mensagem a participante.

## Conclusão

Há recusas e dificuldades relevantes, além de falhas técnicas pontuais comprovadas. Não encontrei evidência de uma pane contínua no momento da coleta: o serviço estava ativo às 14:47:14Z e o domínio público respondeu HTTP 200. Isso não prova que todos os percursos de preenchimento funcionem nem permite calcular uma taxa global exata de assinaturas malsucedidas.

Nas últimas 24 horas, **13 CPFs distintos tiveram falha de validação e continuavam sem cadastro atual nem validação posterior bem-sucedida observada**. Outros **11 estavam pendentes de confirmação**; nove destes já tinham validado depois da última falha. Não chamar todos os pendentes de pessoas impedidas de assinar. Há ainda **quatro POSTs de assinatura que receberam 502**, sem identificador de visitante utilizável para saber quantas pessoas foram afetadas ou se depois concluíram.

## Quantas tentativas identificáveis ficaram sem conclusão?

Snapshot específico: **2026-11-07T14:49:33.353Z**, transação `REPEATABLE READ READ ONLY`. Cada unidade é um CPF hash distinto, nunca uma soma de tentativas repetidas. Nenhum hash foi exportado.

| Situação dos CPFs que tiveram alguma falha na janela | 24 horas | 7 dias |
|---|---:|---:|
| CPFs distintos com alguma falha registrada | 56 | 308 |
| Já tinham assinatura confirmada antes da primeira falha da janela | 1 | 4 |
| Confirmaram depois da primeira falha da janela | 31 | 166 |
| Sem assinatura confirmada associada no snapshot | 24 | 138 |
| Destes: cadastro atual pendente | 11 | 50 |
| Destes: nenhum cadastro atual associado | 13 | 88 |
| Sem confirmação, mas houve validação OK depois da última falha | 9 | 47 |
| Sem confirmação e sem validação OK posterior à última falha | 15 | 91 |
| Atingiram cinco erros nas últimas 24 h, ainda sem confirmação | 4 | 4 |

As duas linhas “destes” particionam os sem confirmação; as duas linhas de validação posterior são outra partição do mesmo grupo, e não números a somar. Uma conferência complementar às 14:50 UTC encontrou os 13 sem cadastro das 24 h sem qualquer OK posterior; dos 88 sem cadastro em sete dias, 87 não tinham OK posterior e um tinha. Três dos quatro bloqueios atuais decorrem exclusivamente de erros na conferência de nome; um decorre das etapas de identidade.

Esses números são um **subconjunto observável**, não o total global de pessoas impedidas. Um CPF digitado incorretamente pode depois ser corrigido para outro; troca de aparelho/cookie rompe vínculos; falhas antes de a API ser chamada não entram nessa tabela. Ausência de confirmação até o snapshot é censurada: a pessoa ainda pode confirmar depois. Uma assinatura anterior confirmada também não significa que uma nova tentativa tenha produzido novo cadastro.

Separadamente, `invalid_attempts` tem tentativas associadas a quatro hashes de e-mail distintos em 24 h e 47 em sete dias. Não são quatro/47 pessoas adicionais: podem se sobrepor aos CPFs acima ou corresponder a erros de digitação do mesmo participante. Não foram somados.

## Recusas registradas por etapa

Snapshot comum: **2026-11-07T14:45:19.157Z**, relógio SQL ao terminar 14:45:19.292Z. As janelas móveis das consultas complementares diferem por alguns minutos; preservar os timestamps ao comparar arquivos.

| Método gravado | Falhas / checagens em 24 h | Falhas / checagens em 7 dias |
|---|---:|---:|
| Conferência nome/CPF | 83 / 767 (10,8%) | 140 / 6.437 (2,2%) |
| Desafio pelo nome da mãe | 25 / 57 (43,9%) | 344 / 835 (41,2%) |
| Desafio por nascimento | 4 / 176 (2,3%) | 112 / 1.970 (5,7%) |

São registros de checagem, não pessoas. Falhas por `nome` também incluem CPF não encontrado. Falhas registradas como `mae` ou `nascimento` podem ter sido provocadas pela conferência prévia do nome do assinante; a tabela não guarda a causa detalhada. Portanto, não interpretar todos os 25 registros do método mãe como nomes de mãe incorretos.

O dia UTC 07/11, ainda incompleto, tinha 39 falhas em 186 checagens de nome (21%). É sinal de atrito para acompanhar, não prova de defeito da regra: não há registro do nome recusado para reconstituir cada comparação. Dos 41 CPFs distintos com erro de nome nas 24 h, 31 tiveram validação posterior OK e 23 confirmaram depois. O desafio por nascimento já é a opção inicialmente selecionada no modal.

## Falhas técnicas comprovadas e reinícios

O journal estruturado do Caddy contém **quatro POSTs `/api/assinar` com HTTP 502** entre **06/11 20:04:51.167Z e 20:05:26.918Z**, todos por conexão recusada ao aplicativo. Três tinham indicação de aparelho móvel no User-Agent. Também houve um POST `/api/email/validar` com 502 às 20:04:51.164Z.

O serviço registra paradas/inícios às 20:04:41 e nova parada às 20:04:47, terminando/iniciando novamente às 20:06:17. Os erros coincidem com essa janela de reinício. Isso comprova indisponibilidade do upstream nessas requisições; associar a um deploy específico ou autor exige manifesto/log de publicação, não foi inferido.

Na janela de sete dias há **111 POSTs de assinatura com 502**, dos quais 104 entre **03/11 20:26:01 e 20:38:17Z**. O serviço também registra reinícios nesse período. Todos os 111 logs examinados estavam sem cookie de visitante utilizável; IP não foi tratado como pessoa. Não é possível deduplicar esses POSTs em participantes nem provar se depois assinaram.

O journal do app nas últimas 24 h não apresentou padrões `TypeError`, `Unhandled`, `assinar falhou` ou indisponibilidade de CPF. Em sete dias, houve oito registros de indisponibilidade CPF com código NETWORK, nenhum nas 24 h. Não há registro de todas as respostas HTTP bem-sucedidas/422/500 nesses journals: eles não oferecem denominador completo nem provam ausência de erros no navegador.

## Outros sinais da experiência

- **Duplicidades com mensagem genérica:** 46 tentativas vinculadas a 41 registros já confirmados em 24 h; 229 tentativas/183 registros em sete dias. No código publicado, `submit` audita `duplicate_attempt` e retorna sem enviar e-mail; a API responde `{ok:true}` e o formulário mostra o aviso de conferir a caixa de entrada. É comportamento deliberado para não revelar quem assinou, mas confunde quem espera novo e-mail. O e-mail digitado nessa tentativa não é necessariamente o do registro associado.
- **Pendência não é erro de cadastro:** no snapshot das 14:45, 750 registros atuais foram criados nas 24 h, 589 já confirmados e 161 pendentes. Houve 669 confirmações na janela, incluindo cadastros anteriores. As contagens não são uma taxa global de conversão.
- **Funil parcial por visitante:** 961 visitantes observados iniciaram o formulário; 878 deles clicaram em Assinar depois do início. Há 193 que clicaram sem novo registro atual associado ao cookie na janela. Esse número inclui possíveis duplicidades, recriações, perda do vínculo e desistências; não corresponde a 193 falhas comprovadas.
- **E-mail e demora:** em coleta às 14:48:51Z, MX tinha p95 de 26 ms e máximo de 3.001 ms; Reacher p95 de 1.266 ms e máximo de 4.002 ms nas 24 h. Reacher retornou 906 `sem_prova` e seis `indisponivel`; o verificador MailerSend retornou 96 `indisponivel`. Esses resultados deixam o fluxo seguir, conforme o código: indisponibilidade da sonda não é uma recusa ao participante. As medições são de subconsultas, não do tempo total do formulário.
- **Envio:** `mail_log` tinha 770 aceitações de confirmação nas 24 h e nenhuma falha desse tipo registrada nesse intervalo; não havia confirmação pendente/falha na outbox. “sent” significa aceite da rotina/provedor, não comprova entrega à caixa de entrada. A cobertura de `mail_log` só começa em 04/11; não comparar seu total de sete dias com todos os cadastros da semana.

## O que o código publicado faz, sem alteração

Foram lidos arquivos específicos na VPS e comparados por SHA. `SignForm.tsx` publicado tem SHA `1a0ab0c359c6cd0376e7ba5970e6b528ab272adf46c63c4d0934401c7c9f47bd`, igual ao candidato preservado, diferente do principal local atual. `sign-flow.ts`, `track.ts`, `sign-request.ts`, `cpf-check.ts`, `cpf-name.ts` e `IdentityModal.tsx` foram conferidos no publicado; quando havia divergência local, a análise usou o trecho remoto.

- Falha de fetch/JSON é capturada por `signRequest`; o formulário volta a idle e não limpa nome, e-mail, CPF ou geografia. Não foi encontrado `form.reset()` nesse percurso. O antirrobô é reiniciado.
- O CPF inválido é marcado ao sair do campo, com `aria-invalid` e aviso abaixo. Não há `onFocus` que retire o aviso ao voltar ao campo: essa diferença em relação ao comportamento de foco solicitado continua presente.
- Os modais são abertos no envio do formulário ou confirmação de identidade, não no `onBlur` do e-mail/CPF. O erro de e-mail no blur fica junto ao campo.
- Nomes e identidade compartilham o limite de cinco falhas por CPF em 24 h. O erro de nome não informa o contador restante; pode-se chegar ao bloqueio depois de corrigir grafias repetidamente.
- Riscos estáticos que precisam de reprodução isolada: `signRequest` não estabelece prazo de aplicação para um fetch que permaneça pendente; a checagem assíncrona de e-mail descarta resposta de endereço antigo, mas não confere se a categoria mudou, permitindo aviso antigo após alternar Servidor/Apoiador com o mesmo endereço. Não afirmei que esses riscos explicam um volume medido de falhas, nem os alterei.

## Os e-mails das tentativas ficaram registrados?

Parcialmente. Em produção:

| Local | O que fica |
|---|---|
| `request_log.email_hash` / `invalid_attempts.email_hash` | Hash do e-mail, sem endereço completo |
| `email_checks.domain` | Só domínio, via, veredito, tempo e eventual detalhe; não endereço completo |
| `signatures.email` | Endereço completo quando o cadastro existe |
| `mail_log.to_addr` | Destino completo quando houve tentativa registrada de envio |
| `email_suppressions.email` | Endereço completo bloqueado; há quatro com motivo `invalid` |
| `audit_log` de duplicidade | ID do cadastro existente; não prova qual e-mail foi digitado naquela tentativa |
| `events` | Não possui campo e-mail; não registra os valores digitados |

Erros iniciais e abandono não produzem uma lista completa de endereços recuperáveis. Não existem tabelas `form*` na VPS, e `FormDraftCapture.tsx` / `form-drafts.ts` não estão publicados. Não confundir a versão local que contém esses módulos com a versão em execução. Não foi lido nenhum conteúdo criptografado.

O cache de retorno da consulta CPF publicado é de 30 dias. **O histórico de `identity_attempts` publicado ainda limpa registros com mais de sete dias**; o principal local já tem código de 30 dias, mas não é o publicado. Retenção de request/event log é configurável com padrão de 90 dias; `invalid_attempts` usa limpeza de 30 dias. Não foi lido ambiente de produção para descobrir a configuração efetiva. Não se deve afirmar que todos esses logs durem 30 dias.

## Prioridades sugeridas, sem execução

1. Evitar janelas de upstream indisponível durante publicação: preparar e validar o artefato antes da troca e verificar prontidão antes de direcionar tráfego. Preservar o diagnóstico dos 502 como evidência concreta.
2. Medir resultados do formulário por etapa/código/status/duração e identificador pseudônimo de tentativa, sem precisar guardar valores pessoais digitados. Hoje faltam recusas pré-API, códigos de cada recusa, total de submissões e falhas de navegador. Respeitar os controles de privacidade existentes.
3. Resolver o fluxo de assinatura já confirmada e a mensagem genérica de e-mail, mantendo proteção contra consulta de terceiros. Depende da política e textos aprovados pelo dono.
4. Auditar casos de recusa de nome e a regra do orçamento compartilhado de cinco erros; não relaxar automaticamente grafia/identidade por causa das contagens. Expor alternativa e contador com textos previamente aprovados.
5. Reproduzir os dois riscos estáticos em ambiente fictício e verificar foco/avisos sem alterar estética ou regras não solicitadas.

## Evidências locais

Pasta `/mnt/dev/peticao/.cache/admin-audit-20261106/ux-assinaturas-readonly/`, protegida com modo 700. Contém somente SQL e agregados, sem nomes, e-mails, CPFs, nascimento, mãe, IP ou valores de hashes pessoais.

- `audit-final.sql` e `snapshot-final.json`: snapshot comum das 14:45 UTC.
- `unresolved-people.sql` e `unresolved-people.json`: deduplicação e situação dos CPFs com falha às 14:49 UTC.
- `journal-aggregate.json`: padrões agregados do app/proxy.
- `caddy-sign-failures.json`: método/rota/status, horários e ciclos do serviço.
- `caddy-cookie-presence.json`: ausência de cookie de visitante utilizável nos 502.
- `email-validation-latency.json`: subconsultas de e-mail e latência às 14:48 UTC.
- `aggregates.json`, `trajectories.json`, `caddy-http-aggregate.json`: consultas preliminares, com seus próprios timestamps; não misturar suas contagens com o snapshot final.

Não houve testes de submissão em produção. Nenhuma alteração ou correção foi publicada por esta auditoria.
