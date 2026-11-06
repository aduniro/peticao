# Registro opcional de preenchimentos — desenvolvimento

Recurso **desligado por padrão**, sem publicação ou configuração na VPS nesta etapa.
Os avisos já existentes de assinatura e identidade permanecem intactos. O novo
checkbox é independente do consentimento obrigatório para assinar.

## Ativação futura

Para uma implantação deliberada, configurar `FORM_DRAFTS_ENABLED=1`, definir uma
chave exclusiva `FORM_DRAFT_ENCRYPTION_KEY` com pelo menos 32 caracteres aleatórios
e construir o cliente com `NEXT_PUBLIC_FORM_DRAFTS=1`. Nunca reutilizar nem alterar
`HASH_PEPPER`; não colocar a chave em variável `NEXT_PUBLIC_*`. Sem a chave, o
endpoint não aceita coleta. Não há mudança de segredo em produção nesta entrega.

## Dados e prazo

Após marcar o checkbox, são registrados snapshots limitados de nome, e-mail,
categoria, instituição, cargo, campus, cidade/UF, país/universidade e os estados de
consentimento de assinatura/região. CPF completo matematicamente válido vira
somente HMAC no servidor. CPF incompleto/inválido vira apenas uma indicação, sem
número parcial nem hash parcial. CPF com 11 dígitos colado em outro campo também
é omitido antes da persistência. Data de nascimento, nome da mãe, valores do
modal de identidade, WhatsApp, cookies, fingerprint, IP e user-agent não entram
no payload armazenado.

Os eventos incluem adesão, edição com debounce, saída de campo, página oculta,
clique, submit, campo inválido no navegador e resultado genérico do servidor.
"accepted" significa resposta positiva da API de envio, **não comprova assinatura
confirmada**. O fluxo existente ainda precisa do tratamento de duplicidade planejado.

`form_draft_cache` guarda payload AES-256-GCM, hash do token aleatório, sequência
e datas. Até 40 snapshots por rascunho, corpo de no máximo 12.000 bytes. O prazo
é absoluto: 30 dias desde a primeira gravação, sem extensão por novas edições.
A rotina protegida `/api/cron/fila` elimina expirados, mesmo com coleta desligada.
O prazo efetivo da remoção física depende da execução desse cron; bases de backup
precisam de política própria de retenção. Não há leitura pública de rascunhos.

Desmarcar apaga o payload. Um marcador mínimo (somente hash do token e prazo) fica
até 30 dias para impedir que gravações em trânsito restaurem o rascunho. O controle
continua acessível após a resposta de sucesso do formulário. Se a exclusão falhar,
a página informa e oferece nova tentativa. Somente uma capability opaca (token aleatório, sequência e validade) fica em
`localStorage`, sem nome, e-mail, CPF ou qualquer campo do formulário. Ao recarregar,
a coleta continua desativada e aparece **Apagar rascunho anterior**, sem pedido de
rede automático. Uma nova adesão explícita pode reutilizar o handle dentro dos 30
dias, mantendo a sequência e o prazo inicial. Exclusão confirmada remove o handle;
validade vencida limpa apenas o handle local. Retirada em outra aba desativa esta
aba e o marcador do servidor barra pedidos em trânsito. Se o armazenamento estiver
bloqueado, o recurso funciona em memória e informa que fechar a aba perde esse
controle local; o conteúdo restante expira. Limpar os dados do navegador também
remove a capability de exclusão. Ela permite somente apagar o rascunho:
não permite ler seu conteúdo, autenticar uma pessoa nem alterar assinaturas.

## Limites e testes

Sem adesão, nenhum pedido é feito por este componente ao endpoint. Os pedidos
normais do formulário, como verificar e-mail, mantêm o comportamento anterior.
`sendBeacon` e eventos de saída são melhores esforços: queda de conexão, navegador
ou computador pode interromper a última gravação. Falhas deste recurso não impedem
a assinatura. A sequência monotônica e locks transacionais impedem sobrescrita por
pedidos atrasados; retiradas bloqueiam gravações posteriores com o mesmo token.

O endpoint exige origem do app, aceita JSON/text/plain para beacon, limita tamanho
do stream e pedidos por IP em memória. O IP não é persistido no rascunho. Esse
limitador é próprio de uma instância; não substitui limite distribuído em múltiplos
servidores. O schema é aditivo e não altera assinaturas nem o histórico de identidade.

Teste isolado:

```sh
cd /mnt/dev/peticao/site
DEV_DB_PORT=54336 DEV_DB_DIR=/mnt/dev/peticao/.cache/form-drafts-db node scripts/with-db.mjs ./node_modules/.bin/tsx --test src/lib/form-drafts.test.ts
```
