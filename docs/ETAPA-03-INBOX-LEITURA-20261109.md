# Etapa 03 — consultas protegidas da caixa de entrada

Unidade local na worktree `candidate-inbox-read-20261109`, branch `admin-v2-inbox-read-20261109`, baseada em `a31ba59`. Usa a recepção autenticada/cifrada existente. Não altera `inbound-store`, DDL, política de retenção, credenciais ou fonte da caixa de entrada. Não contém interface, avisos novos, envio, IA, fetch, extração/execução de anexos ou novo formatador.

## Comportamento

- `GET /api/admin/inbox/conversas?account=...&limit=...&cursor=...`: threads por conta, contagem de mensagens/disponíveis e última captura. Não seleciona/decripta conteúdo, assunto, remetentes ou anexos para criar a lista.
- `GET /api/admin/inbox/conversas/[thread]?account=...`: metadados paginados da conversa exata, estado de expiração e correlação registrada pelo núcleo. Referência de cabeçalho não vira identidade autenticada de uma pessoa.
- `GET /api/admin/inbox/mensagens/[id]/previa`: JSON com resultado de `renderMailPreview` já commitado. HTML recebido nunca é devolvido diretamente; retorna somente o documento completo transformado e os metadados limitados desse renderizador. Sem HTML recebido, o texto segue o fallback escapado existente. Uma futura interface precisará iframe sandbox, sem inserir esse documento no DOM do painel.
- `GET /api/admin/inbox/mensagens/[id]/anexos/[index]`: bytes apenas mediante pedido explícito, com índice canônico entre 0 e 3. Nome fixo `anexo-N.bin`, `Content-Disposition: attachment`, `application/octet-stream`, `nosniff` e `private, no-store`. Não usa o MIME/nome alegados pelo remetente para escolher execução/visualização. Nenhum arquivo é salvo no servidor.

Todas as rotas chamam `exigirNivel` com Edição e stepup, preservando a varredura de segurança existente. As funções transacionais revalidam conta ativa, email, nível, sessão e stepup atuais. Edição/Exclusão/Total são admitidos; Leitura não. Prévia e download reutilizam `readInboundContent`, que testa expiração antes de selecionar o ciphertext e só entrega o conteúdo após registrar a leitura na mesma transação. O evento é a leitura de conteúdo do núcleo existente; não se alega um evento exclusivo de download de anexo.

As listagens auditam conta/thread/ator/quantidade, sem assunto/corpo/endereço/anexo bruto. Falha de auditoria impede o resultado. Conteúdo vencido responde 410, ausente 404 e conteúdo indisponível 409; falhas de banco retornam erro genérico 503. Respostas são sem cache; a prévia usa também a CSP existente. UUIDs são limitados ao formato v4 do núcleo e índices malformados são recusados antes da leitura.

## Paginação e limites

Páginas de 20 por padrão, até 50, buscando apenas um item adicional para o cursor. O cursor inclui conta/escopo, timestamp UTC com seis casas decimais e UUID, com validação de formato/tamanho. Usa comparação PostgreSQL de timestamp/UUID, sem truncar microssegundos com `Date.toISOString`. Um cursor de outra conta/thread não é aceito.

A listagem não é um snapshot entre requisições: mensagens recebidas posteriormente podem mover uma thread para o topo. Não se promete navegação histórica estável sob mutação concorrente. Todas as consultas têm timeout de statement/lock. A validação HTTP rejeita limites/campos repetidos que tornariam a seleção ambígua. Não existe filtro por nomes, busca biográfica ou união automática com cadastros de pessoas.

## QA isolado

`python3 tools/admin-qa/inbox-read-local.py tests` verifica que 54362 está livre e cria PostgreSQL fictício próprio, ambiente filtrado e diretórios vazios de configuração/credenciais. Não abre servidor HTTP ou rede pública. `types` usa TypeScript sem banco. A primeira solicitação de types encontrou a porta ocupada pelo próprio teste, por uma pré-condição excessiva do runner; o guard foi limitado ao modo que realmente inicia PostgreSQL. Não era recusa de segurança nem erro da aplicação.

A bateria inclui seis casos novos: paginação/conta/microssegundos sem decriptação; seleção/cursor de thread; documento transformado sem rede; revalidação transacional de permissões/sessão/stepup; expiração antes do expurgo e falha de auditoria; rotas/cabeçalhos/índices/download exato. Acrescenta os testes já commitados de renderização, entrada, codec, store, rota HMAC e usuários/varredura de autorização. Identidades, corpos e anexos são fictícios; nenhum estado pessoal foi lido. O teste bloqueia fetch e confirma que corpo bruto/script não entra na prévia; o anexo pode conter bytes HTML fictícios, mas sai obrigatoriamente como download binário.

Logs/hashes finais ficam em `.cache/qa-inbox-read-20261109/`. Não há alteração de schema, então este marco não exige novo ensaio de migração. Não foram executados build global, QA visual, servidores publicados, envios ou consultas reais. Não se utilizou o WIP rich interrompido; apenas `mail/preview-render.ts` commitado na base e dependências do ambiente local já existente.

## Continuação

Interface da caixa de entrada, iframe sandbox, ações de resposta/rascunho e textos correspondentes continuam sob coordenação do principal. Esta unidade permite consultas/downloads administrativos concretos; não representa a interface completa nem ativa qualquer relay real. Rollback de código remove os endpoints novos e deixa mensagens cifradas/expiração do núcleo intactas.

Resultado executado: **48/48 testes**, zero falhas/cancelados/ignorados, saída0. Typecheck completo da worktree limpa (`tsc --noEmit --incremental false`): saída0, zero diagnósticos. Testes: `/tmp/admin-inbox-read-uh7b40di/validation.log`; tipos: `/tmp/admin-inbox-read-uq1bt0k6/validation.log`. Os fontes permaneceram iguais durante os dois comandos, conforme fingerprints do runner. O runner corrigido não exige banco livre para executar apenas tipos.
