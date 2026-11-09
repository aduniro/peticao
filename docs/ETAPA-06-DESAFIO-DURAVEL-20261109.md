# Etapa 06 — desafio durável do presidente (backend local)

## Escopo e origem

Este marco implementa o adapter PostgreSQL e três rotas do contrato `5eba06d`; não conclui a interface externa, o QR ou a aplicação de assinatura ao PDF. A referência para senha, CPF e nascimento é `LOG-2026-11-04-planejamento-admin-v2.md`, item 1.8 (linha 13), com detalhamento nas linhas 154–156. A senha aleatória de 12 caracteres do desafio é distinta da senha administrativa de oito caracteres. CPF e nascimento da conferência não são armazenados em texto; o CPF configurado fica como HMAC com domínio próprio e o WhatsApp opcional fica cifrado. Nome e email vêm da conta administrativa ativa existente.

## Comportamento concreto

- `GET/POST /api/admin/presidente/perfil`: somente Total com sessão e stepup ainda válidos. Configuração com revisão CAS; trocar responsável exige novo CPF. Omitir CPF/WhatsApp conserva o valor do mesmo responsável; WhatsApp vazio remove o telefone. Qualquer alteração revoga desafios pendentes atomicamente com auditoria.
- `POST /api/admin/presidente/desafio`: somente Total com stepup, configuração ativa e verificador de identidade disponível. Emite token/senha uma única vez na resposta `private, no-store`; banco mantém apenas hashes. Uma nova emissão explícita revoga a anterior. Nenhuma mensagem é enviada.
- `POST /api/presidente/confirmar`: mesma origem, JSON limitado e rate limit. Aceita CPF com máscara e nascimento ISO ou brasileiro. Verifica CPF vinculado, nome da conta e nascimento por meio do verificador existente. Não liga serviços externos nem cria credenciais.

`president_challenges` é a 17ª tabela aditiva desta base. A versão vincula lista, tipo, sequência, método e hashes dos bytes originais/assinados. Claim/finish revalidam conta responsável, perfil, bytes, estado do lote e emissor ainda ativo/Total. Expiração de dez minutos, limite de cinco tentativas, lease de trinta segundos e CAS impedem consumo concorrente/recibo duplicado. A consulta ao provider acontece fora da transação; um trabalhador com lease antiga não consome a retomada. Falha de auditoria desfaz emissão/consumo. Campos efêmeros não entram na auditoria; a verificação existente preserva seu registro por hash.

O resultado é `own-confirmation`, com `icpBrasil=false` e `govBr=false`. Não altera `signature_kind`, PDF, aprovação ou envio. Aprovação administrativa continua separada. Sem provider disponível o fluxo falha fechado, inclusive quando o modo público de identidade estiver desativado.

## Validação local e limites

Comando: `python3 tools/admin-qa/batch-local.py --tests president`. PostgreSQL efêmero próprio, schemas e identidades fictícios, emails de desenvolvimento, sem importar ambiente real. O runner confere fingerprints dos fontes antes/depois. A bateria reúne 42 regressões de portal/preparo, oito testes do contrato e seis testes duráveis/HTTP (56 no total). Cobre revogação, replay, limites, expiração, mudança de bytes, configuração CAS, preservação de campos omitidos, concorrência, retomada de lease, rollback de auditoria, origem e stepup. Confere ausência de escrita em documentos, filas e envios.

O checker aditivo preserva as provas anteriores de 15/16 tabelas e acrescenta recibo consumido/lease em verificação com timestamps de microssegundos. Reaplica DDL e bootstrap antigo sem apagar os registros. Evidências finais ficam em `.cache/qa-president-durable-20261109/` (não versionadas); diretório temporário original registrado em `origem.txt`. Typecheck dirigido cobre oito raízes e suas importações; build global/QA visual deste novo fluxo não foram executados nesta unidade.

Rollback de código: reverter o commit sem remover a tabela ou as configurações; o bootstrap antigo foi testado sem perda do estado novo. Desabilitar o perfil por ação administrativa revoga desafios pendentes; não executar DDL destrutivo ou restaurar snapshots sobre registros. Não houve migração de banco real, deploy, alteração de credenciais, envio ou consulta a assinantes.

## Continuação coordenada

Ainda faltam UI protegida de configuração/emissão, página externa para conferência, textos apresentados ao responsável antes de publicação e prova visual/funcional do fluxo compilado. As APIs não possuem envio automático; qualquer futura entrega exige ação autorizada. O recibo é persistente, mas não é uma assinatura ICP nem um PDF assinado. QR/verificação pública dos bytes e integração desse recibo à apresentação do documento permanecem marcos posteriores. Não anunciar o portal externo como concluído com base nesta bateria.
