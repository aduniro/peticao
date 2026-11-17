# Desafio do presidente — prévia técnica do contrato

**Não é portal externo funcional.** Contrato puro em dois arquivos novos, sem
rota/interface, tabela nova, migração, credencial ou envio. O adapter durável
real e sua prova funcional são a próxima unidade, coordenada depois da frente de
indicações liberar `db.ts`/schema.

## Origem do requisito e posse

Pedido original do dono preservado em
`/mnt/dev/peticao/LOG-2026-11-04-planejamento-admin-v2.md:13`, item1.8:
o presidente recebe link/senha e informa senha, CPF e data de nascimento.
As linhas154–156 detalham CPF cadastrado apenas como hash, conferência efêmera
e bloco/QR no PDF. O principal conferiu essa origem antes de integrar o contrato.

Senha administrativa mínima8 é outra política. O contrato gera um segredo
aleatório de desafio com12 caracteres base64url; não pede que o usuário crie uma
senha administrativa nova nem muda o login. CPF/nascimento são passados somente
ao verificador injetado vinculado ao responsável cadastrado; o repositório recebe
apenas hashes, identidade da conta, revisão, prazo e controle de tentativa.

Posse desta unidade: `president-portal-contract.ts/test` e este documento.
`db.ts`/schema permanecem exclusivos da frente Central; QA compilado/visual do
portal local está com `admin_contact_draft`. Não há mudanças concorrentes nesses
arquivos nesta unidade. Textos de futura interface serão apresentados pelo
principal quando houver fluxo concreto: desafio não equivale à assinatura;
expiração/documento alterado; método externo indisponível. Não foram renderizados
novos avisos externos.

## Contrato exercitado

- Revisão vinculada ao lote, lista, bytes originais, bytes assinados e método.
- Token256bits e segredo aleatório de72bits; armazenamento somente de HMACs com
  domínio próprio. Nenhum uso/leitura de chave ou configuração real nesta prévia.
- Prazo de10min, até5 tentativas, lease30s para conferência da identidade.
- Store durável obrigatório; nenhum fallback de produção em memória. Sem store,
  chave adequada ou verificador, a operação responde indisponível.
- Admissão deve revalidar autorização/stepup, responsável e revisão. Claim deve
  travar registro, comparar hash em tempo constante, contar tentativas, conferir
  expiração e adquirir lease. Finish deve revalidar responsável/revisão/prazo e
  consumir por CAS com auditoria na mesma transação.
- Retomada depois da lease exige nova tentativa explícita; o worker antigo não
  pode consumir depois da substituição. Replay não retorna novo comprovante.
- Resposta não booleana, erro do verificador, mudança/revogação e lease expirada
  não são interpretados como sucesso.

Os testes usam um fake em memória apenas para exercitar o contrato. Eles não
provam lock/transação de PostgreSQL nem registro durável de recibo. Isso exige
adapter real, testes de concorrência/falha do banco e rotas protegidas. Também
faltam cadastro concreto do responsável, verificação real de identidade,
versionamento documental persistente, PDF/QR e tela pública final.

Um comprovante `own-confirmation` continua explicitamente sem ICP-Brasil e sem
gov.br. O contrato não escreve PDF, `signature_kind`, aprovação ou envio. A guarda
ICP existente fica intacta; confirmar identidade não comprova assinatura jurídica
nem autoriza transportar o lote.

## Provas locais

`node --import tsx --test src/lib/president-portal-contract.test.ts`, executado de
`site/`: **8/8**, zero falhas/ignorados/cancelados. Log real em
`.cache/qa-president-contract-20261109/tests.log`, fora do Git. Sem banco,
configurações de aplicação, rede, provedor, envio ou dados reais.

Casos: dependências ausentes, vínculo aos bytes, uso único, nenhum dado pessoal
persistido pelo store, expiração/revisão/revogação, contagem de tentativas,
concorrência, mudança durante a conferência, verificador indisponível/não booleano
e recuperação de lease sem reaproveitar resposta do worker antigo.

A checagem de tipos deve executar a partir de `site/`, como o comando normal do
projeto. Uma invocação inicial da raiz do repositório não resolveu os tipos Node;
o log foi preservado (`types.log`), sem instalar dependências ou alterar o código
para ocultá-lo. A checagem direcionada no diretório correto teve zero diagnósticos
nas duas raízes, saída0, em `types-correct.log`. Isso não substitui o
build/typecheck integrado do candidato.
