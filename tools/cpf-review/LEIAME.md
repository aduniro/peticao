# Revisão local de cadastros

Abra a página com o comando completo:

```sh
/mnt/dev/cpfs/revisar-cpfs
```

A interface HTML usa o SQLite `/mnt/dev/cpfs/revisao/revisao.sqlite` e atende apenas em `127.0.0.1:8765`. O comando abre o navegador com autenticação local. Os arquivos de dados ficam em diretório privado, com permissões 700/600.

## Conferência e decisões

- Use as categorias para separar divergência forte, relevante, possível erro de digitação, ordem diferente, nome incompleto, nome insuficiente e consultas sem resultado.
- Compare o nome do formulário com nome, nascimento, mãe e sexo retornados pela API. Dados indisponíveis são identificados; nascimento e mãe digitados no desafio antigo não foram armazenados pelo aplicativo.
- Correspondências exatas, normalizadas e diferenças apenas de partículas começam aprovadas pelo critério anteriormente aceito. As demais aguardam revisão manual.
- **Aprovar** e **Rejeitar** salvam somente uma decisão local. Os rejeitados saem da lista ativa, permanecem na aba **Rejeitados** e podem voltar à revisão. Cada decisão mantém autor local, horário e revisão dos dados.
- **Detalhes e histórico** mostra datas, origem e decisões anteriores. A confirmação da assinatura é independente da revisão.

## Atualizações

**Atualizar dados da VPS** gera uma exportação somente leitura e baixa os resultados disponíveis, sem novas consultas pagas. Os arquivos de origem permanecem em `/mnt/dev/cpfs/revisao/fontes/`, com manifesto SHA-256. As decisões manuais são preservadas; mudanças nos dados comparados devolvem o caso à revisão.

Esta ferramenta não altera assinaturas, nomes, hashes, numeração ou PDFs em produção e não envia e-mails. Uma futura aplicação das decisões requer uma etapa separada.

## Verificação

```sh
cd /mnt/dev/peticao
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/cpf-review -p 'test_*.py'
node --check tools/cpf-review/app.js
```

## Recepção automática da VPS

O serviço local `peticao-cpf-review-sync.service` confere a fonte a cada **30 segundos** e recebe apenas alterações detectadas pelo fingerprint. A página consulta o SQLite a cada 5 segundos e atualiza a tabela após uma pausa na interação: filtros, página, seleção de texto e o diálogo aberto são preservados. Para carregar esta versão em uma aba que já estava aberta, atualize a página uma vez.

```sh
/usr/bin/systemctl --user status peticao-cpf-review-sync.service
/usr/bin/journalctl --user -u peticao-cpf-review-sync.service -n 10 --no-pager
```

A origem utiliza **uma transação PostgreSQL `REPEATABLE READ READ ONLY`** para assinaturas e cache, com limite de 15 segundos por consulta e 1 segundo para aguardar locks. O exportador tem somente operações de leitura e não usa o bridge que permite gravar cache. Nenhuma decisão, aprovação, rejeição ou campo local é enviado ao banco da VPS. A chave de criptografia fica no servidor e nunca aparece nos logs ou pacotes.

A importação confere SHA-256 do pacote, manifesto, nomes de arquivos, unicidade de IDs, ordem dos snapshots e integridade das bases SQLite. Novos registros e dados alterados são aplicados em uma transação local; decisões simultâneas aguardam essa transação e não são sobrescritas. As bases históricas estáticas só são reenviadas quando seu conteúdo muda. Dez snapshots novos do pipe são mantidos; fontes que existiam antes desta tarefa não entram nessa rotação.

- **Decisões manuais de nome×CPF** não são apagadas por enriquecimento de nascimento/mãe/sexo, mudanças de instituição/categoria/datas ou nova versão da regra do aplicativo.
- Uma mudança substantiva de grafia, ordem dos nomes ou hash do CPF devolve somente aquele caso à revisão. Variações apenas de caixa, acentos, espaços e partículas preservam a decisão (fingerprint `name-cpf-v3`). O histórico da decisão e a versão anterior dos dados permanecem guardados.
- Se o cache expirar, a última evidência cadastral local é preservada, identificada como histórica. Um retorno posterior contraditório é sinalizado; não apaga a evidência anterior.
- As regras automáticas da aplicação em produção são identificadas por digest e versão do build; a página não transforma uma mudança dessas regras em nova aprovação manual.
- Novos CPFs podem chegar como **hash e dados da API, sem o número em claro**. A VPS não guarda o número no banco do aplicativo. Nesses casos aparece “Número não disponível”; o pipe não tenta reverter hashes, não inicia recuperação e não faz consultas pagas.
- Se o computador desligar ou a conexão cair, a cópia local e as decisões permanecem utilizáveis. A recepção retoma quando houver sessão local e conexão SSH. O status da página mostra a última conferência e a defasagem.

Banco: `/mnt/dev/cpfs/revisao/revisao.sqlite`.
Estado da conexão/checkpoint: `/mnt/dev/cpfs/revisao/sync-state.json`.
Backup anterior ao pipe: `/mnt/dev/cpfs/backups/revisao-pipe-20261106T143836Z/revisao.sqlite`.
