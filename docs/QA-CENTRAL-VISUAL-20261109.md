# Central de Ações: validação visual isolada

Escopo: conferir o ajuste `minWidth:760` do histórico da Central, sem alterar
outros módulos. Base exata `507a63455ff205b559d78e42ef3405324748ac72`, worktree
`candidate-stage02-central-visual`, dependências originais `preview-v1`.
Esta validação não retoma os módulos IA/rich-text interrompidos, não acessa VPS,
credenciais ou dados reais e não autoriza publicação.

## Build confirmado

`npm run build` terminou com código 0 entre 01:10:11Z e 01:13:07Z de 09/11/2026,
Node 18.19.1, um worker e heap limitado a 1536MB. Foram comparados 1122 arquivos
rastreados antes/depois: todos preservados. O manifesto do artefato contém 519
arquivos fora do cache, total de 7897501 bytes. Build ID:
`16RtrGPBE_BUg9IjMmLqv`.

Evidências privadas: `.cache/qa-central-visual-20261109/build/`; originais em
`/tmp/admin-central-visual-build-41_nmvm2`. O artefato fechado foi compartilhado
com a validação Contato após comparação independente de fontes, lock e versões;
a cópia passou por comparação rsync com checksums/metadados sem diferenças.

## Contrato visual preparado

`tools/admin-qa/central-visual-local.py http` exige esta worktree, dependências
originais, ausência de arquivos de ambiente e portas locais 3036/54356 livres.
Cria banco novo com dados fictícios e configuração vazia; o runner encerra seus
próprios processos ao terminar. O contrato `actions-visual.mjs` verifica:

- página compilada real em 320, 390, 768, 992, 1280 e 1920 pixels;
- tabela de pelo menos 760 pixels e coluna de data legível;
- rolagem horizontal dentro da tabela, sem extravasar a página;
- alcance do botão da última coluna pelo scroll interno;
- histórico de três registros fictícios e aviso aprovado;
- ausência de POST, requisições externas, erros de página/rede/HTTP;
- preservação das assinaturas, mensagens, fila, ações, auditoria e configurações;
- rejeição 401 sem sessão e 403 sem confirmação de identidade.

O teste não clica em ações e não chama executor, envio, publicação ou Terminal.
O teste de lógica anterior (31 testes e navegador em seis larguras) é registrado
em `ETAPA-CENTRAL-UI-20261108.md`; não é repetido apenas por esta alteração CSS.

## Resultado do navegador

**Aprovado, saída 0**: `/tmp/admin-central-visual-http-z9h8nzgf/`, com cópia privada
em `.cache/qa-central-visual-20261109/http-pass/` e checksums dos artefatos.
As seis larguras passaram, sem erro de página/rede/HTTP, sem POST ou requisição
externa. A tabela mediu760px nas larguras320/390/768; contêineres de260/330/703px
rolaram internamente. Em992/1280/1920, a tabela usou a largura disponível.
Nenhuma página extravasou horizontalmente e o botão da última coluna permaneceu
alcançável. Os snapshots do banco fictício permaneceram iguais.

As capturas390(esquerda/direita) e1280 foram abertas e inspecionadas: datas
legíveis, cabeçalho, aviso e botão preservados. No celular há quebra de palavras
nas colunas estreitas ID/Modo, herdada do estilo atual; não impede leitura ou
acesso e não foi alterada fora deste ajuste. Não houve alteração de fontes,
cores ou layout global. Não se afirma validação de módulos fora da Central.

A primeira rodada parou antes do navegador porque a senha da fixture continha
o identificador do e-mail e foi corretamente recusada pela política de senha.
Preservada em `http-fixture-failure/`; a única correção foi usar uma senha
fictícia distinta e repetir em banco novo. Nenhuma proteção foi relaxada.

Após o HTTP, os1122arquivos rastreados continuaram com os mesmos checksums.
Os processos próprios encerraram e as portas3036/54356 ficaram livres.
Essa aprovação fecha apenas a pendência visual do ajuste760; a entrega do
admin-v2 integral continua dependente das demais frentes e autorização do dono.
