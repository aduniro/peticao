# Laboratório local — VPS × candidato dos formulários

Este laboratório não está conectado à VPS. As duas versões usam dados fictícios
e redes Docker internas diferentes. Nenhum banco, cofre, arquivo de ambiente ou
credencial de produção foi copiado para as instâncias executáveis.

## Uso

Execute de qualquer pasta:

- `/mnt/dev/peticao-laboratorio/comparar`: iniciar as duas versões.
- `/mnt/dev/peticao-laboratorio/comparar status`: consultar somente este laboratório.
- `/mnt/dev/peticao-laboratorio/comparar parar`: parar somente seus quatro contêineres.
- `/mnt/dev/peticao-laboratorio/comparar testes`: reinstalar fixtures fictícios e repetir cenários/capturas.
- `/mnt/dev/peticao-laboratorio/comparar unitarios a` ou `unitarios b`: testes isolados em bancos qa_unit.
- `/mnt/dev/peticao-laboratorio/comparar dados`: limpar SOMENTE os dados fictícios do laboratório e repor os quatro exemplos.
- `/mnt/dev/peticao-laboratorio/comparar build`: recompilar as duas cópias após alterações deliberadas.

A: http://127.0.0.1:3040/ — fonte da VPS capturada.
B: http://127.0.0.1:3041/ — candidato dos formulários.

Relatório: `reports/index.html`. Capturas, patches, logs e JSONs ficam em
`reports/`, fora do Git. Builds ficam em `runtime/build-a.log` e `build-b.log`.
E-mails fictícios ficam em `runtime/a/outbox` e `runtime/b/outbox`, sem entrega.
Não há publicação por Tailscale nesta etapa.

## Identificação e alterações futuras

- O backup em /mnt/dev/backups/peticao-vps/20261108T182956Z permanece intacto.
- A aplicação A fica em `app/`, no Git independente deste laboratório.
- B fica em `formularios/app/`, em worktree/branch comparacao-formularios.
- Tag baseline-vps-20261108 preserva o snapshot anterior ao laboratório.
- O candidato foi congelado por hash a partir do conteúdo local; seus691 arquivos
  correspondem aos blobs de da2c354. Permissões de execução diferem em alguns
  arquivos da captura VPS e são separadas de mudanças de conteúdo.
- provenance.json e SOURCE-MANIFEST.json registram as fontes e checksums.

Não editar as fontes originais de /mnt/dev/peticao nem o backup para experimentar.
Antes de mudanças em A, abrir uma branch local de experimento; antes de mudar B,
registrar commit. Nenhuma dessas branches deve ser enviada à VPS automaticamente.

## Testes manuais

Nome de exemplo: Pessoa Fictícia Teste. CPFs EXCLUSIVAMENTE de teste:
529.982.247-25 e111.444.777-35. Nascimento15/08/1985; mãe Ana Maria da Conceição;
sexo F. Provedor fictício para os dois números; nenhuma consulta paga ocorre.

Servidor: e-mail qa-lab@unir.br, instituição UNIR, cargo e campus conforme o
formulário. Apoiador: qa-lab@gmail.com, UF RO, cidade Porto Velho. Os endereços
são exemplos tratados pelo adaptador DNS fictício e nunca recebem mensagens.

O antirrobô é um simulador local instalado pelo proxy de teste, sem mudar o código
da aplicação: tokens válidos de uso único por padrão. Para simular falha no console
do navegador: `window.__labTurnstileMode = "invalid"`, seguido de reset do widget.
Essa simulação NÃO prova integração real com Cloudflare. A reserva visual do widget
é igual em A e B; não é uma reprodução visual do widget externo de produção.

O servidor ainda aplica as proteções originais: em QA, envio a .gov.br é bloqueado.
A elegibilidade EBSERH pode ser testada, mas essa guarda não é removida para obter
um falso sucesso. Antirrobô, CPF, MX e e-mails são simulados; suas integrações
externas não são validadas aqui.

## Limites e dados

Os testes são comparativos: diferenças esperadas do candidato devem aparecer.
Não corrigir A para que ela se pareça com B. Não alterar estilos ou avisos para
zerar um diff visual. Registrar primeiro a evidência e classificar a diferença.

O comando testes reinicializa fixtures dos bancos de teste. Dados de assinantes,
aprovações da revisão de CPF e bancos da VPS nunca são acessados.
As duas instâncias geram seus próprios caches criptografados com chaves fictícias.
Não existe cron/worker de campanha ou conexão com e-mail, CPF Brasil ou VPS.

Os builds permitem acesso ao registro npm somente para instalar dependências do
lockfile. Os contêineres de execução permanecem sem saída para a internet.
