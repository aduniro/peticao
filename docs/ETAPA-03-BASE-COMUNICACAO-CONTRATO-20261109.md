# Base de comunicação: inventário e contrato mínimo

Inventário somente leitura após `fa93a28`. Não lê cadastros reais, exporta dados,
materializa contatos ou altera esquema/canal/frontend. Este documento delimita
as escolhas antes da implementação, sem presumir consentimento.

## Pedido original

LOG04, Etapa3, linhas140–142: base com e-mails da plataforma, adicionados pelo
dono eCSV, origem/consentimento/descadastro, segmentação e canal de marketing.
O pedido registra divulgação com descadastro e salvaguardas de remetente,
List-Unsubscribe, token, supressão, fila/ritmo e pausa por reclamações/bounces.
A instrução atual do principal exige não transformar assinatura, atendimento ou
formulário abandonado em opt-in. Registrar presença de um e-mail não comprova
base/elegibilidade para divulgação.

## O que existe na fonte inspecionada

| Fonte | Existe | Limite |
|---|---|---|
| `signatures` e `contact_messages` | originais e finalidade de assinatura/atendimento | Não são cadastro externo nem registro automático de autorização de campanha. Não importar nesta inspeção. |
| `signup_diagnostics` | diagnóstico com política própria | Não usar abandono/tentativa como origem automática de público de divulgação. |
| `mail/index.ts:sendMail` | canalmarketing separado e semfallback transacional; exige provedores/remetente próprios | Não é gerenciador de contatos/segmentos, não tem token/optout de campanha. Nenhum provedor foi ativado. |
| `mail/suppression.ts` e`email_suppressions` | bounce/complaint/invalid por endereço normalizado | Supressão geral, não preferência de campanha. Nunca remover por reimportação. Optoutmarketing não deve impedir confirmação transacional. |
| `Mail` | To/BCC/Reply-To/assunto/texto/HTML/anexos | Não possui campo implementado paraheaders List-Unsubscribe. |
| Eventos de provedor | devolução/reclamação e recibos ligados | Não equivalem a descadastro local; `UnsubscribeConfirmation` doSES é controleSNS, não unsubscribe de destinatário. |
| Contato individual/grupo | responder casos recebidos sob aprovação | Não autoriza transformar destinatário do atendimento em público de campanha. |

A busca em fontes não encontrou registro externo administrativo, procedência
multifonte/consentimento, importaçãoCSV revisável, preferência de marketing,
rotas de descadastro com token ou List-Unsubscribe. Essa conclusão é sobre o
checkout, não auditoria dos cadastros/configurações atuais da produção.

## Contrato mínimo recomendado

1. **Registro externo explícito**. Cadastrar apenas por ação administrativa
   autorizada/manual ou importaçãoCSV com prévia. Sem cópia automática de
   assinaturas, contatos recebidos ou diagnósticos. E-mail normalizado conforme
   padrão atual(sem removerpontos/aliases), hash em domínioHMACpróprio e conteúdo
   pessoal cifrado. Nome/email/descrição de prova não aparecem no ledger/auditoria
   em texto livre.
2. **Procedência e base registradas**. Origem obrigatória e evidência/referência
   preservadas por versão; desconhecido continuaUNKNOWN. Critérios de campanha
   devem ser decisões explícitas do dono, sem alegar verificação independente de
   consentimento pelo simples preenchimento de campo administrativo.
3. **Elegibilidade derivada**. Registro não implica envio. Considerar arquivo,
   base/evidência revisadas, optout e supressão existentes antes de preparar um
   destinatário. Falha de leitura/descriptografia significa indisponível, não
   elegível. Segmentos não podem contornar bloqueios.
4. **Optoutmarketing separado**. Preferência por hash, persistente em reimportação
   e arquivo/restauro. Não apagar optout ao reencontrar o endereço noutra origem,
   nem gravar bounce/reclamação fictício na tabela de supressão geral. Sem
   reassinatura automática por importação ou simples edição administrativa.
5. **Token e ausência de envio**. Preparar token não expõeemail/CPF nem é licença
   para transmitir. Caso se integre endpoint público, token imprevisível/assinado,
   sem enumeração; GET de scanner não deve alterar preferência. One-clickPOST e
   link/revisão humana ficam com contrato explícito. Não emitir mensagem real.
6. **Controle administrativo**. Edição para consultar dados de contato; Total+
   confirmação extra para materializar/alterar base/evidência e importar. Ator,
   sessão, versãoCAS, UUIDporator e auditoria atômica na escrita; repetir intenção
   não duplica contato/procedência e entrada divergente409.
7. **Conservação**. Tabelas mínimas: `communication_contacts`(cifra/procedência/
   base/versão), `communication_preferences`(hash+optout) e
   `communication_requests`(intenção/resultadometadados). Procedência histórica
   permanece cifrada/versão e auditoria contém só metadados/fingerprints. Definir
   retenção antes de acrescentar dados pessoais novos; a decisão anterior30dias
   de rascunhos/conteúdo não é automaticamente política para uma nova base.
8. **Gatewaymarketing**. Honrar optout porhash antes de qualquer transporte,
   incluindoTo/BCC quando aplicável, sem mexer no transacional. Esse controle
   não cria assinatura de remetente,headers de unsubscribe, fila, aquecimento
   ou pausa automática: esses requisitos precisam de prova própria antes da
   campanha. Não marcar marketing pronto só porque MAILdev funciona.

## Critérios de aceite propostos

- Dados fictícios exclusivamente; nenhum endereço ouCSV real importado/exportado.
- UNKNOWN não se converte em autorização; origem/evidência ausente falha fechada.
- Criação/CAS/arquivo/repetição e concorrência preservam ciphertext, procedência
  anterior, optout e supressão; rollback de auditoria/ledger deixa tudo igual.
- Token não expõe endereço, falhas não enumeramcontatos, GET não descadastra e
  reimportação nunca reativa preferência. Nenhum token/mensagem é enviado.
- Gatewaymarketing bloqueia optout/supressão com transportefake; transacional e
  respostas de atendimento mantêm comportamento original. Não mexer no motivo
  bounce/complaint nem nas decisões de assinatura/CPF.
- EnsaioDDL antigo/novo/reaplicação/rollback preserva estruturas/dados já testados;
  contagem de novas tabelas declarada da base isolada efetivamente validada.

## Escolhas materiais antes da escrita

- Retenção dos dados da nova base e tratamento de arquivo/expurgo.
- Quais bases/evidências documentadas habilitam preparação para campanha; nunca
  atribuir opt-in a presença na plataforma por inferência.
- Escopo inicial de importação/fusão explícita de origens da plataforma versus
  somente entrada manual/CSV revisável; não executar consultas reais para decidir.

Enquanto essas decisões são fechadas, é possível concluir o inventário e plano
sem bloquear as demais frentes do admin-v2. Este contrato não autoriza deploy,
ativação de campanha ou modificação dos informes da plataforma.
