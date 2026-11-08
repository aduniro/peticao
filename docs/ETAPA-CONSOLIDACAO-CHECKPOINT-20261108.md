# Consolidação supervisionada — checkpoint parcial08/11

Checkout exclusivo `candidate-stage02-domains`, branch `admin-v2-domain-actors`.
Sem edição em outros worktrees, VPS, avisos públicos ou regras CPF.
`site/geo-data` já estava não versionado e foi preservado.

## Commits e resultados efetivamente observados

- `9b4a693`: alterações existentes de ator em domínios fechadas e documentadas.
- `a99875b`: rota e formulário ligados ao ledger d8b8bac, mantendo controles,
  textos e estilos; recuperação de intenção/rótulo na aba antes de POST nativo.
- Helper independente `targeted`:15/15, zero falhas/ignorados, antes e depois da
  integração. Testes incluem handler real, concorrência, rollback e autoria.
- Helper `schema`: aprovado, exatamente13 tabelas aditivas; detalhes em
  `ETAPA-07-ENSAIO-SCHEMA-ATUAL.md`. Preserva cifras, arquivamento, identidades,
  vínculos e microssegundos. Nenhum DDL de produção aplicado.
- Helper `build`: saída0, aviso CSS preexistente sobre `end`/`flex-end` preservado.
- Helper `types` após build: primeira rodada falhou na inferência de UUID de uma
  fixture; anotação `string` corrigida e repetição saída0. Sem mudar a aplicação.
- HTTP compilado indicações/domínios aprovado. Evidência lida:
  `/tmp/admin-consolidation-ivmek__7/referrals.json`, log `validation.log` na mesma
  pasta. Repetição concorrente, conflito, rollback, recuperação, origem, nível,
  autoria transacional, revogação e preservação de assinaturas/filas comprovados.

## Falhas preservadas, sem converter em sucesso

1. Helper cumulativo `tests` terminou com507 testes,498 aprovados,9 falhas, zero
   ignorados/cancelados, duração821011ms (sessão local70379). O helper externo
   força `PREVIEW_MODE=1`, `MAIL_PROVIDERS=dev` e retenção30 em todos os arquivos.
   Há incompatibilidades observadas com testes que simulam as guardas de produção
   e selecionam adapters fictícios (por exemplo `batches`, `ses-events`,
   `signatures`). Não foi alterada guarda da aplicação para fazê-los passar.
   A causa de todas as nove falhas ainda precisa ser confirmada pela repetição;
   não declarar a cumulativa aprovada. A saída da sessão foi parcialmente
   truncada pelo terminal; a nova execução grava log completo no scratch.
2. Primeiro HTTP em `/tmp/admin-consolidation-eyiuvhqz` falhou no pepper fictício
   curto. Conforme orientação do dono, somente a credencial fictícia foi ampliada
   para mais de32 caracteres; assert preventivo acrescentado. Não foi lida nem
   alterada configuração real ou HASH_PEPPER de outro ambiente.
3. Repetição em `/tmp/admin-consolidation-ivmek__7` aprovou HTTP, mas navegador
   parou antes de abrir o Chromium: senha da conta fictícia continha seu e-mail.
   Corrigida apenas a fixture. Sem evidência visual aprovada ainda.
4. Execução de retomada de `consolidation.py --contracts referrals-browser
   content-retention whatsapp-senders` não iniciou após expirar a espera na
   supervisão. O executor retornou `rejected by user`, mas o responsável esclareceu
   posteriormente que não houve recusa do dono e reafirmou a autorização local.
   As sessões próprias55130 e39669 terminaram com saída1; não houve job novo
   naquela tentativa. Retomada autorizada em execução na sessão33946, evidências
   em `/tmp/admin-consolidation-qfa9ooqj`; aguardar seu resultado real.

## Retenção e restauro

Os cinco testes de biblioteca `admin-content-retention.test.ts` passaram dentro
da cumulativa que falhou em outros casos: limite30dias, expurgo de corpo/anexos,
preservação de originais/metadados, rollback, bloqueio de workers e resultado
iniciado antes do prazo sem recuperar corpo expirado.

Consolidada neste candidato a correção da fixture HTTP: `prepareMessage` usa
`confirmacao`, pois `admin` é restrito no endpoint de prévia. Ainda falta executar
o contrato compilado aqui. O resultado anterior500/500 e HTTP de outra cópia
constam no handoff; não são apresentados como verificação atual deste candidato.

AV15 permite Arquivados/Restaurar e30dias. O roteiro existente de catálogo foi
mantido e admite agora a porta exclusiva54349; precisa repetir restauro em390 e
1440px neste candidato. Isso restaura o registro do remetente, não o conteúdo de
e-mail expirado. Nenhum WAHA/transporte é ativado. Minutas persistentes e AV16
continuam em outro checkpoint; não declarar retenção do painel inteiro concluída.
Expurgo operacional não comprova exclusão de backups ou cópias dos provedores.

## Próxima ação reproduzível

O runner local novo exige portas3033/54349 livres, configuração vazia, banco
fictício novo por execução, mail dev e Chromium indicado pelo dono. Não reutiliza
listener desconhecido e encerra apenas o servidor/banco que ele próprio cria.
Não editar o helper externo nem outro worktree para alterar permissões.

Comandos autorizados pelo responsável, com aprovação técnica do executor se exigida:

```
python3 tools/admin-qa/consolidation.py --contracts referrals-browser content-retention whatsapp-senders
python3 tools/admin-qa/consolidation.py --tests
```

Executar em sequência. `--tests` remove apenas flags de prévia que interferem nas
fixtures, usa NODE_ENV=test, mail dev e arquivos serializados; mantém corridas
internas e guardas. Logs/relatórios ficam no scratch anunciado sob `/tmp`.
Depois conferir capturas, documentar resultados e fechar commit de evidências.

Hotfix de formulários `c55f190` reconhecido como ponta validada informada pelo
dono (196 testes/build/tipos/4 cenários); nenhuma integração realizada nesta
etapa. A eventual integração LOCAL exige etapa separada e nova regressão,
preservando os commits presentes. Nenhuma autorização de deploy/merge com VPS.

## Ensaios pendentes retomados e aprovados

A execução autorizada em `/tmp/admin-consolidation-qfa9ooqj` encontrou Node18.19.1
incompatível com o Playwright indicado (exige Node20+). Corrigido apenas o runner
de HTTP/navegador para usar Node24.22.1 do mesmo runtime. A cumulativa conserva
Node18.19.1, o runtime dos testes anteriores. Nenhuma guarda foi alterada.

`python3 tools/admin-qa/consolidation.py --contracts referrals-browser
content-retention whatsapp-senders` passou com saída0. Evidências atuais em
`/tmp/admin-consolidation-mt5_ik22/`, relatórios lidos e conferidos:

- `referrals-browser.json`:390/1440px, rótulo/UUID preservados após falha anterior
  ao commit e resposta perdida posterior ao commit. Repetição conclui um único
  código/evento sem renovar o ledger. Zero exceções e overflow no documento.
  Capturas `referrals-390.png`/`referrals-1440.png` inspecionadas visualmente;
  formulário e textos existentes preservados. A tabela móvel conserva o padrão
  existente de rolagem/contenção, sem intervenção de estética.
- `content-retention.json`: cron autenticado, leitura logicamente vencida antes
  da limpeza, remoção de corpo/anexos/cópias operacionais, originais/metadados
  preservados, expurgo repetido sem efeito extra e nenhum envio.
- `whatsapp-senders.json`:390/1440px, arquivar/filtrar/restaurar o mesmo registro,
  versão, cifra, data e estado preservados; rollback de auditoria, origem,
  confirmação extra, conflito de versão e revogação comprovados. Nenhuma mensagem
  de e-mail/WhatsApp criada e nenhuma ativação de WAHA.

O runner encerrou seus servidores e banco ao terminar. A próxima execução
`python3 tools/admin-qa/consolidation.py --tests` iniciou depois, sessão74840,
log completo em `/tmp/admin-consolidation-okkfug48/validation.log`.

Estado desta retomada: **continue**, aguardando resultado real da cumulativa.
Etapa e admin-v2 completo ainda não concluídos. A exceção EXATA de `ebserh.gov.br`
e `hubrasil.gov.br` está em outro candidato, sem integração neste checkpoint.
